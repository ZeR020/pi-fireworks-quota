import { fileURLToPath } from "node:url";
import type {
	ClientUnaryCall,
	Metadata,
	ServiceClientConstructor,
	ServiceError,
} from "@grpc/grpc-js";
import { moneyToNumber, shortModelName } from "./format";
import type { ModelUsage } from "./types";

export type DateRange = {
	start: Date;
	end: Date;
	startIso: string;
	endIso: string;
};

const TARGET = "gateway.fireworks.ai:443";
export const GRPC_DEADLINE_MS = 25_000;

type GatewayClient = InstanceType<ServiceClientConstructor>;

interface Money {
	currency_code?: string;
	units?: string | number;
	nanos?: string | number;
}

let client: GatewayClient | undefined;

const STATE_NAMES: Record<number, string> = {
	0: "UNSPECIFIED",
	1: "CREATING",
	2: "READY",
	3: "UPDATING",
	4: "DELETING",
};

async function getClient(): Promise<GatewayClient> {
	if (client) return client;
	const [{ credentials, loadPackageDefinition }, { loadSync }] =
		await Promise.all([import("@grpc/grpc-js"), import("@grpc/proto-loader")]);
	const protoPath = fileURLToPath(
		new URL("./fireworks.proto", import.meta.url),
	);
	const definition = loadSync(protoPath, {
		keepCase: true,
		longs: String,
		defaults: true,
	});
	const proto = loadPackageDefinition(definition) as unknown as {
		gateway: { Gateway: ServiceClientConstructor };
	};
	// Minimal channel identity: no app/OS/agent branding in metadata.
	// grpc-js still appends its own "grpc-node-js/<ver>" (library only).
	client = new proto.gateway.Gateway(TARGET, credentials.createSsl(), {
		"grpc.primary_user_agent": "fireworks-quota",
		"grpc.enable_channelz": 0,
	});
	return client;
}

/**
 * Fire-and-forget channel warmup at extension load. grpc-js connects lazily
 * on first RPC; waitForReady forces TCP+TLS+HTTP2 now so the first real call
 * skips the handshake. Never rejects.
 */
export async function warmup(): Promise<void> {
	try {
		const gateway = await getClient();
		await new Promise<void>((resolve) => {
			gateway.waitForReady(new Date(Date.now() + 10_000), () => resolve());
		});
	} catch {
		// Warmup is best-effort; real calls surface their own errors.
	}
}

async function unary<T>(
	method: string,
	request: object,
	apiKey: string,
	signal: AbortSignal,
): Promise<T> {
	const grpc = await import("@grpc/grpc-js");
	const gateway = await getClient();

	return new Promise<T>((resolve, reject) => {
		if (signal.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const metadata = new grpc.Metadata();
		metadata.set("x-api-key", apiKey);
		const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
		const invoke = gateway[method] as (
			req: object,
			meta: Metadata,
			opts: { deadline: Date },
			cb: (err: ServiceError | null, res: T) => void,
		) => ClientUnaryCall;

		const call = invoke.call(
			gateway,
			request,
			metadata,
			{ deadline },
			(error, response) => {
				if (!error) {
					resolve(response);
					return;
				}
				const msg = error.details || error.message;
				const err = new Error(msg);
				if (
					error.code === grpc.status.DEADLINE_EXCEEDED ||
					/deadline/i.test(msg)
				) {
					(err as Error & { kind?: string }).kind = "timeout";
				}
				reject(err);
			},
		);
		signal.addEventListener("abort", () => call.cancel(), { once: true });
	});
}

function num(v: string | number | undefined): number {
	const n = Number(v ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function lastPart(name: string): string {
	return name.split("/").filter(Boolean).at(-1) ?? name;
}

function stateLabel(state: number | string | undefined): string {
	if (typeof state === "string" && state) return state;
	return STATE_NAMES[Number(state ?? 0)] ?? String(state ?? "");
}

/** Match usage model ids to billing labels (kimi-k3 ↔ Kimi K3, glm-5p2 ↔ GLM 5.2). */
export function normModelLabel(s: string): string {
	return shortModelName(s)
		.toLowerCase()
		.replace(/v(?=\d)/g, "") // llama-v3 → llama3
		.replace(/p(?=\d)/g, "") // 5p2 → 52, k2p7 → k27
		.replace(/[^a-z0-9]+/g, "")
		.replace(/(instruct|chat|code)$/g, "");
}

type ResolvedAccount = {
	name: string;
	id: string;
	email: string;
	state: string;
};

/** Process-lifetime cache keyed by api key tail — skips ListAccounts on refresh. */
const accountCache = new Map<string, ResolvedAccount>();

export async function resolveAccount(
	apiKey: string,
	signal: AbortSignal,
): Promise<ResolvedAccount> {
	const cacheKey = apiKey.length <= 8 ? apiKey : apiKey.slice(-8);
	const hit = accountCache.get(cacheKey);
	if (hit) return hit;

	const response = await unary<{
		accounts?: Array<{
			name?: string;
			email?: string;
			state?: number | string;
		}> | null;
	}>("ListAccounts", {}, apiKey, signal);

	const acc = response.accounts?.[0];
	const name = acc?.name;
	if (!name) throw new Error("No Fireworks account found for this API key");
	const resolved: ResolvedAccount = {
		name,
		id: lastPart(name),
		email: acc?.email ?? "",
		state: stateLabel(acc?.state),
	};
	accountCache.set(cacheKey, resolved);
	return resolved;
}

export async function fetchBalanceUsd(
	apiKey: string,
	accountName: string,
	signal: AbortSignal,
): Promise<number | null> {
	const balance = await unary<{ money?: Money | null }>(
		"GetBalance",
		{ name: accountName },
		apiKey,
		signal,
	);
	return moneyToNumber(balance.money) ?? null;
}

export async function fetchTokenUsage(
	apiKey: string,
	accountName: string,
	range: DateRange,
	signal: AbortSignal,
): Promise<{
	rangeStart: string;
	rangeEnd: string;
	totalTokens: number;
	byModel: ModelUsage[];
	promptTokens: number;
	completionTokens: number;
	cachedPromptTokens: number;
	uncachedPromptTokens: number;
}> {
	const response = await unary<{
		serverless_costs?: Array<{
			model_name?: string;
			prompt_tokens?: string | number;
			completion_tokens?: string | number;
			cached_prompt_tokens?: string | number;
			uncached_prompt_tokens?: string | number;
		}> | null;
	}>(
		"GetAccountUsage",
		{
			name: accountName,
			start_time: { seconds: String(Math.floor(range.start.getTime() / 1000)) },
			end_time: { seconds: String(Math.floor(range.end.getTime() / 1000)) },
			usage_type: "SERVERLESS",
			timezone: "UTC",
			group_by: ["model_name"],
		},
		apiKey,
		signal,
	);

	const byModelMap = new Map<string, ModelUsage>();
	for (const row of response.serverless_costs ?? []) {
		const model = row.model_name || "unknown";
		const prev = byModelMap.get(model) ?? {
			model,
			promptTokens: 0,
			completionTokens: 0,
			cachedPromptTokens: 0,
			uncachedPromptTokens: 0,
			spendUsd: null,
		};
		prev.promptTokens += num(row.prompt_tokens);
		prev.completionTokens += num(row.completion_tokens);
		prev.cachedPromptTokens += num(row.cached_prompt_tokens);
		prev.uncachedPromptTokens += num(row.uncached_prompt_tokens);
		byModelMap.set(model, prev);
	}

	const byModel = [...byModelMap.values()].sort(
		(a, b) =>
			b.promptTokens +
			b.completionTokens -
			(a.promptTokens + a.completionTokens),
	);

	let promptTokens = 0;
	let completionTokens = 0;
	let cachedPromptTokens = 0;
	let uncachedPromptTokens = 0;
	for (const m of byModel) {
		promptTokens += m.promptTokens;
		completionTokens += m.completionTokens;
		cachedPromptTokens += m.cachedPromptTokens;
		uncachedPromptTokens += m.uncachedPromptTokens;
	}

	return {
		rangeStart: range.startIso,
		rangeEnd: range.endIso,
		totalTokens: promptTokens + completionTokens,
		byModel,
		promptTokens,
		completionTokens,
		cachedPromptTokens,
		uncachedPromptTokens,
	};
}

export async function fetchQuotas(
	apiKey: string,
	accountName: string,
	signal: AbortSignal,
): Promise<Map<string, { usage: number; value: number; max: number }>> {
	const response = await unary<{
		quotas?: Array<{
			name?: string;
			value?: string | number;
			max_value?: string | number;
			usage?: string | number;
		}> | null;
	}>("ListQuotas", { parent: accountName, page_size: 200 }, apiKey, signal);

	const map = new Map<string, { usage: number; value: number; max: number }>();
	for (const q of response.quotas ?? []) {
		const id = lastPart(q.name ?? "");
		if (!id) continue;
		map.set(id, {
			usage: num(q.usage),
			value: num(q.value),
			max: num(q.max_value),
		});
	}
	return map;
}

export async function fetchSpendUsd(
	apiKey: string,
	accountName: string,
	range: DateRange,
	signal: AbortSignal,
): Promise<{ totalUsd: number; byModel: Map<string, number> }> {
	const response = await unary<{
		line_items?: Array<{
			grouping_key?: string;
			grouping_value?: string;
			total_cost?: Money | null;
		}> | null;
	}>(
		"GetBillingSummary",
		{
			name: accountName,
			start_time: { seconds: String(Math.floor(range.start.getTime() / 1000)) },
			end_time: { seconds: String(Math.floor(range.end.getTime() / 1000)) },
			granularity: 1,
		},
		apiKey,
		signal,
	);

	const items = response.line_items ?? [];
	// Prefer model_bucket rows only — avoids double-counting rollup lines.
	const modelRows = items.filter((i) => i.grouping_key === "model_bucket");
	const rows = modelRows.length > 0 ? modelRows : items;

	let totalUsd = 0;
	const byModel = new Map<string, number>();
	for (const item of rows) {
		const amount = moneyToNumber(item.total_cost);
		if (amount === undefined) continue;
		totalUsd += amount;
		const label = item.grouping_value || "other";
		byModel.set(label, (byModel.get(label) ?? 0) + amount);
	}
	return { totalUsd, byModel };
}

/** Attach billing $ to token rows; unmatched spend stays null (no fake rows). */
export function attachSpendToModels(
	byModel: ModelUsage[],
	spendByLabel: Map<string, number>,
): ModelUsage[] {
	const spendByNorm = new Map<string, number>();
	for (const [label, usd] of spendByLabel) {
		const k = normModelLabel(label);
		if (!k) continue;
		spendByNorm.set(k, (spendByNorm.get(k) ?? 0) + usd);
	}

	return byModel
		.map((m) => {
			const spend = spendByNorm.get(normModelLabel(m.model));
			return { ...m, spendUsd: spend ?? null };
		})
		.sort(
			(a, b) =>
				(b.spendUsd ?? 0) - (a.spendUsd ?? 0) ||
				b.promptTokens +
					b.completionTokens -
					(a.promptTokens + a.completionTokens),
		);
}

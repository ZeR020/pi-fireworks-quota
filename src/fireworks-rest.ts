import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { moneyToNumber, shortModelName } from "./format";
import type { ModelUsage } from "./types";

export type DateRange = {
	start: Date;
	end: Date;
	startIso: string;
	endIso: string;
};

const BASE_URL = new URL(
	process.env.FIREWORKS_API_BASE ?? "https://api.fireworks.ai",
);
const transport =
	BASE_URL.protocol === "http:" ? httpRequest : httpsRequest;

// Fireworks removed API-key auth from the gRPC gateway (every x-api-key call
// returns 13 INTERNAL since Oct 2026); the documented REST control plane at
// api.fireworks.ai/v1 is the only API-key path. Bearer auth per
// docs.fireworks.ai/api-reference.
//
// Transport uses node:https with family: 4 — fetch's Happy Eyeballs kills any
// address attempt slower than 250ms (autoSelectFamilyAttemptTimeout), which
// api.fireworks.ai's AWS frontend exceeds on some networks.
function get<T>(
	path: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const req = transport(
			{
				host: BASE_URL.hostname,
				port: BASE_URL.port,
				path: `${BASE_URL.pathname.replace(/\/$/, "")}${path}`,
				family: 4,
				headers: { authorization: `Bearer ${apiKey}` },
				signal,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					const status = res.statusCode ?? 0;
					const body = Buffer.concat(chunks).toString("utf8");
					if (status < 200 || status >= 300) {
						let detail = "";
						try {
							const parsed = JSON.parse(body) as {
								error?: { message?: string };
								message?: string;
							};
							detail = parsed.error?.message ?? parsed.message ?? "";
						} catch {
							// non-JSON error body
						}
						const err = new Error(
							detail || `Fireworks API error (HTTP ${status})`,
						);
						// 4xx (except 429) are permanent — retrying wastes seconds.
						if (status < 500 && status !== 429) {
							(err as Error & { permanent?: boolean }).permanent = true;
						}
						reject(err);
						return;
					}
					try {
						resolve(JSON.parse(body) as T);
					} catch (err) {
						reject(err instanceof Error ? err : new Error(String(err)));
					}
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

function query(params: Record<string, string>): string {
	const s = new URLSearchParams(params).toString();
	return s ? `?${s}` : "";
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
	return String(state ?? "");
}

type MoneyJson = { units?: string | number; nanos?: string | number };

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
	signal?: AbortSignal,
): Promise<ResolvedAccount> {
	const cacheKey = apiKey.length <= 8 ? apiKey : apiKey.slice(-8);
	const hit = accountCache.get(cacheKey);
	if (hit) return hit;

	const response = await get<{
		accounts?: Array<{
			name?: string;
			email?: string;
			state?: number | string;
		}> | null;
	}>("/v1/accounts", apiKey, signal);

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
	signal?: AbortSignal,
): Promise<number | null> {
	// shortcut: :getBalance is undocumented and 403s for most API keys, so
	// balance soft-fails to null; revisit if Fireworks documents a balance API.
	const balance = await get<MoneyJson & { money?: MoneyJson | null }>(
		`/v1/accounts/${lastPart(accountName)}:getBalance`,
		apiKey,
		signal,
	);
	return moneyToNumber(balance.money ?? balance) ?? null;
}

export async function fetchTokenUsage(
	apiKey: string,
	accountName: string,
	range: DateRange,
	signal?: AbortSignal,
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
	const response = await get<{
		serverlessCosts?: Array<{
			modelName?: string;
			group?: Record<string, string>;
			promptTokens?: string | number;
			completionTokens?: string | number;
			cachedPromptTokens?: string | number;
			uncachedPromptTokens?: string | number;
		}> | null;
	}>(
		`/v1/accounts/${lastPart(accountName)}/billingUsage${query({
			startTime: range.start.toISOString(),
			endTime: range.end.toISOString(),
			usageType: "SERVERLESS",
			timezone: "UTC",
			groupBy: "model_name",
		})}`,
		apiKey,
		signal,
	);

	const byModelMap = new Map<string, ModelUsage>();
	for (const row of response.serverlessCosts ?? []) {
		const model = row.group?.model_name || row.modelName || "unknown";
		const prev = byModelMap.get(model) ?? {
			model,
			promptTokens: 0,
			completionTokens: 0,
			cachedPromptTokens: 0,
			uncachedPromptTokens: 0,
			spendUsd: null,
		};
		prev.promptTokens += num(row.promptTokens);
		prev.completionTokens += num(row.completionTokens);
		prev.cachedPromptTokens += num(row.cachedPromptTokens);
		prev.uncachedPromptTokens += num(row.uncachedPromptTokens);
		byModelMap.set(model, prev);
	}

	const byModel = [...byModelMap.values()].sort(
		(a, b) =>
			b.promptTokens + b.completionTokens -
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
	signal?: AbortSignal,
): Promise<Map<string, { usage: number; value: number; max: number }>> {
	const map = new Map<string, { usage: number; value: number; max: number }>();
	let pageToken = "";
	do {
		const params: Record<string, string> = { pageSize: "200" };
		if (pageToken) params.pageToken = pageToken;
		const response = await get<{
			quotas?: Array<{
				name?: string;
				value?: string | number;
				maxValue?: string | number;
				usage?: string | number;
			}> | null;
			nextPageToken?: string;
		}>(`/v1/accounts/${lastPart(accountName)}/quotas${query(params)}`, apiKey, signal);
		for (const q of response.quotas ?? []) {
			const id = lastPart(q.name ?? "");
			if (!id) continue;
			map.set(id, {
				usage: num(q.usage),
				value: num(q.value),
				max: num(q.maxValue),
			});
		}
		pageToken = response.nextPageToken ?? "";
	} while (pageToken);
	return map;
}

export async function fetchSpendUsd(
	apiKey: string,
	accountName: string,
	range: DateRange,
	signal?: AbortSignal,
): Promise<{ totalUsd: number; byModel: Map<string, number> }> {
	const response = await get<{
		lineItems?: Array<{
			groupingKey?: string;
			groupingValue?: string;
			totalCost?: MoneyJson | null;
		}> | null;
	}>(
		`/v1/accounts/${lastPart(accountName)}/billing/summary${query({
			startTime: range.start.toISOString(),
			endTime: range.end.toISOString(),
		})}`,
		apiKey,
		signal,
	);

	const items = response.lineItems ?? [];
	// Prefer model_bucket rows only — avoids double-counting rollup lines.
	const modelRows = items.filter((i) => i.groupingKey === "model_bucket");
	const rows = modelRows.length > 0 ? modelRows : items;

	let totalUsd = 0;
	const byModel = new Map<string, number>();
	for (const item of rows) {
		const amount = moneyToNumber(item.totalCost);
		if (amount === undefined) continue;
		totalUsd += amount;
		const label = item.groupingValue || "other";
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

import {
	attachSpendToModels,
	fetchBalanceUsd,
	fetchQuotas,
	fetchSpendUsd,
	fetchTokenUsage,
	resolveAccount,
} from "./fireworks-grpc";
import { keyTail, periodRangeUtc, type UsagePeriod } from "./format";
import type {
	FetchErrorKind,
	FireworksQuotaSnapshot,
	PeriodUsage,
	QuotaResult,
} from "./types";

type PeriodResult =
	| { success: true; data: PeriodUsage }
	| { success: false; error: { message: string; kind: FetchErrorKind } };

function combineSignals(signal?: AbortSignal): AbortSignal {
	const signals: AbortSignal[] = [AbortSignal.timeout(30_000)];
	if (signal) signals.push(signal);
	return AbortSignal.any(signals);
}

function isAbortError(err: unknown, signal: AbortSignal): boolean {
	return (
		signal.aborted ||
		(err instanceof DOMException && err.name === "AbortError") ||
		(err instanceof Error && err.name === "AbortError")
	);
}

function isTimeout(err: unknown, signal: AbortSignal): boolean {
	if (
		err &&
		typeof err === "object" &&
		"kind" in err &&
		(err as { kind?: string }).kind === "timeout"
	) {
		return true;
	}
	const reason = signal.reason;
	return (
		(reason instanceof DOMException && reason.name === "TimeoutError") ||
		(reason instanceof Error && reason.name === "TimeoutError")
	);
}

function fail(
	err: unknown,
	signal: AbortSignal,
): { success: false; error: { message: string; kind: FetchErrorKind } } {
	if (isAbortError(err, signal)) {
		const timedOut = isTimeout(err, signal);
		return {
			success: false,
			error: {
				message: timedOut ? "Request timed out" : "Request cancelled",
				kind: timedOut ? "timeout" : "cancelled",
			},
		};
	}
	const message = err instanceof Error ? err.message : "Unknown error";
	const kind: FetchErrorKind =
		err &&
		typeof err === "object" &&
		"kind" in err &&
		(err as { kind?: string }).kind === "timeout"
			? "timeout"
			: "grpc";
	return { success: false, error: { message, kind } };
}

/** Soft-fail optional endpoints; still surface cancel/timeout. */
async function optionalCall<T>(
	p: Promise<T>,
	signal: AbortSignal,
	fallback: T,
): Promise<T> {
	try {
		return await p;
	} catch (err: unknown) {
		if (isAbortError(err, signal)) throw err;
		return fallback;
	}
}

/** Fireworks GetBillingSummary flakes with "billing data is temporarily unavailable". */
async function withRetry<T>(
	fn: () => Promise<T>,
	signal: AbortSignal,
	attempts = 3,
): Promise<T> {
	let last: unknown;
	for (let i = 0; i < attempts; i++) {
		if (signal.aborted) throw new DOMException("Aborted", "AbortError");
		try {
			return await fn();
		} catch (err: unknown) {
			last = err;
			if (isAbortError(err, signal)) throw err;
			// brief backoff before retry; skip sleep on last attempt
			if (i < attempts - 1) {
				await new Promise<void>((r) => setTimeout(r, 200 * (i + 1)));
			}
		}
	}
	throw last;
}

/** One period (today | week | month) — initial month + lazy Models ←/→. */
export async function fetchPeriodUsage(
	apiKey: string,
	accountName: string,
	period: UsagePeriod,
	signal?: AbortSignal,
): Promise<PeriodResult> {
	const combined = combineSignals(signal);
	try {
		const range = periodRangeUtc(period);
		// Tokens are required; billing is optional (Fireworks often 503s GetBillingSummary).
		const emptySpend = {
			totalUsd: null as number | null,
			byModel: new Map<string, number>(),
		};
		const [tokens, spend] = await Promise.all([
			fetchTokenUsage(apiKey, accountName, range, combined),
			optionalCall(
				withRetry(
					() =>
						fetchSpendUsd(apiKey, accountName, range, combined).then((s) => ({
							totalUsd: s.totalUsd as number | null,
							byModel: s.byModel,
						})),
					combined,
				),
				combined,
				emptySpend,
			),
		]);
		return {
			success: true,
			data: {
				period,
				rangeStart: tokens.rangeStart,
				rangeEnd: tokens.rangeEnd,
				totalTokens: tokens.totalTokens,
				spendUsd: spend.totalUsd,
				byModel: attachSpendToModels(tokens.byModel, spend.byModel),
				promptTokens: tokens.promptTokens,
				completionTokens: tokens.completionTokens,
				cachedPromptTokens: tokens.cachedPromptTokens,
				uncachedPromptTokens: tokens.uncachedPromptTokens,
			},
		};
	} catch (err: unknown) {
		return fail(err, combined);
	}
}

/** Initial snapshot: balance + quotas + month only. */
export async function fetchFireworksQuota(
	apiKey: string,
	signal?: AbortSignal,
): Promise<QuotaResult> {
	if (!apiKey) {
		return {
			success: false,
			error: { message: "No API key provided", kind: "config" },
		};
	}

	const combined = combineSignals(signal);

	try {
		const account = await resolveAccount(apiKey, combined);

		// Balance/quotas optional — billing blips must not blank the whole UI.
		const [balanceUsd, quotas, month] = await Promise.all([
			optionalCall(
				withRetry(
					() => fetchBalanceUsd(apiKey, account.name, combined),
					combined,
				),
				combined,
				null,
			),
			optionalCall(
				fetchQuotas(apiKey, account.name, combined),
				combined,
				new Map(),
			),
			fetchPeriodUsage(apiKey, account.name, "month", combined),
		]);

		if (!month.success) return month;

		const rpm = quotas.get("serverless-inference-rpm");
		const spendQuota = quotas.get("monthly-spend-usd");
		const budget = spendQuota?.value ?? null;
		let serverlessRpmMax: number | null = null;
		if (rpm) {
			serverlessRpmMax = rpm.value > 0 ? rpm.value : rpm.max || null;
		}

		const data: FireworksQuotaSnapshot = {
			accountName: account.name,
			account: {
				id: account.id,
				email: account.email,
				state: account.state,
			},
			keyTail: keyTail(apiKey),
			balanceUsd,
			monthBudgetUsd:
				budget !== null && budget > 0 && budget < 1_000_000 ? budget : null,
			serverlessRpmMax,
			models: { month: month.data },
		};

		return { success: true, data };
	} catch (err: unknown) {
		return fail(err, combined);
	}
}

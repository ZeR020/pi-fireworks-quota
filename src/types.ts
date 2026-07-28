import type { UsagePeriod } from "./format";

export type FetchErrorKind = "cancelled" | "timeout" | "config" | "grpc";

export interface ModelUsage {
	model: string;
	promptTokens: number;
	completionTokens: number;
	cachedPromptTokens: number;
	uncachedPromptTokens: number;
	spendUsd: number | null;
}

export interface PeriodUsage {
	period: UsagePeriod;
	rangeStart: string;
	rangeEnd: string;
	totalTokens: number;
	spendUsd: number;
	byModel: ModelUsage[];
	promptTokens: number;
	completionTokens: number;
	cachedPromptTokens: number;
	uncachedPromptTokens: number;
}

export interface FireworksQuotaSnapshot {
	/** Resource name e.g. accounts/foo — used for lazy period fetches. */
	accountName: string;
	account: { id: string; email: string; state: string };
	keyTail: string;
	balanceUsd: number | null;
	monthBudgetUsd: number | null;
	serverlessRpmMax: number | null;
	/** month always present; today/week filled on demand. */
	models: Partial<Record<UsagePeriod, PeriodUsage>> & { month: PeriodUsage };
}

export type QuotaResult =
	| { success: true; data: FireworksQuotaSnapshot }
	| { success: false; error: { message: string; kind: FetchErrorKind } };

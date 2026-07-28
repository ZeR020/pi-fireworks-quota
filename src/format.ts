export type UsagePeriod = "today" | "week" | "month";

export const USAGE_PERIODS: UsagePeriod[] = ["today", "week", "month"];

export const PERIOD_LABEL: Record<UsagePeriod, string> = {
	today: "Today",
	week: "Week",
	month: "Month",
};

export function formatUsd(value: number): string {
	if (value > 0 && value < 0.01) return "<$0.01";
	return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return value.toLocaleString();
}

export function shortModelName(name: string): string {
	return name.split("/").at(-1) || name;
}

export function keyTail(apiKey: string): string {
	return apiKey.length <= 6 ? apiKey : `…${apiKey.slice(-4)}`;
}

export function moneyToNumber(
	money:
		| { units?: string | number; nanos?: string | number }
		| null
		| undefined,
): number | undefined {
	if (!money) return undefined;
	const units = Number(money.units ?? 0);
	const nanos = Number(money.nanos ?? 0);
	if (!Number.isFinite(units) || !Number.isFinite(nanos)) return undefined;
	return units + nanos / 1e9;
}

export function severityFromPercent(
	remainingPct: number,
): "success" | "warning" | "error" {
	if (remainingPct <= 10) return "error";
	if (remainingPct <= 25) return "warning";
	return "success";
}

/** UTC range; end is exclusive (start of day after last included day). */
export function periodRangeUtc(
	period: UsagePeriod,
	now = new Date(),
): { start: Date; end: Date; startIso: string; endIso: string } {
	const y = now.getUTCFullYear();
	const m = now.getUTCMonth();
	const d = now.getUTCDate();
	const end = new Date(Date.UTC(y, m, d + 1));
	let start: Date;
	if (period === "today") start = new Date(Date.UTC(y, m, d));
	else if (period === "week") start = new Date(Date.UTC(y, m, d - 6));
	else start = new Date(Date.UTC(y, m, 1));
	return {
		start,
		end,
		startIso: start.toISOString().slice(0, 10),
		endIso: end.toISOString().slice(0, 10),
	};
}

/** Inclusive display range (hides exclusive end day). */
export function formatRangeLabel(
	startIso: string,
	endIsoExclusive: string,
): string {
	const end = new Date(`${endIsoExclusive}T00:00:00Z`);
	end.setUTCDate(end.getUTCDate() - 1);
	const endIso = end.toISOString().slice(0, 10);
	return startIso === endIso ? startIso : `${startIso} → ${endIso}`;
}

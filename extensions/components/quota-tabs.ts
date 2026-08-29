import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	formatRangeLabel,
	formatTokens,
	formatUsd,
	PERIOD_LABEL,
	severityFromPercent,
	shortModelName,
	type UsagePeriod,
	USAGE_PERIODS,
} from "../../src/format";
import type { FireworksQuotaSnapshot, PeriodUsage } from "../../src/types";

function labelValue(
	label: string,
	value: string,
	maxWidth: number,
	theme: Theme,
): string {
	return truncateToWidth(
		`  ${theme.fg("dim", label.padEnd(12))} ${value}`,
		maxWidth,
	);
}

function fillBar(
	pct: number,
	width: number,
	theme: Theme,
	color: "accent" | "success" | "warning" | "error" | "dim" = "accent",
): string {
	const clamped = Math.max(0, Math.min(100, pct));
	const filled = Math.round((clamped / 100) * width);
	let s = "";
	for (let i = 0; i < width; i++) {
		s += i < filled ? theme.fg(color, "█") : theme.fg("dim", "░");
	}
	return s;
}

function padLeft(s: string, w: number): string {
	return s.length >= w ? s.slice(0, w) : s.padStart(w);
}

function padRight(s: string, w: number): string {
	return s.length >= w ? s.slice(0, w) : s.padEnd(w);
}

export function renderBalanceTab(
	snap: FireworksQuotaSnapshot,
	contentWidth: number,
	maxWidth: number,
	theme: Theme,
): string[] {
	const lines: string[] = [""];
	const w = Math.min(40, Math.max(20, contentWidth - 30));

	lines.push(
		truncateToWidth(`  ${theme.fg("accent", theme.bold("Credits"))}`, maxWidth),
	);
	lines.push(
		labelValue(
			"Remaining",
			snap.balanceUsd === null ? "unavailable" : formatUsd(snap.balanceUsd),
			maxWidth,
			theme,
		),
	);

	lines.push("");
	lines.push(
		truncateToWidth(
			`  ${theme.fg("accent", theme.bold("Month spend"))}`,
			maxWidth,
		),
	);
	const spend = snap.models.month.spendUsd;
	const budget = snap.monthBudgetUsd;
	if (spend === null) {
		lines.push(labelValue("Spent", "unavailable", maxWidth, theme));
	} else if (budget && budget > 0) {
		const usedPct = Math.min(100, (spend / budget) * 100);
		const left = Math.max(0, 100 - usedPct);
		const sev = severityFromPercent(left);
		lines.push(
			truncateToWidth(
				`  ${fillBar(left, w, theme, sev)} ${theme.fg(sev, `${Math.round(left)}% left`)}`,
				maxWidth,
			),
		);
		lines.push(
			labelValue(
				"Spent",
				`${formatUsd(spend)} of ${formatUsd(budget)}`,
				maxWidth,
				theme,
			),
		);
	} else {
		lines.push(labelValue("Spent", formatUsd(spend), maxWidth, theme));
	}
	return lines;
}

export function renderTokensTab(
	snap: FireworksQuotaSnapshot,
	maxWidth: number,
	theme: Theme,
): string[] {
	const m = snap.models.month;
	const lines: string[] = [""];
	lines.push(
		truncateToWidth(
			`  ${theme.fg("accent", theme.bold("Usage (this month)"))}`,
			maxWidth,
		),
	);
	lines.push(
		labelValue(
			"Range",
			formatRangeLabel(m.rangeStart, m.rangeEnd),
			maxWidth,
			theme,
		),
	);
	lines.push(labelValue("Total", formatTokens(m.totalTokens), maxWidth, theme));
	lines.push(
		labelValue(
			"Spend",
			m.spendUsd === null ? "unavailable" : formatUsd(m.spendUsd),
			maxWidth,
			theme,
		),
	);
	lines.push(
		labelValue("Prompt", formatTokens(m.promptTokens), maxWidth, theme),
	);
	lines.push(
		labelValue("Completion", formatTokens(m.completionTokens), maxWidth, theme),
	);
	lines.push(
		labelValue("Cached", formatTokens(m.cachedPromptTokens), maxWidth, theme),
	);
	lines.push(
		labelValue(
			"Uncached",
			formatTokens(m.uncachedPromptTokens),
			maxWidth,
			theme,
		),
	);
	if (m.promptTokens > 0) {
		const hit = Math.round((m.cachedPromptTokens / m.promptTokens) * 100);
		lines.push(labelValue("Cache hit", `${hit}%`, maxWidth, theme));
	}
	lines.push("");
	lines.push(theme.fg("dim", "  Per-model → Models tab  (←/→ period)"));
	return lines;
}

export function renderModelsTab(
	usage: PeriodUsage | undefined,
	period: UsagePeriod,
	contentWidth: number,
	maxWidth: number,
	theme: Theme,
	loading = false,
	error: string | null = null,
): string[] {
	const lines: string[] = [""];

	// Period switcher
	const chips = USAGE_PERIODS.map((p) => {
		const label = ` ${PERIOD_LABEL[p]} `;
		return p === period
			? theme.bg("selectedBg", theme.fg("accent", theme.bold(label)))
			: theme.fg("dim", label);
	});
	lines.push(truncateToWidth(`  ${chips.join("  ")}`, maxWidth));

	if (error) {
		lines.push("");
		lines.push(
			...wrapTextWithAnsi(theme.fg("error", `  ${error}`), maxWidth),
		);
		return lines;
	}

	if (loading || !usage) {
		lines.push("");
		lines.push(theme.fg("muted", "  Loading period…"));
		return lines;
	}

	// Summary strip
	const range = formatRangeLabel(usage.rangeStart, usage.rangeEnd);
	const spendLabel =
		usage.spendUsd === null ? "unavailable" : formatUsd(usage.spendUsd);
	lines.push(
		truncateToWidth(
			`  ${theme.fg("dim", range)}  ·  ${theme.bold(formatTokens(usage.totalTokens))} tok  ·  ${theme.bold(spendLabel)}`,
			maxWidth,
		),
	);
	lines.push("");

	if (usage.byModel.length === 0) {
		lines.push(theme.fg("dim", "  No serverless usage in this period"));
		return lines;
	}

	// Column layout (plain widths; color applied after padding)
	const names = usage.byModel.map((m) => shortModelName(m.model));
	const nameW = Math.min(22, Math.max(10, ...names.map((n) => n.length)));
	const tokW = 8;
	const spendW = 8;
	const pctW = 4;
	// Remaining width for share bar: total usable ≈ contentWidth - gutters - fixed cols
	const fixed = 2 + nameW + 2 + tokW + 2 + spendW + 2 + pctW + 1;
	const shareBarW = Math.max(8, Math.min(18, contentWidth - fixed));

	// Header
	const header = `  ${padRight("MODEL", nameW)}  ${padLeft("TOKENS", tokW)}  ${padLeft("SPEND", spendW)}  ${padRight("SHARE", shareBarW + pctW + 1)}`;
	lines.push(truncateToWidth(theme.fg("dim", theme.bold(header)), maxWidth));
	lines.push(
		truncateToWidth(
			theme.fg(
				"dim",
				`  ${"─".repeat(Math.min(contentWidth - 2, nameW + tokW + spendW + shareBarW + pctW + 8))}`,
			),
			maxWidth,
		),
	);

	const totalSpend = Math.max(0, usage.spendUsd ?? 0);
	const totalTok = Math.max(0, usage.totalTokens);

	for (const m of usage.byModel) {
		const name = shortModelName(m.model);
		const tok = m.promptTokens + m.completionTokens;
		const spendStr = m.spendUsd !== null ? formatUsd(m.spendUsd) : "—";
		let sharePct = 0;
		if (m.spendUsd !== null && totalSpend > 0)
			sharePct = (m.spendUsd / totalSpend) * 100;
		else if (totalTok > 0) sharePct = (tok / totalTok) * 100;
		const cachePct =
			m.promptTokens > 0
				? Math.round((m.cachedPromptTokens / m.promptTokens) * 100)
				: 0;

		let shareColor: "accent" | "success" | "dim" = "dim";
		if (sharePct >= 50) shareColor = "accent";
		else if (sharePct >= 20) shareColor = "success";
		const shareBar = fillBar(sharePct, shareBarW, theme, shareColor);
		const pctLabel = theme.fg("dim", padLeft(`${Math.round(sharePct)}%`, pctW));

		// Row 1: columns
		lines.push(
			truncateToWidth(
				`  ${theme.fg("accent", theme.bold(padRight(name, nameW)))}  ${padLeft(formatTokens(tok), tokW)}  ${padLeft(spendStr, spendW)}  ${shareBar}${pctLabel}`,
				maxWidth,
			),
		);

		// Row 2: in/out + cache %
		const detail = `in ${formatTokens(m.promptTokens)}  out ${formatTokens(m.completionTokens)}  cache ${cachePct}%`;
		lines.push(
			truncateToWidth(
				`  ${"".padEnd(nameW)}  ${theme.fg("dim", detail)}`,
				maxWidth,
			),
		);
		lines.push(""); // breathing room between models
	}

	// drop trailing blank
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

export function renderAccountTab(
	snap: FireworksQuotaSnapshot,
	maxWidth: number,
	theme: Theme,
): string[] {
	const lines: string[] = [""];
	lines.push(
		truncateToWidth(`  ${theme.fg("accent", theme.bold("Account"))}`, maxWidth),
	);
	lines.push(labelValue("Email", snap.account.email || "—", maxWidth, theme));
	lines.push(labelValue("ID", snap.account.id, maxWidth, theme));
	lines.push(labelValue("State", snap.account.state || "—", maxWidth, theme));
	lines.push("");
	lines.push(
		truncateToWidth(`  ${theme.fg("accent", theme.bold("API key"))}`, maxWidth),
	);
	lines.push(labelValue("Key", snap.keyTail, maxWidth, theme));
	lines.push("");
	lines.push(
		truncateToWidth(
			`  ${theme.fg("accent", theme.bold("Rate limit"))}`,
			maxWidth,
		),
	);
	lines.push(
		labelValue(
			"Serverless",
			snap.serverlessRpmMax !== null
				? `${snap.serverlessRpmMax.toLocaleString()} RPM max`
				: "unavailable",
			maxWidth,
			theme,
		),
	);
	return lines;
}

import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { QuotasComponent } from "../extensions/components/quotas-display";
import { renderModelsTab } from "../extensions/components/quota-tabs";
import type { UsagePeriod } from "../src/format";
import type { FireworksQuotaSnapshot, PeriodUsage } from "../src/types";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => `\x1b[7m${text}\x1b[0m`,
	bold: (text: string) => text,
} as unknown as Theme;

function usage(period: UsagePeriod): PeriodUsage {
	return {
		period,
		rangeStart: "2026-10-01",
		rangeEnd: "2026-10-21",
		totalTokens: 10,
		spendUsd: 1,
		promptTokens: 8,
		completionTokens: 2,
		cachedPromptTokens: 3,
		uncachedPromptTokens: 5,
		byModel: [{
			model: `${period}-model`,
			promptTokens: 8,
			completionTokens: 2,
			cachedPromptTokens: 3,
			uncachedPromptTokens: 5,
			spendUsd: 1,
		}],
	};
}

function snapshot(): FireworksQuotaSnapshot {
	return {
		accountName: "accounts/test",
		account: { id: "test", email: "test@example.invalid", state: "READY" },
		keyTail: "…abcd",
		balanceUsd: 10,
		monthBudgetUsd: 20,
		serverlessRpmMax: 10,
		models: { month: usage("month") },
	};
}

type PeriodResult = PeriodUsage | { error: string };

function pendingPeriod() {
	let resolve!: (result: PeriodResult) => void;
	const promise = new Promise<PeriodResult>((done) => { resolve = done; });
	return { promise, resolve };
}

function component(
	onEnsurePeriod: (period: UsagePeriod) => Promise<PeriodResult> = async (period) => usage(period),
): QuotasComponent {
	return new QuotasComponent(theme, { requestRender() {} }, () => {}, () => {}, onEnsurePeriod);
}

function assertSelected(panel: QuotasComponent, label: string): void {
	assert.ok(panel.render(156).some((line) => line.includes(`\x1b[7m ${label} `)), `${label} should be selected`);
}

function openModels(panel: QuotasComponent): void {
	panel.handleInput("\t");
	panel.handleInput("\t");
	assertSelected(panel, "Models");
}

describe("quota panel widths", () => {
	for (const width of [1, 4, 20, 32, 40, 80, 156]) {
		it(`fits loading, errors, and every tab at width ${width}`, () => {
			const panel = component();
			const assertFits = () => {
				for (const line of panel.render(width)) {
					assert.ok(visibleWidth(line) <= width, `line exceeds ${width} columns: ${line}`);
				}
			};
			try {
				assertFits();
				panel.setState({ type: "error", message: "long error ".repeat(20) });
				assertFits();
				for (const empty of [false, true]) {
					const snap = snapshot();
					if (empty) snap.models.month.byModel = [];
					panel.setState({ type: "loaded", snap });
					for (let tab = 0; tab < 4; tab++) {
						assertFits();
						panel.handleInput("\t");
					}
				}
			} finally {
				panel.destroy();
			}
		});
	}

	it("renders a populated Models table at the smallest content width", () => {
		for (const line of renderModelsTab(usage("month"), "month", 1, 4, theme)) {
			assert.ok(visibleWidth(line) <= 4);
		}
	});
});

describe("quota terminal key encodings", () => {
	for (const key of ["\t", "\x1b[9u"]) {
		it(`switches tabs with ${JSON.stringify(key)}`, () => {
			const panel = component();
			try {
				panel.setState({ type: "loaded", snap: snapshot() });
				assert.equal(panel.handleInput(key), true);
				assertSelected(panel, "Tokens");
			} finally { panel.destroy(); }
		});
	}
	for (const key of ["\x1b[Z", "\x1b[9;2u"]) {
		it(`switches tabs backwards with ${JSON.stringify(key)}`, () => {
			const panel = component();
			try {
				panel.setState({ type: "loaded", snap: snapshot() });
				assert.equal(panel.handleInput(key), true);
				assertSelected(panel, "Account");
			} finally { panel.destroy(); }
		});
	}
	for (const [key, selected] of [
		["\x1b[C", "Today"], ["\x1bOC", "Today"], ["\x1b[1;1C", "Today"],
		["\x1b[D", "Week"], ["\x1bOD", "Week"], ["\x1b[1;1D", "Week"],
	]) {
		it(`selects ${selected} with ${JSON.stringify(key)}`, () => {
			const panel = component();
			try {
				const snap = snapshot();
				snap.models.today = usage("today");
				snap.models.week = usage("week");
				panel.setState({ type: "loaded", snap });
				openModels(panel);
				assert.equal(panel.handleInput(key), true);
				assertSelected(panel, selected);
			} finally { panel.destroy(); }
		});
	}
});

describe("quota period state", () => {
	it("clears a failed Week error when selecting cached Month", async () => {
		const panel = component(async () => ({ error: "WEEK-FAILED" }));
		try {
			panel.setState({ type: "loaded", snap: snapshot() });
			openModels(panel);
			panel.handleInput("\x1b[D");
			await setImmediate();
			assert.ok(panel.render(156).join("\n").includes("WEEK-FAILED"));
			panel.handleInput("\x1b[C");
			const output = panel.render(156).join("\n");
			assertSelected(panel, "Month");
			assert.ok(!output.includes("WEEK-FAILED"));
			assert.ok(output.includes("month-model"));
		} finally { panel.destroy(); }
	});

	it("ignores a late Week error after selecting cached Month", async () => {
		const pending = pendingPeriod();
		const panel = component(() => pending.promise);
		try {
			panel.setState({ type: "loaded", snap: snapshot() });
			openModels(panel);
			panel.handleInput("\x1b[D");
			panel.handleInput("\x1b[C");
			pending.resolve({ error: "LATE-WEEK-ERROR" });
			await setImmediate();
			const output = panel.render(156).join("\n");
			assert.ok(!output.includes("LATE-WEEK-ERROR"));
			assert.ok(output.includes("month-model"));
		} finally { panel.destroy(); }
	});

	it("finishes a shared in-flight request after revisiting its period", async () => {
		const pending = pendingPeriod();
		const panel = component(() => pending.promise);
		try {
			panel.setState({ type: "loaded", snap: snapshot() });
			openModels(panel);
			panel.handleInput("\x1b[D");
			panel.handleInput("\x1b[C");
			panel.handleInput("\x1b[D");
			pending.resolve(usage("week"));
			await setImmediate();
			assertSelected(panel, "Week");
			const output = panel.render(156).join("\n");
			assert.ok(output.includes("week-model"));
			assert.ok(!output.includes("Loading period"));
		} finally { panel.destroy(); }
	});
});

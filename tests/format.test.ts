import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatRangeLabel,
	formatTokens,
	formatUsd,
	keyTail,
	moneyToNumber,
	periodRangeUtc,
	severityFromPercent,
} from "../src/format";
import { normModelLabel } from "../src/fireworks-grpc";

describe("formatUsd", () => {
	it("formats normal amounts to 2 decimals", () => {
		assert.equal(formatUsd(12.5), "$12.50");
		assert.equal(formatUsd(0), "$0.00");
		assert.equal(formatUsd(1.006), "$1.01"); // rounds up (toFixed)
		assert.equal(formatUsd(1.004), "$1.00"); // rounds down
	});
	it("shows <$0.01 for tiny positive amounts", () => {
		assert.equal(formatUsd(0.004), "<$0.01");
		assert.equal(formatUsd(0.009), "<$0.01");
	});
	it("does not collapse zero or >= $0.01", () => {
		assert.equal(formatUsd(0), "$0.00");
		assert.equal(formatUsd(0.01), "$0.01");
	});
});

describe("formatTokens", () => {
	it("formats billions with 2 decimals", () => {
		assert.equal(formatTokens(1_500_000_000), "1.50B");
		assert.equal(formatTokens(1_000_000_000), "1.00B");
	});
	it("formats millions with 1 decimal", () => {
		assert.equal(formatTokens(2_500_000), "2.5M");
		assert.equal(formatTokens(1_000_000), "1.0M");
	});
	it("formats thousands with 1 decimal", () => {
		assert.equal(formatTokens(12_300), "12.3K");
		assert.equal(formatTokens(1_000), "1.0K");
	});
	it("formats small numbers with locale separators", () => {
		assert.equal(formatTokens(999), "999");
		assert.equal(formatTokens(0), "0");
	});
	it("respects boundaries (just under a threshold)", () => {
		assert.equal(formatTokens(999), "999"); // just under 1K stays raw
	});
});

describe("keyTail", () => {
	it("returns short keys unchanged", () => {
		assert.equal(keyTail("abc"), "abc");
		assert.equal(keyTail("abcdef"), "abcdef");
	});
	it("masks long keys to last 4 with ellipsis", () => {
		assert.equal(keyTail("fw-1234567890abcd"), "…abcd");
		assert.equal(keyTail("abcdefg"), "…defg");
	});
});

describe("moneyToNumber", () => {
	it("returns undefined for null/undefined", () => {
		assert.equal(moneyToNumber(null), undefined);
		assert.equal(moneyToNumber(undefined), undefined);
	});
	it("combines units and nanos", () => {
		assert.equal(moneyToNumber({ units: "5", nanos: "500000000" }), 5.5);
		assert.equal(moneyToNumber({ units: 2, nanos: 0 }), 2);
	});
	it("handles numeric-string units", () => {
		assert.equal(moneyToNumber({ units: "10" }), 10);
	});
	it("returns undefined for non-finite values", () => {
		assert.equal(moneyToNumber({ units: "abc" }), undefined);
		assert.equal(moneyToNumber({ units: "1", nanos: "xyz" }), undefined);
	});
	it("treats missing fields as zero", () => {
		assert.equal(moneyToNumber({}), 0);
		assert.equal(moneyToNumber({ nanos: "1000000000" }), 1);
	});
});

describe("severityFromPercent", () => {
	it("error at <= 10%", () => {
		assert.equal(severityFromPercent(0), "error");
		assert.equal(severityFromPercent(10), "error");
	});
	it("warning at 11–25%", () => {
		assert.equal(severityFromPercent(11), "warning");
		assert.equal(severityFromPercent(25), "warning");
	});
	it("success above 25%", () => {
		assert.equal(severityFromPercent(26), "success");
		assert.equal(severityFromPercent(100), "success");
	});
});

describe("periodRangeUtc", () => {
	// fixed reference: 2026-07-15 12:00 UTC (a Wednesday)
	const now = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));

	it("today: start of today → start of tomorrow (exclusive)", () => {
		const r = periodRangeUtc("today", now);
		assert.equal(r.startIso, "2026-07-15");
		assert.equal(r.endIso, "2026-07-16");
	});
	it("week: 7-day window ending today", () => {
		const r = periodRangeUtc("week", now);
		assert.equal(r.startIso, "2026-07-09"); // d-6
		assert.equal(r.endIso, "2026-07-16");
	});
	it("month: first of month → start of tomorrow", () => {
		const r = periodRangeUtc("month", now);
		assert.equal(r.startIso, "2026-07-01");
		assert.equal(r.endIso, "2026-07-16");
	});
	it("week crossing a month boundary", () => {
		const r = periodRangeUtc("week", new Date(Date.UTC(2026, 7, 2, 12)));
		assert.equal(r.startIso, "2026-07-27");
		assert.equal(r.endIso, "2026-08-03");
	});
});

describe("formatRangeLabel", () => {
	it("collapses single-day ranges", () => {
		// start==end after subtracting exclusive end → single label
		assert.equal(formatRangeLabel("2026-07-15", "2026-07-16"), "2026-07-15");
	});
	it("shows start → inclusive end for multi-day ranges", () => {
		assert.equal(
			formatRangeLabel("2026-07-01", "2026-07-16"),
			"2026-07-01 → 2026-07-15",
		);
	});
});

describe("normModelLabel", () => {
	it("strips the org prefix and lowercases", () => {
		assert.equal(
			normModelLabel("accounts/fireworks/models/Llama-3-70B"),
			"llama370b",
		);
	});
	it("drops the v before a version digit (llama-v3 → llama3)", () => {
		assert.equal(
			normModelLabel("accounts/fireworks/models/llama-v3-8b-instruct"),
			"llama38b",
		);
	});
	it("drops p before a digit (5p2 → 52)", () => {
		assert.equal(
			normModelLabel("accounts/fireworks/models/mixtral-8x7b"),
			"mixtral8x7b",
		);
	});
	it("strips trailing instruct/chat/code suffix", () => {
		assert.equal(
			normModelLabel(
				"accounts/fireworks/models/deepseek-coder-v2-lite-instruct",
			),
			"deepseekcoder2lite",
		);
	});
	it("removes non-alphanumeric separators", () => {
		assert.equal(normModelLabel("qwen-2.5-72b"), "qwen2572b");
	});
});

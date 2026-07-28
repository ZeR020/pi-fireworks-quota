import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fetchFireworksQuota, fetchPeriodUsage } from "../src/fireworks-api";

let key: string;
try {
	const auth = JSON.parse(
		readFileSync(join(homedir(), ".pi/agent/auth.json"), "utf8"),
	) as { fireworks?: { key?: string } };
	key = auth.fireworks?.key || process.env.FIREWORKS_API_KEY || "";
} catch (err) {
	console.error("auth.json:", err instanceof Error ? err.message : err);
	process.exit(1);
}
if (!key) {
	console.error("No fireworks key");
	process.exit(1);
}

const t0 = Date.now();
const result = await fetchFireworksQuota(key);
const t1 = Date.now();
if (!result.success) {
	console.error("FAIL", result.error);
	process.exit(1);
}
const d = result.data;
console.error(
	"OK open",
	t1 - t0,
	"ms",
	"bal",
	d.balanceUsd,
	"month$",
	d.models.month.spendUsd,
	"periods",
	Object.keys(d.models).join(","),
);

const t2 = Date.now();
const today = await fetchPeriodUsage(key, d.accountName, "today");
const t3 = Date.now();
if (!today.success) {
	console.error("FAIL today", today.error);
	process.exit(1);
}
console.error("OK lazy today", t3 - t2, "ms", "tok", today.data.totalTokens);

// second open should skip ListAccounts
const t4 = Date.now();
const again = await fetchFireworksQuota(key);
const t5 = Date.now();
if (!again.success) {
	console.error("FAIL refresh", again.error);
	process.exit(1);
}
console.error("OK refresh", t5 - t4, "ms");

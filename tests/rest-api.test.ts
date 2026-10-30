import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { createServer, type Server } from "node:http";

const calls: Array<{ url: string; auth?: string }> = [];
let responder:
	| ((url: string) => { status?: number; body: unknown } | undefined)
	| undefined;

const server: Server = createServer((req, res) => {
	const url = req.url ?? "/";
	calls.push({ url, auth: req.headers.authorization });
	const r = responder?.(url);
	if (!r) {
		res.writeHead(500, { "content-type": "application/json" });
		res.end(JSON.stringify({ message: `no stub for ${url}` }));
		return;
	}
	res.writeHead(r.status ?? 200, { "content-type": "application/json" });
	res.end(JSON.stringify(r.body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
assert.ok(addr && typeof addr === "object");
process.env.FIREWORKS_API_BASE = `http://127.0.0.1:${addr.port}`;

const {
	fetchQuotas,
	fetchSpendUsd,
	fetchTokenUsage,
	resolveAccount,
} = await import("../src/fireworks-rest");

after(() => {
	server.close();
});
afterEach(() => {
	calls.length = 0;
	responder = undefined;
});

const range = {
	start: new Date("2026-10-01T00:00:00Z"),
	end: new Date("2026-10-31T00:00:00Z"),
	startIso: "2026-10-01",
	endIso: "2026-10-31",
};

describe("rest control plane", () => {
	it("resolves the account via GET /v1/accounts with Bearer auth", async () => {
		responder = () => ({
			body: {
				accounts: [
					{ name: "accounts/test-acc", email: "a@b.c", state: "READY" },
				],
			},
		});
		const acc = await resolveAccount("fw_key_111111");
		assert.equal(acc.name, "accounts/test-acc");
		assert.equal(acc.id, "test-acc");
		assert.equal(acc.email, "a@b.c");
		assert.equal(calls[0]?.url, "/v1/accounts");
		assert.equal(calls[0]?.auth, "Bearer fw_key_111111");
	});

	it("sums daily billingUsage buckets per model", async () => {
		responder = (url) => {
			assert.ok(url.includes("/billingUsage"));
			assert.ok(url.includes("usageType=SERVERLESS"));
			assert.ok(url.includes("groupBy=model_name"));
			return {
				body: {
					serverlessCosts: [
						{
							modelName: "accounts/fireworks/models/glm-5p3",
							group: {
								model_name: "accounts/fireworks/models/glm-5p3",
							},
							promptTokens: "100",
							completionTokens: "10",
							cachedPromptTokens: "5",
							uncachedPromptTokens: "95",
						},
						{
							modelName: "accounts/fireworks/models/glm-5p3",
							promptTokens: "50",
							completionTokens: "5",
							cachedPromptTokens: "0",
							uncachedPromptTokens: "50",
						},
					],
				},
			};
		};
		const usage = await fetchTokenUsage(
			"fw_key_222222",
			"accounts/test-acc",
			range,
		);
		assert.equal(usage.byModel.length, 1);
		assert.equal(usage.promptTokens, 150);
		assert.equal(usage.completionTokens, 15);
		assert.equal(usage.cachedPromptTokens, 5);
		assert.equal(usage.totalTokens, 165);
	});

	it("follows quota pageToken pagination", async () => {
		responder = (url) =>
			url.includes("pageToken=t2")
				? {
						body: {
							quotas: [
								{
									name: "accounts/test-acc/quotas/b",
									value: "5",
									maxValue: "9",
									usage: 1,
								},
							],
						},
					}
				: {
						body: {
							quotas: [
								{
									name: "accounts/test-acc/quotas/a",
									value: "100",
									maxValue: "200",
									usage: 3,
								},
							],
							nextPageToken: "t2",
						},
					};
		const quotas = await fetchQuotas("fw_key_333333", "accounts/test-acc");
		assert.equal(quotas.size, 2);
		assert.deepEqual(quotas.get("a"), { usage: 3, value: 100, max: 200 });
		assert.deepEqual(quotas.get("b"), { usage: 1, value: 5, max: 9 });
	});

	it("prefers model_bucket rows in billing summary", async () => {
		responder = () => ({
			body: {
				lineItems: [
					{
						groupingKey: "model_bucket",
						groupingValue: "GLM 5.3",
						totalCost: { units: "0", nanos: 594773920 },
					},
					{
						groupingKey: "rollup",
						groupingValue: "total",
						totalCost: { units: "1", nanos: 0 },
					},
				],
			},
		});
		const spend = await fetchSpendUsd(
			"fw_key_444444",
			"accounts/test-acc",
			range,
		);
		assert.equal(spend.totalUsd, 0.594773920);
		assert.deepEqual([...spend.byModel.keys()], ["GLM 5.3"]);
	});

	it("maps empty gateway error bodies to an HTTP message", async () => {
		responder = () => ({ status: 500, body: { code: 13, message: "" } });
		await assert.rejects(
			resolveAccount("fw_key_555555"),
			/Fireworks API error \(HTTP 500\)/,
		);
	});

	it("marks 4xx errors as permanent", async () => {
		responder = () => ({ status: 403, body: { code: 7, message: "" } });
		await assert.rejects(
			resolveAccount("fw_key_666666"),
			(err: Error & { permanent?: boolean }) => err.permanent === true,
		);
	});
});

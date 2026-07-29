import { join } from "node:path";
import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { fetchFireworksQuota, fetchPeriodUsage } from "../src/fireworks-api";
import type { UsagePeriod } from "../src/format";
import type { PeriodUsage } from "../src/types";
import { QuotasComponent } from "./components/quotas-display";

export function registerQuotasCommand(pi: ExtensionAPI): void {
	pi.registerCommand("fireworks:quota", {
		description: "Display Fireworks AI balance, spend, tokens, and limits",
		handler: async (_args, ctx) => {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider("fireworks");
			if (!apiKey) {
				const authPath = join(getAgentDir(), "auth.json");
				ctx.ui.notify(
					`Fireworks quota requires an API key. Add credentials to ${authPath} or set FIREWORKS_API_KEY.`,
					"warning",
				);
				return;
			}
			const key = apiKey;

			const result = await ctx.ui.custom<null>((tui, theme, _kb, done) => {
				let controller = new AbortController();
				let fetchGen = 0;
				let accountName = "";
				// In-flight/done period fetches — background prefetch makes tab switches instant.
				const periodCache = new Map<
					UsagePeriod,
					Promise<PeriodUsage | { error: string }>
				>();

				const ensurePeriod = (
					period: UsagePeriod,
				): Promise<PeriodUsage | { error: string }> => {
					const pending = periodCache.get(period);
					if (pending) return pending;
					const promise = (async (): Promise<
						PeriodUsage | { error: string }
					> => {
						if (!accountName) return { error: "No account resolved" };
						const out = await fetchPeriodUsage(
							key,
							accountName,
							period,
							controller.signal,
						);
						if (!out.success) return { error: out.error.message };
						return out.data;
					})();
					periodCache.set(period, promise);
					return promise;
				};

				const component = new QuotasComponent(
					theme,
					tui,
					() => {
						controller.abort();
						done(null);
					},
					() => {
						controller.abort();
						controller = new AbortController();
						periodCache.clear();
						component.setState({ type: "loading" });
						tui.requestRender();
						void load();
					},
					ensurePeriod,
				);

				async function load(): Promise<void> {
					const gen = ++fetchGen;
					const out = await fetchFireworksQuota(key, controller.signal);
					if (gen !== fetchGen || controller.signal.aborted) return;
					if (out.success) {
						accountName = out.data.accountName;
						component.setState({ type: "loaded", snap: out.data });
						// Prefetch remaining periods so Models ←/→ is instant.
						void ensurePeriod("today");
						void ensurePeriod("week");
					} else {
						component.setState({
							type: "error",
							message: out.error.message,
						});
					}
					tui.requestRender();
				}

				void load();

				return {
					render: (width: number) => component.render(width),
					invalidate: () => component.invalidate(),
					handleInput: (data: string) => component.handleInput(data),
					dispose: () => {
						controller.abort();
						component.destroy();
					},
				};
			});

			if (result === undefined) {
				const out = await fetchFireworksQuota(key);
				ctx.ui.notify(
					out.success
						? JSON.stringify(out.data, null, 2)
						: JSON.stringify({ error: out.error.message }),
					out.success ? "info" : "error",
				);
			}
		},
	});
}

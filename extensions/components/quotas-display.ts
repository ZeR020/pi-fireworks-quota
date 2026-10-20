import type { Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Loader, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { USAGE_PERIODS, type UsagePeriod } from "../../src/format";
import type { FireworksQuotaSnapshot, PeriodUsage } from "../../src/types";
import {
	renderAccountTab,
	renderBalanceTab,
	renderModelsTab,
	renderTokensTab,
} from "./quota-tabs";

type TuiHost = { requestRender: () => void };

type QuotasState =
	| { type: "loading" }
	| { type: "error"; message: string }
	| { type: "loaded"; snap: FireworksQuotaSnapshot };

const TABS = ["Balance", "Tokens", "Models", "Account"] as const;
const MODELS_TAB = 2;

export class QuotasComponent {
	private state: QuotasState = { type: "loading" };
	private loader: Loader | null = null;
	private activeTab = 0;
	private modelsPeriodIdx = 2; // month
	private periodLoading: UsagePeriod | null = null;
	private periodError: string | null = null;
	private periodFetchGen = 0;

	constructor(
		private theme: Theme,
		private tui: TuiHost,
		private onClose: () => void,
		private onRefetch: () => void,
		/** Lazy-load today/week when user switches Models period. */
		private onEnsurePeriod: (
			period: UsagePeriod,
		) => Promise<PeriodUsage | { error: string }>,
	) {
		this.startLoader();
	}

	private startLoader(): void {
		this.loader = new Loader(
			this.tui as never,
			(s: string) => this.theme.fg("accent", s),
			(s: string) => this.theme.fg("muted", s),
			"Fetching Fireworks quota...",
		);
	}

	destroy(): void {
		this.loader?.stop();
		this.loader = null;
	}

	setState(state: QuotasState): void {
		if (state.type === "loading") {
			this.loader?.stop();
			this.startLoader();
			this.activeTab = 0;
			this.modelsPeriodIdx = 2;
			this.periodLoading = null;
			this.periodError = null;
			this.periodFetchGen++;
		} else if (this.state.type === "loading") {
			this.loader?.stop();
			this.loader = null;
		}
		this.state = state;
	}

	private currentPeriod(): UsagePeriod {
		return USAGE_PERIODS[this.modelsPeriodIdx];
	}

	private ensureCurrentPeriod(): void {
		if (this.state.type !== "loaded") return;
		const period = this.currentPeriod();
		if (this.periodLoading === period) return;

		const gen = ++this.periodFetchGen;
		this.periodLoading = null;
		this.periodError = null;
		if (this.state.snap.models[period]) return;
		this.periodLoading = period;
		this.tui.requestRender();

		void this.onEnsurePeriod(period).then((result) => {
			if (gen !== this.periodFetchGen) return;
			this.periodLoading = null;
			if (this.state.type !== "loaded") return;
			if ("error" in result) {
				this.periodError = result.error;
			} else {
				this.periodError = null;
				this.state = {
					type: "loaded",
					snap: {
						...this.state.snap,
						models: { ...this.state.snap.models, [period]: result },
					},
				};
			}
			this.tui.requestRender();
		});
	}

	handleInput(data: string): boolean {
		if (matchesKey(data, "escape") || data === "q") {
			this.onClose();
			return true;
		}
		if (data === "r") {
			this.onRefetch();
			return true;
		}
		if (matchesKey(data, "tab")) {
			this.activeTab = (this.activeTab + 1) % TABS.length;
			if (this.activeTab === MODELS_TAB) this.ensureCurrentPeriod();
			return true;
		}
		if (matchesKey(data, "shift+tab")) {
			this.activeTab = (this.activeTab - 1 + TABS.length) % TABS.length;
			if (this.activeTab === MODELS_TAB) this.ensureCurrentPeriod();
			return true;
		}
		if (this.activeTab === MODELS_TAB) {
			if (matchesKey(data, "right")) {
				this.modelsPeriodIdx =
					(this.modelsPeriodIdx + 1) % USAGE_PERIODS.length;
				this.ensureCurrentPeriod();
				return true;
			}
			if (matchesKey(data, "left")) {
				this.modelsPeriodIdx =
					(this.modelsPeriodIdx - 1 + USAGE_PERIODS.length) %
					USAGE_PERIODS.length;
				this.ensureCurrentPeriod();
				return true;
			}
		}
		return false;
	}

	render(width: number): string[] {
		const border = new DynamicBorder((s: string) => this.theme.fg("border", s));
		const contentWidth = Math.max(1, width - 4);
		const lines: string[] = [
			...border.render(width),
			truncateToWidth(
				` ${this.theme.fg("accent", this.theme.bold("Fireworks API Quota"))}`,
				width,
			),
		];

		if (this.state.type === "loading") {
			lines.push(
				...(this.loader?.render(width) ?? [
					this.theme.fg("muted", "  Fetching Fireworks quota..."),
				]),
			);
		} else if (this.state.type === "error") {
			lines.push(
				...wrapTextWithAnsi(
					this.theme.fg("error", `  ${this.state.message}`),
					width,
				),
			);
		} else {
			lines.push(...this.renderLoaded(this.state.snap, contentWidth, width));
		}

		const hints = ["r refresh", "q/Esc close", "Tab switch"];
		if (this.activeTab === MODELS_TAB) hints.push("←/→ period");
		lines.push("");
		lines.push(this.theme.fg("dim", `  ${hints.join("  ")}`));
		lines.push(...border.render(width));
		return lines.map((line) => truncateToWidth(line, width));
	}

	private renderLoaded(
		snap: FireworksQuotaSnapshot,
		contentWidth: number,
		maxWidth: number,
	): string[] {
		const lines: string[] = [""];
		const tabParts = TABS.map((label, idx) => {
			const full = ` ${label} `;
			return idx === this.activeTab
				? this.theme.bg(
						"selectedBg",
						this.theme.fg("accent", this.theme.bold(full)),
					)
				: this.theme.fg("dim", full);
		});
		lines.push(truncateToWidth(`  ${tabParts.join("  ")}`, maxWidth));

		const period = this.currentPeriod();
		const loading = this.periodLoading === period && !snap.models[period];

		let body: string[];
		if (this.activeTab === 0) {
			body = renderBalanceTab(snap, contentWidth, maxWidth, this.theme);
		} else if (this.activeTab === 1) {
			body = renderTokensTab(snap, maxWidth, this.theme);
		} else if (this.activeTab === 2) {
			body = renderModelsTab(
				snap.models[period],
				period,
				contentWidth,
				maxWidth,
				this.theme,
				loading,
				this.periodError,
			);
		} else {
			body = renderAccountTab(snap, maxWidth, this.theme);
		}
		lines.push(...body);
		return lines;
	}

	invalidate(): void {}
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { QuotasComponent } from "../extensions/components/quotas-display";
import { renderModelsTab } from "../extensions/components/quota-tabs";

const theme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
} as unknown as Theme;

const LONG_ERROR =
	"failed to fetch data: failed to query billing records: error fetching query job result: googleapi: Error 403: Quota exceeded: Your project_and_region exceeded quota for max number of jobs that can be queued per project. For more information, see https://cloud.google.com/bigquery/docs/troubleshoot-quotas, quotaExceeded";

const WIDTH = 156;

function assertFits(lines: string[], width: number): void {
	for (const line of lines) {
		assert.ok(
			visibleWidth(line) <= width,
			`line width ${visibleWidth(line)} > ${width}: ${line.slice(0, 80)}`,
		);
	}
}

describe("quota overlay error lines fit the terminal", () => {
	it("wraps a long fetch error in the overlay", () => {
		const component = new QuotasComponent(
			theme,
			{ requestRender: () => {} },
			() => {},
			() => {},
			async () => ({ error: "unused" }),
		);
		try {
			component.setState({ type: "error", message: LONG_ERROR });
			assertFits(component.render(WIDTH), WIDTH);
		} finally {
			component.destroy();
		}
	});

	it("wraps a long Models-tab period error", () => {
		assertFits(
			renderModelsTab(
				undefined,
				"month",
				WIDTH - 4,
				WIDTH,
				theme,
				false,
				LONG_ERROR,
			),
			WIDTH,
		);
	});
});

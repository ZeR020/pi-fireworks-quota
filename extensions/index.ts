import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerQuotasCommand } from "./command";

export default function (pi: ExtensionAPI) {
	registerQuotasCommand(pi);
}

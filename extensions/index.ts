import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { warmup } from "../src/fireworks-grpc";
import { registerQuotasCommand } from "./command";

export default function (pi: ExtensionAPI) {
	registerQuotasCommand(pi);
	void warmup(); // background: TLS+H2 handshake done before /fireworks:quota runs
}

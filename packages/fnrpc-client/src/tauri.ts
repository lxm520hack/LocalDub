import { observable } from "./UntypedClient";
import type { ExecuteArgs } from "./types";

export function tauriExecute() {
	return (args: ExecuteArgs) =>
		observable((subscriber) => {
			import("@tauri-apps/api/core")
				.then(({ invoke }) =>
					invoke("rpc_fn", { method: args.path, input: args.input }),
				)
				.then((value) => subscriber.next({ code: 200, value }))
				.catch((err) => subscriber.next({ code: 500, value: String(err) }))
				.finally(() => subscriber.complete());
		});
}

import { observable } from "./UntypedClient";
import type { ExecuteArgs, ExeceuteData, ExecuteFn } from "./types";

export function tauriExecute(): ExecuteFn {
	return (args: ExecuteArgs) =>
		observable<ExeceuteData>((subscriber) => {
			import("@tauri-apps/api/core")
				.then(({ invoke }) =>
					invoke("rpc_fn", { path: args.path, input: args.input ?? null }),
				)
				.then((value) => subscriber.next({ code: 200, value }))
				.catch((err) => {
					console.error('[fnrpc] tauri invoke error:', err);
					subscriber.next({ code: 500, value: String(err) });
				})
				.finally(() => subscriber.complete());
		});
}

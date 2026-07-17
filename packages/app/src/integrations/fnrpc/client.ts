import { createClient, fetchTransport, tauriTransport } from "@fnrpc/client";
import { createSolidQueryHooks } from "@fnrpc/solid-query";
import type { Procedures } from "./bindings";
import { __procedureKinds } from "./bindings";
import { QueryClient } from "@tanstack/solid-query";

const transport = (() => {
	try {
		return isTauriEnv()
			? tauriTransport(() => import("@tauri-apps/api/core"))
			: fetchTransport({ url: "http://localhost:19110/fnrpc" });
	} catch {
		return fetchTransport({ url: "http://localhost:19110/fnrpc" });
	}
})();

function isTauriEnv(): boolean {
	try {
		return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
	} catch {
		return false;
	}
}

export const client = createClient<Procedures>(
	transport,
	__procedureKinds,
);

const queryClient = new QueryClient();

export const fnrpc = createSolidQueryHooks({
	client,
	queryClient,
});

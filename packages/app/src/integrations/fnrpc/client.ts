import { createClient, fetchExecute, tauriExecute } from "@fnrpc/client";
import type { Procedures } from "./bindings";

const isTauri =
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const client = createClient<Procedures>(
	isTauri ? tauriExecute() : fetchExecute({ url: "http://localhost:19110/fnrpc" }),
);
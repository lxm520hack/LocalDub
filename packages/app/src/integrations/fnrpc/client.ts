import { createClient, fetchExecute, tauriExecute, ExecuteArgs } from "@fnrpc/client";
import type { Procedures } from "./bindings";
import { isTauri } from "@tauri-apps/api/core";


export const client = createClient<Procedures>(
	isTauri() 
		? tauriExecute() 
		: (args) => fetchExecute({ url: "http://localhost:19110/fnrpc" }, args),
);
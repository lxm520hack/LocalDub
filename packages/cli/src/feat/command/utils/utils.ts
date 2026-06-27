import { startTorchServer } from "../../../ml/server/client";
import { readInputArgs } from "../../input/input";

export async function withTorchServer<T>(
	taskId: string,
	fn: (torchServer: string) => Promise<T>,
): Promise<T> {
	const config = readInputArgs();
	const TORCH_SERVER_PORT = config.torchServer?.port ?? 19109;
	const baseUrl = await startTorchServer(TORCH_SERVER_PORT);
	return await fn(baseUrl);
}
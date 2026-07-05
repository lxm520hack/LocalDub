import { InputArgs } from "@repo/core/input/input";
import { rerunSingleStage } from "../../tasks/pipeline-runner";
import { setCtx } from "@repo/core/context/context";

export const cmdRerunStage = async (input: InputArgs) => {
	const sessionPath = input.task?.sessionPath;
	const stageName = input.task?.stageName;
	if (!sessionPath || !stageName) {
		console.error(
			'rerunStage.sessionPath and rerunStage.stageName required in input.json',
		);
		process.exit(1);
	}
	const ctx = setCtx(sessionPath, { input });
	const taskId = ctx.task.id;
	console.log(`[CLI] Rerunning stage "${stageName}" for task ${taskId}...`);
	try {
		await	rerunSingleStage(ctx),
		console.log('[CLI] Stage completed');
		process.exit(0);
	} catch (err) {
		console.error('[CLI] Stage failed:', err);
		process.exit(1);
	}
}
import { InputArgs } from "../../input/input";
import { readCtx } from "../../context/context";
import { rerunSingleStage } from "../../tasks/pipeline-runner";
import { withTorchServer } from "../utils/utils";

export const cmdRerunStage = async (input: InputArgs) => {
  		const sessionPath = input.task?.sessionPath;
		const stageName = input.task?.stageName;
		if (!sessionPath || !stageName) {
			console.error(
				'rerunStage.sessionPath and rerunStage.stageName required in input.json',
			);
			process.exit(1);
		}
		const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		console.log(`[CLI] Rerunning stage "${stageName}" for task ${taskId}...`);
		try {
			await withTorchServer(taskId, () =>
				rerunSingleStage(ctx, stageName, input.stages),
			);
			console.log('[CLI] Stage completed');
			process.exit(0);
		} catch (err) {
			console.error('[CLI] Stage failed:', err);
			process.exit(1);
		}
}
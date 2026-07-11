import { InputArgs } from "@repo/core/input/input";
import { resumePipeline } from "../../tasks/pipeline-runner";
import { playTaskFail, playTaskSuccess } from "./utils";
import { setCtx } from "@repo/core/context/context";

export const cmdResumeTask = async (input: InputArgs) => {
  const taskDir = input.task?.taskDir;
		if (!taskDir) {
			console.error('task.taskDir required in input.json');
			process.exit(1);
		}
		const ctx =  setCtx(taskDir, {
			input: input,
		});
		const taskId = ctx.task.id;
		const resumeFrom = input.task?.resumeFrom;
		const label = resumeFrom ? ` from "${resumeFrom}"` : '';

		console.log(`[CLI] Resuming pipeline for task ${taskDir}${label}...`);
		try {
			await	resumePipeline(ctx),
			console.log('[CLI] Pipeline completed');
			playTaskSuccess()
			process.exit(0);
		} catch (err) {
			console.error('[CLI] Pipeline failed:', err);
			playTaskFail()
			process.exit(1);
		}
}
import { InputArgs } from "../../input/input";
import { readCtx, setCtx } from "../../context/context";
import { resumePipeline } from "../../tasks/pipeline-runner";
import { withTorchServer } from "../utils/utils";

export const cmdResumeTask = async (input: InputArgs) => {
  const sessionPath = input.task?.sessionPath;
		if (!sessionPath) {
			console.error('task.sessionPath required in input.json');
			process.exit(1);
		}
		const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		const resumeFrom = input.task?.resumeFrom;
		const label = resumeFrom ? ` from "${resumeFrom}"` : '';

		// Allow pipeline switch on resume (e.g. subtitle → dub)
		if (input.pipeline) {
				setCtx(sessionPath, { pipeline: input.pipeline });
		}

		console.log(`[CLI] Resuming pipeline for task ${sessionPath}${label}...`);
		try {
			resumePipeline(ctx),
			console.log('[CLI] Pipeline completed');
			process.exit(0);
		} catch (err) {
			console.error('[CLI] Pipeline failed:', err);
			process.exit(1);
		}
}
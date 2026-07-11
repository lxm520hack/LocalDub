import { InputArgs } from "@repo/core/input/input";
import { readCtx } from "@repo/core/context/context";
import { getStageStatuses } from "@repo/core/stages/utils/utils";

export const cmdTaskStatus = async (input: InputArgs) => {
  const taskDir = input.task?.taskDir!;

		const ctx = await readCtx(taskDir);
		const taskId = ctx.task.id;
		try {
			const status = await getStageStatuses(taskId);
			console.log(JSON.stringify(status, null, 2));
		} catch (err) {
			console.error('taskStatus failed:', err);
			process.exit(1);
		}
}
import { InputArgs } from "../../input/input";
import { readCtx } from "../../context/context";
import { getStageStatuses } from "../../stages/utils/utils";

export const cmdTaskStatus = async (input: InputArgs) => {
  const sessionPath = input.task?.sessionPath!;

		const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		try {
			const status = await getStageStatuses(taskId);
			console.log(JSON.stringify(status, null, 2));
		} catch (err) {
			console.error('taskStatus failed:', err);
			process.exit(1);
		}
}
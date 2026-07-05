import { InputArgs } from "@repo/core/input/input";
import { cmdRerunStage } from "@repo/core/cmd/tasks/rerunStage";
import { cmdResumeTask } from "@repo/core/cmd/tasks/resumeTask";
import { cmdStartTask } from "@repo/core/cmd/tasks/startTask";
import { cmdTaskStatus } from "./taskStatus";

export const cmdTask = async (input: InputArgs) => {
  if (input.task.action === 'resume') {
    await cmdResumeTask(input);
  } else if (input.task.action === 'start') {
    await cmdStartTask(input);
  } else if (input.task.action === 'rerunStage') {
    await cmdRerunStage(input);
  } else if (input.task.action === 'status') {
    await cmdTaskStatus(input);
  } else {
    console.error(`Unknown task action: ${input.task.action}`);
  }
}
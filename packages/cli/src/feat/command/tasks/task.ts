import { InputArgs } from "../../config/config";
import { cmdRerunStage } from "./rerunStage";
import { cmdResumeTask } from "./resumeTask";
import { cmdStartTask } from "./startTask";
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
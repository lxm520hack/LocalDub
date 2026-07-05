import { invoke } from "#/fn/invoke.ts";
import { GroupInfo } from "@repo/core/cmd/tasks/get_group_list";

export const getGroupList = () => invoke<string>('get_group_list').then(JSON.parse) as Promise<GroupInfo[]>;
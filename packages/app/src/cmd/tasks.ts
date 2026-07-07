import { client } from "#/lib/rspc.ts";
import { GroupInfo } from "@repo/core/cmd/tasks/get_group_list";

export const getGroupList = () => client.query(['getGroupList', null]) as Promise<GroupInfo[]>;
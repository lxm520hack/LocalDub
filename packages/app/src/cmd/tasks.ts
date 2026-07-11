import { client } from "#/integrations/rspc/rspc.ts";
import { GroupInfo } from "@repo/core/cmd/tasks/get_task";

export const getGroupList = () => client.query(['getGroupList', null]) as Promise<GroupInfo[]>;
import { Context } from "#/integrations/fnrpc/bindings.ts";
import { fnrpc } from "#/integrations/fnrpc/client.ts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui-solid/base/tabs";
import { useParams } from "@tanstack/solid-router";
import { For } from "solid-js";

export const TaskControlPanel = (p:{
  ctx: Context
}) => {
  const params = useParams({from: '/group/$id/$taskId'})
  const taskDirRoot = fnrpc.createQuery(() => ['list_app_directory', `workfolder/${params().id}/${p.ctx.task.id}`]);
  const taskDirRootFiles = () => taskDirRoot.data?.find(f => !f.is_dir ) ?? []
  const taskDirRootDirs = () => taskDirRoot.data?.filter(f => f.is_dir) ?? []
  const stages = () => p.ctx.stages ?? []
  const tabs = () => ["root", ...stages().map(s => s.name)]
  
  return <div class="w-125 min-w-40 border-r flex   text-muted-foreground text-sm">
    <Tabs defaultValue="root" class="" orientation="vertical">
      <TabsList class="">
        <For each={tabs()}>{(tab) => (
          <TabsTrigger value={tab} class="w-full">{tab}</TabsTrigger>
        )}</For>
      </TabsList>
      
    </Tabs>
    任务控制 — 开发中
  </div>
}
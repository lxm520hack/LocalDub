import type { Context } from "#/integrations/fnrpc/bindings.ts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui-solid/base/tabs";
import { useParams } from "@tanstack/solid-router";
import { For } from "solid-js";
import { FileTree } from "./FileTree";

export const TaskControlPanel = (p: {
  ctx: Context;
  onOpenFile: (name: string, path: string) => void;
}) => {
  const params = useParams({from: '/group/$id/$taskId'});
  const taskDir = `workfolder/${params().id}/${p.ctx.task.id}`;
  const stages = () => p.ctx.stages ?? [];
  const tabs = () => ["root", ...stages().map(s => s.name)];

  return (
    <div class="w-100 min-w-40 border-r flex text-muted-foreground text-sm overflow-hidden">
      <Tabs defaultValue="root" class="w-full" orientation="vertical">
        <TabsList class="w-full">
          <For each={tabs()}>{(tab) => (
            <TabsTrigger value={tab} class="w-full justify-start">{tab}</TabsTrigger>
          )}</For>
        </TabsList>

        <For each={tabs()}>{(tab) => (
          <TabsContent value={tab} class="overflow-auto p-0">
            <FileTree
              relativeDir={tab === 'root' ? taskDir : `${taskDir}/${tab}`}
              onOpenFile={p.onOpenFile}
            />
          </TabsContent>
        )}</For>
      </Tabs>
    </div>
  );
};

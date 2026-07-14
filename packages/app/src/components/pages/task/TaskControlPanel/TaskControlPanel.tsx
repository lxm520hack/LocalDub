import { Context } from "#/integrations/fnrpc/bindings.ts";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui-solid/base/tabs";
import { For } from "solid-js";

export const TaskControlPanel = (p:{
  ctx: Context
}) => {
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
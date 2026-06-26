import { ClientOnly } from "@tanstack/solid-router";
import { Code, Keyboard, Monitor, Palette, Settings, Server } from "lucide-solid";
import { type Component } from "solid-js";
import { Tabs, TabsContent, TabsIndicator, TabsList, TabsTrigger } from "@repo/ui-solid/base/tabs";
import { m} from "@repo/shared/i18n/paraglide/messages";
import { Modal } from "@repo/ui-solid/custom/modal/modal";
import type { JSX } from "solid-js";
import { openModal } from "@repo/ui-solid/custom/modal/renderer";
import { GeneralSettings } from "./general";
import { ServerManager } from "./ServerManager";
import { DeviceInfo } from "./DeviceInfo";
import { useClientApi } from "../api/context";
import { InputEditor } from "./InputEditor";

export const SettingsContent = () => {
  const { serversManagerApi, inputEditorApi } = useClientApi();
  const baseItems = [
    {
      value: 'general',
      label: m.general(),
      icon: Settings,
    },
    {
      value: 'shortcuts',
      label: m.shortcuts(),
      icon: Keyboard,
    },
    ...(serversManagerApi ? [{ value: 'servers', label: 'Servers', icon: Server as typeof Settings, content: ServerManager as Component }] : []),
    { value: 'device', label: 'Device', icon: Monitor as typeof Settings, content: DeviceInfo as Component },
    ...(inputEditorApi ? [{ value: 'config', label: 'Config', icon: Code as typeof Settings, content: InputEditor as Component }] : []),
  ];
  return <ClientOnly>
    <Tabs defaultValue="general" orientation='vertical' class='gap-5 h-full' >
      <TabsList class="mb-4" variant='side'>
        {baseItems.map((item) => (
          <TabsTrigger value={item.value} class="gap-2">
            <item.icon size={16} /> {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="general">
        <GeneralSettings />
      </TabsContent>
      <TabsContent value="shortcuts">
        <h2>{m.shortcuts()}</h2>
      </TabsContent>
      {serversManagerApi && (
        <TabsContent value="servers">
          <ServerManager />
        </TabsContent>
      )}
      <TabsContent value="device">
        <DeviceInfo />
      </TabsContent>
      {inputEditorApi && (
        <TabsContent value="config">
          <InputEditor />
        </TabsContent>
      )}
    </Tabs>
  </ClientOnly>
}

export const openSettings = () => openModal(SettingsContent, { size: '5xl', class: 'p-4' })

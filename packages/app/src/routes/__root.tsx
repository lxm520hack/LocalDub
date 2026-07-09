import { SidebarProvider } from '@repo/ui-solid/base/sidebar';
import { ThemeProvider, themeScript } from '@repo/ui-solid/theme';
import { HeadContent, Outlet, Scripts, createRootRoute, useParams, useRouteContext, useRouter, useRouterState } from '@tanstack/solid-router';
import { AppSidebar, ClientApiProvider } from '@repo/ui';
import { ModalRenderer } from '@repo/ui-solid/custom/modal/renderer';
import { Toaster } from '@repo/ui-solid/base/sonner';
import type { JSX } from 'solid-js';
import styleCss from '../styles.css?url'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Devtools } from '@repo/ui-solid/app/devtools';
import * as torchApi from '../feat/servers/servers';
// import * as deviceApi from '../feat/env/device';
import * as inputApi from '../fn/input';
import { getLocale } from '@repo/shared/i18n/utils';
import { getGroupList } from '#/cmd/tasks.ts';
import { Header } from '#/components/app/header/Header.tsx';
import { client as rspcClient, rspc,  RspcClient } from '#/integrations/rspc/rspc.ts';
import { Procedures, ProceduresLegacy } from '#/integrations/rspc/bindings.ts';
import { client, fnrpc } from '#/integrations/fnrpc/client.ts';
import { createSolidQueryHooks } from '#/integrations/rspc/query.tsx';
import { getQueryClient } from '@repo/ui-solid/tanstack-query/provider';
import { isTauri } from '@tauri-apps/api/core';
interface MyRouterContext {
	queryClient: QueryClient;
  client: RspcClient
}

export const Route = createRootRoute<MyRouterContext>({
  head: () => ({
    title: 'LocalDub',
    meta: [{
      name: 'viewport',
      content: 'width=device-width, initial-scale=1',
    }],
    links: [{ rel: 'stylesheet', href: styleCss }],
    scripts: [{ children: themeScript }],
	}),
  beforeLoad: async () => {
    if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('lang', getLocale());
		}
    if (!isTauri()) document.documentElement.classList.add('browser')
  },
  shellComponent: RootComponent,
});
function RootComponent() {
  return (
    <RootDocument >
			<Outlet />
    </RootDocument>
  )
}
function RootDocument({ children }: { children: JSX.Element }) {
  const queryClient = getQueryClient();
  return <>
  <HeadContent />
  <fnrpc.Provider client={client} queryClient={queryClient}>
  <rspc.Provider client={rspcClient} queryClient={queryClient}>
  <ClientApiProvider value={{
    serversManagerApi: {
      startTorch: torchApi.startTorch,
      stopTorch: torchApi.stopTorch,
      restartTorch: torchApi.restartTorch,
      checkTorch: torchApi.checkTorch,
      startVoxCpm: torchApi.startVoxCpm,
      stopVoxCpm: torchApi.stopVoxCpm,
      restartVoxCpm: torchApi.restartVoxCpm,
      get_voxcpm_torch_gradio_status: torchApi.get_voxcpm_torch_gradio_status,
    },
    // deviceInfoApi: {
    //   // fetchDeviceInfo: deviceApi.fetchDeviceInfo,
    // },
    inputEditorApi: {
      readInput: inputApi.readInput,
      writeInput: inputApi.writeInput,
      readInputSchema: inputApi.readInputSchema,
    },
    taskApi: {
      getGroupList
    }
  }}>
    <ThemeProvider>
      <SidebarProvider>
        <AppSidebar />
        <div class="w-full h-screen grid grid-rows-[auto_1fr]">
          <Header />
          {children}
          <ModalRenderer />
          <Toaster duration={1000 * 10} />
        </div>
      </SidebarProvider>
    </ThemeProvider>
  </ClientApiProvider>
  </rspc.Provider>
  </fnrpc.Provider>
  <Devtools />
  <Scripts />
  </>
}
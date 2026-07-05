import { SidebarProvider } from '@repo/ui-solid/base/sidebar';
import { ThemeProvider, themeScript } from '@repo/ui-solid/theme';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/solid-router';
import { AppSidebar, ClientApiProvider } from '@repo/ui';
import { ModalRenderer } from '@repo/ui-solid/custom/modal/renderer';
import { Toaster } from '@repo/ui-solid/base/sonner';
import type { JSX } from 'solid-js';
import styleCss from '../styles.css?url'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Devtools } from '@repo/ui-solid/app/devtools';
import * as torchApi from '../fn/servers';
import * as deviceApi from '../fn/device';
import * as inputApi from '../fn/input';
import { Header } from '@repo/ui/app/header/Header';
import { getLocale } from '@repo/shared/i18n/utils';
import { getGroupList } from '#/cmd/tasks.ts';
interface MyRouterContext {
	queryClient: QueryClient;
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
  return <>
  <HeadContent />
  <ClientApiProvider value={{
    serversManagerApi: {
      startTorch: torchApi.startTorch,
      stopTorch: torchApi.stopTorch,
      restartTorch: torchApi.restartTorch,
      checkTorch: torchApi.checkTorch,
      startVoxCpm: torchApi.startVoxCpm,
      stopVoxCpm: torchApi.stopVoxCpm,
      restartVoxCpm: torchApi.restartVoxCpm,
      checkVoxCpm: torchApi.checkVoxCpm,
    },
    deviceInfoApi: {
      fetchDeviceInfo: deviceApi.fetchDeviceInfo,
    },
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
  <Devtools />
  <Scripts />
  </>
}
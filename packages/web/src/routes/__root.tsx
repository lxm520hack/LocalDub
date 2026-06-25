import { SidebarProvider } from '@repo/ui-solid/base/sidebar';
import { ThemeProvider, themeScript } from '@repo/ui-solid/theme';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/solid-router';
import { AppSidebar } from '../components/app/AppSidebar';
import { ModalRenderer } from '@repo/ui-solid/custom/modal/renderer';
import { Toaster } from '@repo/ui-solid/base/sonner';
import type { JSX } from 'solid-js';
import {
	getLocale,
} from '@repo/shared/i18n/paraglide/runtime.js';
import { HydrationScript } from 'solid-js/web';
import styleCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
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
  return <html lang={getLocale()}>
          <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body class="h-svh">
            <ThemeProvider>
<SidebarProvider>
  <AppSidebar />
    <div class="w-full h-screen grid grid-rows-[auto_1fr]">
      {children}
      <ModalRenderer />
      <Toaster duration={1000 * 10} />
    </div>
  
</SidebarProvider>
    </ThemeProvider>
        <Scripts />
      </body>
  </html>
}
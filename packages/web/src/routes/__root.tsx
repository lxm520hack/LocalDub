import { SidebarProvider } from '@repo/ui-solid/base/sidebar';
import { ThemeProvider, themeScript } from '@repo/ui-solid/theme';
import { Outlet, createRootRoute } from '@tanstack/solid-router';
import { AppSidebar } from '../components/app/AppSidebar';
import { ModalRenderer } from '@repo/ui-solid/custom/modal/renderer';
import { Toaster } from '@repo/ui-solid/base/sonner';

export const Route = createRootRoute({
  head: () => ({

		scripts: [{ children: themeScript }],
	}),
  component: () => (
    <ThemeProvider>
<SidebarProvider>
  <AppSidebar />
    <div class="w-full h-screen grid grid-rows-[auto_1fr]">
      <Outlet />
      <ModalRenderer />
      <Toaster duration={1000 * 10} />
    </div>
  
</SidebarProvider>
    </ThemeProvider>
  ),
});

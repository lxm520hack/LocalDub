import { ThemeProvider, themeScript } from '@repo/ui-solid/theme';
import { Outlet, createRootRoute } from '@tanstack/solid-router';

export const Route = createRootRoute({
  head: () => ({

		scripts: [{ children: themeScript }],
	}),
  component: () => (
    <ThemeProvider>

    <div class="p-8 max-w-5xl mx-auto">
      <Outlet />
    </div>
    </ThemeProvider>
  ),
});

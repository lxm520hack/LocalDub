import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createRouter, RouterProvider } from '@tanstack/solid-router';
import { render } from 'solid-js/web';
import { getRouter } from './router';
import './styles.css';
import { getQueryClient } from '@repo/ui-solid/tanstack-query/provider';

// Create a new router instance
const router = getRouter();

const rootElement = document.getElementById('app')!;

if (!rootElement?.innerHTML) {
	render(
		() => (
			<QueryClientProvider client={getQueryClient()}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		),
		rootElement,
	);
}

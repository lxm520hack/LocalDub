import { createFileRoute } from '@tanstack/solid-router';
import { IndexPage } from '@repo/ui';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

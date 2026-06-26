import { createFileRoute } from '@tanstack/solid-router';
import { TorchServer } from '@repo/ui';
import * as api from './-fn/torch';

export const Route = createFileRoute('/server/torch')({
  component: () => <TorchServer {...api} sseUrl="http://127.0.0.1:19109/api/events" />,
});

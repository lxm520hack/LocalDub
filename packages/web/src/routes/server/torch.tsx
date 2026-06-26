import { createFileRoute } from '@tanstack/solid-router';
import { TorchServer } from '@repo/ui';
import * as api from './-fn/torch';

export const Route = createFileRoute('/server/torch')({
  component: () => <TorchServer {...api} sseUrl="/torch_server/api/events" />,
});

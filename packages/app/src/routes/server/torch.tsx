import { createFileRoute } from '@tanstack/solid-router';
import { TorchServer } from './-comp/TorchServer';

export const Route = createFileRoute('/server/torch')({
  component: TorchServer,
});

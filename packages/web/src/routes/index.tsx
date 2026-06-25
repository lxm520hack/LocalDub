import { createFileRoute } from '@tanstack/solid-router';
import { Dashboard } from '../components/pages/Dashboard';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

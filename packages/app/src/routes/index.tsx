import { IndexPage } from '#/components/pages/home/IndexPage.tsx';
import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/')({
  beforeLoad: async ({ router }) => {
    if (typeof window !== 'undefined') {
      const last = localStorage.getItem('localdub_last_task');
      if (last) {
        try {
          const { groupId, taskId } = JSON.parse(last);
          await router.navigate({ to: '/group/$groupId/$taskId', params: { groupId, taskId } });
        } catch {
          localStorage.removeItem('localdub_last_task');
        }
      }
    }
  },
  component: IndexPage,
});

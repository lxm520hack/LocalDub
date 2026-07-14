import { IndexPage } from '#/components/pages/home/IndexPage.tsx';
import { createFileRoute, redirect } from '@tanstack/solid-router';

export const Route = createFileRoute('/')({
  beforeLoad:  () => {
    if (typeof window !== 'undefined') {
      const last = localStorage.getItem('localdub_last_task');
      if (last) {
        try {
          const { groupId, taskId } = JSON.parse(last);
          throw redirect({ to: '/group/$id/$taskId', params: { id: groupId, taskId } });
        } catch {
          localStorage.removeItem('localdub_last_task');
        }
      }
    }
  },
  component: IndexPage,
});

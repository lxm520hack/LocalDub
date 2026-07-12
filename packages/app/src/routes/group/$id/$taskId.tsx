import { createFileRoute, useParams } from '@tanstack/solid-router'
import { onMount } from 'solid-js'
import { TaskDetailPage } from '../../../components/pages/task/TaskDetailPage'

export const Route = createFileRoute('/group/$id/$taskId')({
  component: RouteComponent,
})

function RouteComponent() {
  const p = useParams({ from: '/group/$id/$taskId' })
  onMount(() => {
    localStorage.setItem('localdub_last_task', JSON.stringify({
      groupId: p().id,
      taskId: p().taskId,
    }))
  })
  return <TaskDetailPage groupId={p().id} taskId={p().taskId} />
}

import { createFileRoute, useParams } from '@tanstack/solid-router'
import { TaskDetailPage } from '../../../components/pages/task/TaskDetailPage'

export const Route = createFileRoute('/group/$id/$taskId')({
  component: RouteComponent,
})

function RouteComponent() {
  const p = useParams({ from: '/group/$id/$taskId' })
  return <TaskDetailPage groupId={p().id} taskId={p().taskId} />
}

import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/group/$id/$taskId')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/group/$id/$taskId"!</div>
}

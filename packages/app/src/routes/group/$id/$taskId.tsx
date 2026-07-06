import { createFileRoute, useParams } from '@tanstack/solid-router'

export const Route = createFileRoute('/group/$id/$taskId')({
  component: RouteComponent,
})

function RouteComponent() {
  // const p = Route.useParams()
  const p = useParams({ from: '/group/$id/$taskId' })
  const p1 = useParams({ strict: false })
  return <div>Hello "/group/$id/$taskId"!</div>
}

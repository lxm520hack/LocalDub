import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/group/$id/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/group/$id/"!</div>
}

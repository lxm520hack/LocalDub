import { createServerFn } from '@tanstack/solid-start'

export const getServerTime = createServerFn().handler(async () => {
  // This runs only on the server
  return new Date().toISOString()
})
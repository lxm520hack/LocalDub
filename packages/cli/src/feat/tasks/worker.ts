type Runner = (taskId: string) => Promise<void> | void

let queue: string[] = []
let running = false
let runnerFn: Runner | null = null

export function enqueue(taskId: string) {
  queue.push(taskId)
  processNext()
}

export function start(runner: Runner) {
  runnerFn = runner
}

async function processNext() {
  if (running || queue.length === 0 || !runnerFn) return
  running = true
  const taskId = queue.shift()!
  try {
    await runnerFn(taskId)
  } catch (err) {
    console.error(`[Worker] Task ${taskId} failed:`, err)
  }
  running = false
  processNext()
}

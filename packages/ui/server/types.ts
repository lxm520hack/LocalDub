export interface TorchStatus {
	running: boolean
	uptime_s: number
	models: Record<string, boolean>
}

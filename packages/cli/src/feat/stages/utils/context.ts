let currentStage = 'system';
let currentTaskId = '';

export function setStage(name: string) {
	currentStage = name;
}

export function stage(): string {
	return currentStage;
}

export function setTaskId(id: string) {
	currentTaskId = id;
}

export function getTaskId(): string {
	return currentTaskId;
}

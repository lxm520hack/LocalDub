let currentStage = 'system';

export function setStage(name: string) {
	currentStage = name;
}

export function stage(): string {
	return currentStage;
}

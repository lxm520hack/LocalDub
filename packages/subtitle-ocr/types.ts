export interface OCRLine {
	text: string;
	confidence: number;
	box: number[][];
}
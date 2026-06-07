export type TargetLang =
	| 'en'
	| 'zh'
	| 'vi'
	| 'ja'
	| 'ko'
	| 'fr'
	| 'de'
	| 'es'
	| 'pt'
	| 'ru'
	| 'ar'
	| 'hi'
	| 'th'
	| 'id'
	| 'ms'
	| 'tl'
	| 'my'
	| 'km'
	| 'lo'
	| 'mn'
	| 'ne'
	| 'ur'
	| 'bn';

export interface TTSEngineConfig {
	runtime: 'ort' | 'pytorch' | 'cloud';
	device: 'cpu' | 'cuda' | 'mps' | 'webgpu';
}

export interface ASREngineConfig {
	runtime: 'faster-whisper' | 'pytorch';
	device: 'cpu' | 'cuda' | 'mps';
}

export interface TranslateEngineConfig {
	apiBase: string;
	model: string;
}

export interface SeparateEngineConfig {
	runtime: 'ort' | 'pytorch';
	device: 'cpu' | 'cuda' | 'mps' | 'webgpu';
}

export interface StagesConfig {
	translate: {
		targetLang: TargetLang;
	};
	merge_video: {
		fontSize: number;
		marginV: number;
	};
}

/**
 * 对应 config.json
 */
export interface RawConfig {
	stages?: StagesConfig;
}

export interface TasksConfig {
	tts: TTSEngineConfig;
	asr: ASREngineConfig;
	translate: TranslateEngineConfig;
	separate: SeparateEngineConfig;
}

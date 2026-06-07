/** Options shared by all TTS backends */
export interface TTSGenerateOptions {
  text: string;
  referenceWavPath: string;
  cfgValue?: number;
  maxPatches?: number;
  /** Original-language transcription of the reference audio (used by cloud backend for voice cloning quality) */
  promptText?: string;
}

/** Result from TTSBackend.generate() — includes timing breakdown */
export interface TTSGenerateResult {
  samples: Float32Array;
  /** seconds spent loading model (in subprocess for python; 0 for onnx-node since load() handles it) */
  loadTimeSec: number;
  /** seconds spent in pure inference (generation only) */
  genTimeSec: number;
}

/** Backend-agnostic TTS engine interface */
export interface TTSBackend {
  readonly name: string;
  load(): Promise<void>;
  generate(options: TTSGenerateOptions): Promise<TTSGenerateResult>;
  dispose(): Promise<void>;
}

export enum VoxCPMBackend {
  ORT = 'ort',
  PYTORCH = 'pytorch',
  CLOUD = 'cloud',
}

export interface VoxCPMNodeConfig {
  modelDir?: string;
  executionProvider?: 'cpu' | 'webgpu';
}

export interface VoxCPMPythonConfig {
  modelDir?: string;
  python?: string;
}

export interface VoxCPMCloudConfig {
  apiUrl?: string;
  /** For text-only synthesis without reference audio */
  controlInstruction?: string;
  /** API key for api.modelbest.cn/v1 (optional) */
  apiKey?: string;
}

export type VoxCPMConfig = VoxCPMNodeConfig | VoxCPMPythonConfig | VoxCPMCloudConfig;

export interface ModelStatus {
  exists: boolean;
  isReady: boolean;
  size?: string;
  missingFiles: string[];
}

import { z } from 'zod';

const targetLangList = [
	'en',
	'zh',
	'vi', // 越南语
	'ja',
	'ko',
	'fr',
	'de',
	'es',
	'pt',
	'ru',
	'ar',
	'hi',
	'th',
	'id',
	'ms',
	'tl',
	'my',
	'km',
	'lo',
	'mn',
	'ne',
	'ur',
	'bn',
] as const;
export type TargetLang = (typeof targetLangList)[number];

const deviceList = ['cpu', 'cuda', 'mps', 'webgpu'] as const;
export type Device = (typeof deviceList)[number];
export const commandList = [
	'startTask', // 开始任务
	'resumeTask', // 继续任务
	'rerunStage', // 重新运行某个步骤
	'check',
	'taskStatus', // 显示某任务状态
	'createTask', // 创建任务(完成后会自动开始任务)
	'deviceInfo', // 显示设备信息
	'daemon', // 启动守护进程
	'daemonStatus', // 显示守护进程状态
	'daemonStop', // 停止守护进程
	'listModels', // 列出 openai 兼容端点的 可用模型
] as const;
export type Command = (typeof commandList)[number];
// 各 command 的参数
const stagesList = [
	'download',
	'separate',
	'separate_after',
	'asr',
	'asr_fix',
	'ocr',
	'ocr_fix',
	'asr_ocr',
	'translate',
	'split_audio',
	'tts',
	'merge_audio',
	'merge_video',
] as const;
export type StageName = (typeof stagesList)[number];

const SeparateConfigSchema = z.object({
		runtime: z.enum(['ggml', 'ort', 'pytorch']),
		device: z
			.enum(['vulkan', 'webgpu', 'cuda', 'cpu', 'mps'])
			.default('cuda')
			.describe('cuda (NVIDIA/ROCm), mps (Apple Silicon)'),
		always: z
			.boolean()
			.default(false)
			.describe(
				'效果(默认关闭): subtitle 模式下也始终分离人声，保留 vocals 以便后续切换到 dub; dub 流程下始终 需要分离人声以 保证 tts-vc 的质量',
			)
			.optional(),
		stems: z
			.array(z.enum(['drums', 'bass', 'other', 'vocals']))
			.default(['vocals'])
			.describe('需分离的 stems; 默认只分离 vocals, 目前仅支持 ort').optional(),
	})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
	})
	.optional()
	.describe(`separate: demucs 分离人声与背景声, 提示 tts-vc 的质量 
		input: media/video_source.mp4
			output: media/target_3_vocals.wav 用于 ASR + TTS reference
						media/target_bgm.wav  用于 MergeVideo 背景
	`);
export type SeparateConfig = z.infer<typeof SeparateConfigSchema>;

const ASRConfigSchema = z
	.looseObject({
		runtime: z.enum(['ggml','faster-whisper', 'pytorch', ]).default('pytorch'),
		device: z.enum(['vulkan', 'cuda', 'cpu', 'mps']).default('cuda'),
		useSeparated: z
			.boolean()
			.default(false)
			.describe('使用分离后的人声 (target_3_vocals.wav) 而非原始视频音频')
			.optional(),
		mixMode: z
			.enum(['vocals', 'raw-sum', 'sidechain'])
			.default('sidechain')
			.describe(`ASR 音频源: vocals=纯分离人声, 
				raw-sum=人声+降低背景音直接叠加, 
				sidechain=人声+侧链压缩背景音`)
			.optional(),
		reduceBgm: z
			.number()
			.default(-12)
			.describe('背景音降低量(dB); raw-sum 时叠加前直接衰减, sidechain 时压缩后额外衰减')
			.optional(),
		wordsOutput: z
			.boolean()
			.default(false)
			.describe('是否在 asr.json 中包含词级时间戳 (words), 分离场景下可能受幻觉影响；默认关闭，调试时开启')
			.optional(),
		sidechainCompress: z
			.object({
				threshold: z.number().default(0.1).describe('压缩器阈值, 默认 0.1'),
				ratio: z.number().default(20).describe('压缩比, 默认 20'),
				attack: z.number().default(1).describe('attack 时间(ms), 默认 1'),
				release: z.number().default(200).describe('release 时间(ms), 默认 200'),
			})
			.default({
				threshold: 0.1,
				ratio: 20,
				attack: 1,
				release: 200,
			})
			.describe('mixMode=sidechain 时侧链压缩器参数')
			.optional(),
		useGate: z
			.boolean()
			.default(false)
			.describe('对分离后的人声应用 silence gate 过滤静音段噪声')
			.optional(),
		vocalAudioPath: z.string().optional().describe('ASR 输入的人声音频路径, 调试使用'),
		// whisper.cpp specific params (ignored by other runtimes)
		vad: z.boolean().default(false).optional().describe('whisper.cpp: 启用 VAD'),
		vadModel: z.enum(['silero-v5', 'silero-v6']).optional().describe('whisper.cpp: VAD 模型, silero-v5 (默认) 或 silero-v6'),
		vadThreshold: z.number().min(0).max(1).default(0.5).optional().describe('whisper.cpp: VAD 阈值, 默认 0.5'),
		noSpeechThold: z.number().min(0).default(0.6).optional().describe('whisper.cpp: no-speech 阈值, 默认 0.6'),
		temperature: z.number().min(0).max(2).default(0.0).optional().describe('whisper.cpp: 解码温度, 默认 0.0'),
		maxLen: z.number().int().min(0).default(0).optional().describe('whisper.cpp: 最大段长(字符), 0=不限'),
		splitOnWord: z.boolean().default(false).optional().describe('whisper.cpp: 按词边界分割'),
	})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
		useSeparated: false,
		mixMode: 'sidechain',
		reduceBgm: -12,
		wordsOutput: false,
		sidechainCompress: { threshold: 0.1, ratio: 20, attack: 1, release: 200 },
		useGate: false,
	})
	.optional();

export type ASRConfig = z.output<typeof ASRConfigSchema>;
const OcrConfigSchema = z
	.looseObject({
		fps: z
			.number()
			.default(2)
			.describe('帧率 (fps), 越高时间戳越准但越慢; 默认 2')
			.optional(),
		textScore: z
			.number()
			.default(0.45)
			.describe('OCR 识别置信度阈值, 默认 0.45')
			.optional(),
		subtitleOnly: z
			.boolean()
			.default(true)
			.describe('只识别字幕区域 (Y轴裁剪); 默认 true')
			.optional(),
	})
	.default({ fps: 2, textScore: 0.45, subtitleOnly: true })
	.optional();
export type OcrConfig = z.output<typeof OcrConfigSchema>;
const TranslateConfigSchema = z
	.looseObject({
		apiBase: z.string().optional(),
		model: z.string().optional(),
		targetLang: z
			.enum(targetLangList)
			.optional()
			.describe('如果不填则 按照这个逻辑: 源语言: zh -> en, 否则 any -> zh'), //
		enabled: z
			.boolean()
			.optional()
			.describe('设为 false 跳过翻译，直接使用原始识别文本'),
	})
	.optional();

const TTSConfigSchema = z.object({
		runtime: z.enum(['ggml', 'pytorch', 'ort', 'cloud']).default('pytorch').optional(),
		device: z.enum(['webgpu', 'cuda', 'rocm', 'cpu', 'mps']).default('cuda').optional(),
		skipExisting: z.boolean().default(true).optional(),
	})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
		skipExisting: true,
	})
	.optional().describe(`input: 1. metadata/translation.{lang}.json: translation[i].dst
		2. segments/vocals/{0001..N}.wav
		output: segments/tts/{0001..N}.wav`);
export type TTSConfig = z.output<typeof TTSConfigSchema>;

const SplitAudioConfigSchema = z
	.looseObject({
		vadAlign: z
			.boolean()
			.default(false)
			.describe('是否启用静音检测对齐: 修正 segments 前后静音导致的偏移').optional(),
		vocalsFilePath: z.string().optional().describe('人声文件路径, 调试使用'),
		sourceFilePath: z.string().optional().describe('原始视频音频路径, 调试使用'),
	})
	.default({
		vadAlign: false,

	})
	.optional();

const alignmentList = [
	'bottom-left',
	'bottom-center',
	'bottom-right',
	'middle-left',
	'center',
	'middle-right',
	'top-left',
	'top-center',
	'top-right',
] as const;
type Alignment = (typeof alignmentList)[number];
const AlignmentSchema = z.enum(alignmentList).default('bottom-center');

const ALIGNMENT_MAP: Record<Alignment, number> = {
	'bottom-left': 1,
	'bottom-center': 2,
	'bottom-right': 3,
	'middle-left': 4,
	center: 5,
	'middle-right': 6,
	'top-left': 7,
	'top-center': 8,
	'top-right': 9,
};
export function alignmentToFfmpeg(alignment: Alignment): number {
	return ALIGNMENT_MAP[alignment] ?? 2;
}
const MergeVideoSchema = z
	.object({
		fontSize: z
			.number()
			.min(1)
			.max(200)
			.nullish()
			.describe(
				'字幕字号，不填则自动: 竖屏: 12(zh) / 9(其他) ← 横屏: 24(zh) / 18(其他)',
			),
		marginV: z
			.number()
			.min(0)
			.nullish()
			.describe('垂直边距(像素)，不填则自动: 竖屏 70 / 横屏 5'),
		alignment: AlignmentSchema.optional(),
		outline: z.number().min(0).default(0).optional(),
		shadow: z.number().min(0).default(1).optional(),
		font: z
			.string()
			.optional()
			.describe('ASS 字幕字体名（须系统已安装），默认 Noto Sans CJK SC'),
		srtPath: z.string().optional().describe('调试使用'),
		bgmPath: z.string().optional().describe('调试使用'),
		bgmGain: z.number().min(0).default(14).optional().describe('背景音乐增益(dB), 0=不变'),
	})
	.default({
		alignment: 'bottom-center',
		outline: 0,
		shadow: 1,
		bgmGain: 14,
	})
	.optional();

export type MergeVideoConfig = z.output<typeof MergeVideoSchema>;

const StagesSchema = z.object({
	download: z.object({}).optional(),
	separate: SeparateConfigSchema,
	asr: ASRConfigSchema,
	asr_fix: z
		.looseObject({
			llmFix: z
				.boolean()
				.default(false)
				.describe('是否启用 LLM ASR 纠错（通过本地 LLM API 修正错别字）').optional(),
			segmentPad: z
				.boolean()
				.default(true)
				.describe('是否对 ASR 段落添加时间轴 padding').optional(),
			llmModel: z
				.string()
				.default('gemma4:31b-cloud')
				.optional()
				.describe('LLM 模型名，默认 gemma4:31b-cloud'),
			llmApiBase: z
				.string()
				.default('http://localhost:11434/v1')
				.optional()
				.describe('LLM API 地址，默认 ollama'),
			domainHint: z
				.string()
				.optional()
				.describe('领域提示，帮助 LLM 理解上下文，例如"仙侠题材，角色：叶白、慧天、夜白"'),
			asrFilePath: z.string().optional().describe('ASR 结果文件路径, 调试使用'),
		})
		.default({
			llmFix: false,
			segmentPad: true,
		})
		.optional(),

	ocr: OcrConfigSchema,
	ocr_fix: z
		.looseObject({
			llmFix: z
				.boolean()
				.default(false)
				.describe('是否启用 LLM OCR 纠错').optional(),
			llmModel: z
				.string()
				.default('gemma4:31b-cloud')
				.optional()
				.describe('LLM 模型名'),
			llmApiBase: z
				.string()
				.default('http://localhost:11434/v1')
				.optional()
				.describe('LLM API 地址'),
			domainHint: z
				.string()
				.optional()
				.describe('领域提示'),
		})
		.default({ llmFix: false })
		.optional(),
	translate: TranslateConfigSchema,
	split_audio: SplitAudioConfigSchema,
	tts: TTSConfigSchema,
	merge_audio: z.object({
		maxSpeed: z.number().min(1).default(1.05).optional().describe('TTS 音频最大变速比, 1.0=不变速'),
		maxAdvanceMs: z.number().min(0).default(500).optional().describe('字幕允许提前显示的最大毫秒数, 利用前段剩余时间')
	}).default({
				maxSpeed: 1.05,
				maxAdvanceMs: 500,
	}).optional(),
	merge_video: MergeVideoSchema,
});
type StagesConfigInput = z.input<typeof StagesSchema>;
export type StagesConfig = z.output<typeof StagesSchema>;

const subtitleSourceList = ['asr', 'ocr', 'asr_ocr'] as const;
export type SubtitleSource = (typeof subtitleSourceList)[number];

const BaseConfigSchema = z.looseObject({
	pipeline: z
		.enum(['dub', 'subtitle'])
		.default('dub')
		.optional()
		.describe('任务模式, dub 配音,subtitle 仅字幕'),
	subtitleSource: z
		.enum(subtitleSourceList)
		.default('asr')
		.optional()
		.describe('字幕源: asr (whisper, 默认), ocr (RapidOCR 硬字幕提取), asr_ocr (ASR 时序+OCR 文本融合)'),
	targetStage: z
		.enum(stagesList)
		.optional()
		.describe('目标步骤, pipeline 跑到此步骤后自动停止, 不指定则跑完所有步骤'),
	daemonPort: z.number().default(19109).optional(),
	daemonIdleTimeout: z.number().default(300).optional(),
	stages: StagesSchema.optional(),
});
export type BaseConfigInput = z.input<typeof BaseConfigSchema>;
export type BaseConfig = z.output<typeof BaseConfigSchema>;
const TaskIdSchema = z
	.string()
	.describe(
		'任务 ID (timeId(10) 时间序列 + 程序随机数) \\ 视频id (来自视频app) ',
	);
const TaskSchema = z.looseObject({
	command: z.enum(commandList).describe(`1. createTask: 完成后会自动开始任务
		2. startTask: 直接开始某个已存在的任务 (如之前创建但没有开始的任务)
		3. resumeTask: 继续任务
		4. rerunStage: 重新运行某个步骤
		5. taskStatus: 显示某任务状态
		6. check: 检测某任务的结果 (如视频是否下载成功, ASR 结果是否合理等)
		7. deviceInfo: 显示设备信息
		8. daemon: 启动守护进程
		9. daemonStatus: 显示守护进程状态
		10. daemonStop: 停止守护进程
		11. listModels: 列出 openai 兼容端点的 可用模型
		`),
	createTask: z
		.object({
			url: z.string().optional().describe('本地文件路径或云端文件 url、youtubeUrl、bilibiliUrl'),
			sourceLang: z.string().optional(),
			targetLang: z.enum(targetLangList).optional(),
		})
		.optional(),
	startTask: z
		.object({
			sessionPath: z.string(),
		})
		.optional(),
	resumeTask: z
		.object({
			sessionPath: z.string(),
			resumeFrom: z.enum(stagesList).optional(),
		})
		.optional(),
	rerunStage: z
		.object({
			sessionPath: z.string(),
			stageName: z.enum(stagesList),
		})
		.optional(),
	taskStatus: z
		.object({
			sessionPath: z.string(),
		})
		.optional(),
	check: z
		.object({
			sessionPath: z.string().optional(),
			type: z.enum(['video', 'asr', 'font']).optional().default('video'),
		})
		.optional(),
});

export const ConfigSchema = TaskSchema.and(BaseConfigSchema);
export type RawConfigInput = z.input<typeof ConfigSchema>;
export type RawConfig = z.output<typeof ConfigSchema>;

/** local_info.json — 运行时状态/自动探测层 */
export interface Ctx {
	// ——— 创建时写入，只读 ———
	id: string; // 任务 ID (本地或url) | 视频id (视频平台)
	title?: string;
	source: 'youtube' | 'bilibili' | 'local' | 'remote'
	webpage_url?: string;
	original_path?: string;

	// ——— 运行时读写 ———
	pipeline: 'dub' | 'subtitle';
	lastRunPipeline?: 'dub' | 'subtitle'; // 用于 detect pipeline 切换

	// ——— auto 探测结果 ———
	asr_language?: string; // ASR 自动检测的语言
	target_language?: TargetLang; // translate 阶段写入的目标语言: 如果 config 中没有指定 targetLang 则按照这个逻辑: 源语言: zh -> en, 否则 any -> zh

	// ——— pipeline 启动时快照（readConfig 的有效值） ———
	lastRunConfig?: {
		timestamp: string;
		pipeline: 'dub' | 'subtitle';
		subtitleSource?: 'asr' | 'ocr';
		stages: {
			asr?: { runtime: string; device?: string; useSeparated?: boolean; mixMode?: string; reduceBgm?: number; wordsOutput?: boolean; sidechainCompress?: { threshold?: number; ratio?: number; attack?: number; release?: number }; useGate?: boolean };
			separate?: { runtime: string; device?: string; always?: boolean; stems?: string[] };
			ocr?: { fps?: number; textScore?: number };
			translate?: { apiBase?: string; model?: string; targetLang?: string; enabled?: boolean };
			tts?: { runtime: string; device?: string };
		};
		daemonPort?: number;
	};

	// ——— 各 stage 运行后的详细运行时信息 ———
	runInfo?: {
		asr?: {
			engine: string; // 'whisper-pytorch' | 'faster-whisper'
			device: string;
			computeType?: string;
			gpuAttempted?: boolean;
			fallbackToCpu?: boolean;
		};
		translate?: {
			resolvedDstLang: string;
			actualModel: string;
			apiBase: string;
			batchSize?: number;
		};
	};
}

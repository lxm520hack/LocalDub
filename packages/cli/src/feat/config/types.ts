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
	'asr',
	'asr_fix',
	'translate',
	'split_audio',
	'tts',
	'merge_audio',
	'merge_video',
] as const;
export type StageName = (typeof stagesList)[number];

const SeparateConfigAlways = z
	.boolean()
	.default(false)
	.describe(
		'效果(默认关闭): subtitle 模式下也始终分离人声，保留 vocals 以便后续切换到 dub; dub 流程下始终 需要分离人声以 保证 tts-vc 的质量',
	)
	.optional();
const SeparateConfigSchema = z
	.discriminatedUnion('runtime', [
		z.object({
			runtime: z.literal('pytorch'),
			device: z
				.enum(['cuda', 'cpu', 'mps'])
				.default('cuda')
				.describe('cuda (NVIDIA/ROCm), mps (Apple Silicon)'),
			always: SeparateConfigAlways,
		}),
		z.object({
			runtime: z.literal('ort'),
			device: z.enum(['cuda', 'rocm', 'cpu', 'webgpu']).default('webgpu'),
			always: SeparateConfigAlways,
		}),
	])
	.default({
		runtime: 'pytorch',
		device: 'cuda',
	})
	.optional()
	.describe(`separate: demucs 分离人声与背景声, 提示 tts-vc 的质量 
		input: media/video_source.mp4
		output: media/audio_vocals.wav 用于 ASR + TTS reference
						media/audio_bgm.wav  用于 MergeVideo 背景
	`);
export type SeparateConfig = z.infer<typeof SeparateConfigSchema>;
const ASRConfigSchema = z
	.looseObject({
		runtime: z.enum(['faster-whisper', 'pytorch']).default('pytorch'),
		device: z.enum(['cuda', 'cpu', 'mps']).default('cuda'),
		useSeparated: z
			.boolean()
			.default(false)
			.describe('使用分离后的人声 (audio_vocals.wav) 而非原始视频音频')
			.optional(),
	})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
		useSeparated: false,
	})
	.optional();

export type ASRConfig = z.output<typeof ASRConfigSchema>;
const TranslateConfigSchema = z
	.looseObject({
		apiBase: z.string().optional(),
		model: z.string().optional(),
		targetLang: z
			.enum(targetLangList)
			.optional()
			.describe('如果不填则 按照这个逻辑: 源语言: zh -> en, 否则 any -> zh'), //
	})
	.optional();

const TTSConfigSchema = z
	.discriminatedUnion('runtime', [
		z.object({
			runtime: z.literal('pytorch'),
			device: z.enum(['cuda', 'cpu', 'mps']).default('cuda'),
		}),
		z.object({
			runtime: z
				.literal('ort')
				.describe('预留, 暂时没有正确的 onnx 模型文件支持'),
			device: z.enum(['cuda', 'rocm', 'cpu', 'webgpu']).default('webgpu'),
		}),
		z
			.object({ runtime: z.literal('ggml') })
			.describe('预留 ggml 选项，虽然目前没有实现'),
		z.looseObject({ runtime: z.literal('cloud') }),
	])
	.default({
		runtime: 'pytorch',
		device: 'cuda',
	})
	.optional();
export type TTSConfig = z.output<typeof TTSConfigSchema>;

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
	})
	.default({
		alignment: 'bottom-center',
		outline: 0,
		shadow: 1,
	})
	.optional();

export type MergeVideoConfig = z.output<typeof MergeVideoSchema>;

const StagesSchema = z.object({
	download: z.object({}).optional(),
	separate: SeparateConfigSchema,
	asr: ASRConfigSchema,
	asr_fix: z.object({}).optional(),
	translate: TranslateConfigSchema,
	split_audio: z.object({}).optional(),
	tts: TTSConfigSchema,
	merge_audio: z.object({}).optional(),
	merge_video: MergeVideoSchema,
});
type StagesConfigInput = z.input<typeof StagesSchema>;
export type StagesConfig = z.output<typeof StagesSchema>;
const BaseConfigSchema = z.looseObject({
	pipeline: z
		.enum(['dub', 'subtitle'])
		.default('dub')
		.optional()
		.describe('任务模式, dub 配音,subtitle 仅字幕'),
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
			youtubeUrl: z.url().optional(),
			bilibiliUrl: z.url().optional(),
			sourceFile: z.string().optional().describe('本地文件路径或云端文件 url'),
			sourceLang: z.string().optional(),
			targetLang: z.enum(targetLangList).optional(),
		})
		.optional(),
	startTask: z
		.object({
			taskId: TaskIdSchema,
		})
		.optional(),
	resumeTask: z
		.object({
			taskId: TaskIdSchema,
			resumeFrom: z.enum(stagesList).optional(),
		})
		.optional(),
	rerunStage: z
		.object({
			taskId: TaskIdSchema,
			stageName: z.enum(stagesList),
		})
		.optional(),
	taskStatus: z
		.object({
			taskId: TaskIdSchema,
		})
		.optional(),
	check: z
		.object({
			taskId: TaskIdSchema,
			type: z.enum(['video', 'asr']).optional().default('video'),
		})
		.optional(),
});

export const ConfigSchema = TaskSchema.and(BaseConfigSchema);
export type RawConfigInput = z.input<typeof ConfigSchema>;
export type RawConfig = z.output<typeof ConfigSchema>;

/** local_info.json — 运行时状态/自动探测层 */
export interface LocalInfo {
	// ——— 创建时写入，只读 ———
	id: string; // 任务 ID (本地或url) | 视频id (视频平台)
	title?: string;
	source: 'youtube' | 'bilibili' | 'local';
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
		stages: {
			asr?: { runtime: string; device?: string; useSeparated?: boolean };
			separate?: { runtime: string; device?: string; always?: boolean };
			translate?: { apiBase?: string; model?: string; targetLang?: string };
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

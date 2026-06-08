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
const commandList = [
	'startTask', // 开始任务
	'resumeTask', // 继续任务
	'rerunStage', // 重新运行某个步骤
	'checkVideo',
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
		always: false,
	})
	.optional()
	.describe(`Separate: 分离人声与背景声, 提示 tts-vc 的质量 
		input: media/video_source.mp4
		output: media/audio_vocals.wav 用于 ASR + TTS reference
						media/audio_bgm.wav  用于 MergeVideo 背景
	`);
export type SeparateConfig = z.infer<typeof SeparateConfigSchema>;
const ASRConfigSchema = z
	.looseObject({
		runtime: z.enum(['faster-whisper', 'pytorch']).default('pytorch'),
		device: z.enum(['cuda', 'cpu', 'mps']).default('cuda'),
	})
	.default({
		runtime: 'pytorch',
		device: 'cuda',
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
	daemonPort: z.number().default(19109).optional(),
	daemonIdleTimeout: z.number().default(300).optional(),
	stages: StagesSchema.optional(),
});
export type BaseConfigInput = z.input<typeof BaseConfigSchema>;
export type BaseConfig = z.output<typeof BaseConfigSchema>;

const CreateTaskSchema = z.looseObject({
	command: z.literal('createTask').describe('创建任务(完成后会自动开始任务)'),
	createTask: z.object({
		youtubeUrl: z.url().optional(),
		bilibiliUrl: z.url().optional(),
		sourceFile: z.string().optional().describe('本地文件路径或云端文件 url'),
		sourceLang: z.string().optional(),
		targetLang: z.enum(targetLangList).optional(),
	}),
});
const TaskIdSchema = z
	.string()
	.describe('任务 ID(视频id) timeId(10) 时间序列 + 程序随机数');
const StartTaskSchema = z.looseObject({
	command: z.literal('startTask'),
	startTask: z.object({
		taskId: TaskIdSchema,
	}),
});
const ResumeTaskSchema = z.looseObject({
	command: z.literal('resumeTask').describe('继续任务'),
	resumeTask: z.object({
		taskId: TaskIdSchema,
		resumeFrom: z.enum(stagesList).optional(),
	}),
});
const RerunStageSchema = z.looseObject({
	command: z.literal('rerunStage').describe('重新运行某个步骤'),
	rerunStage: z.object({
		taskId: TaskIdSchema,
		stageName: z.enum(stagesList),
	}),
});
const TaskStatusSchema = z.looseObject({
	command: z.literal('taskStatus').describe('显示某任务状态'),
	taskStatus: z.object({
		taskId: TaskIdSchema,
	}),
});
const CheckVideoSchema = z.looseObject({
	command: z.literal('checkVideo'),
	checkVideo: z.object({
		taskId: TaskIdSchema,
	}),
});
const DeviceInfoSchema = z.looseObject({
	command: z.literal('deviceInfo'),
});
const DaemonSchema = z.looseObject({
	command: z.literal('daemon'),
});
const DaemonStatusSchema = z.looseObject({
	command: z.literal('daemonStatus'),
});
const DaemonStopSchema = z.looseObject({
	command: z.literal('daemonStop'),
});
const ListModelsSchema = z.looseObject({
	command: z.literal('listModels').describe('列出 openai 兼容端点的 可用模型'),
});
export const ConfigSchema = z
	.discriminatedUnion('command', [
		CreateTaskSchema,
		StartTaskSchema,
		ResumeTaskSchema,
		RerunStageSchema,
		TaskStatusSchema,
		CheckVideoSchema,
		DeviceInfoSchema,
		DaemonSchema,
		DaemonStatusSchema,
		DaemonStopSchema,
		ListModelsSchema,
	])
	.and(BaseConfigSchema);
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

	// ❌ 不含 stages — 不再存 config 层数据
}

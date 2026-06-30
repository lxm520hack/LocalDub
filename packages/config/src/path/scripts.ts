import path from "node:path";
import { REPO_ROOT } from "@repo/config/path/root";

export const faster_whisper_py = path.join(		REPO_ROOT,
		'packages',
		'cli',
		'src',
		'ml',
    'whisper',
    'runtime',
		'faster_whisper_py.py',
)
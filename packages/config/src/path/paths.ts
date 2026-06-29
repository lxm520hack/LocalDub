import { join } from 'node:path';
import { env } from '../env.ts';
import { REPO_ROOT } from '../root.ts';



export const WORKFOLDER = env.WORKFOLDER;
export const DATA_DIR = join(REPO_ROOT, 'data');
export const MODEL_CACHE_DIR = env.MODEL_CACHE_DIR;
export const COOKIE_DIR = join(DATA_DIR, 'cookies');
export const YOUTUBE_COOKIE_PATH = join(COOKIE_DIR, 'youtube.txt');
export const LOG_DIR = join(DATA_DIR, 'logs');

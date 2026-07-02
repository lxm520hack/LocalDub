import { timeId } from "@repo/shared/db/timeId";
import { VideoSource } from "@repo/core/context/context";
import { to } from "@repo/shared/lib/utils/try";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/
const BILIBILI_BV_RE = /BV[A-Za-z0-9]{10}/
const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])

function extractYouTubeId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/^\/+/, '')

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const candidate = path.split('/')[0]
    if (YOUTUBE_ID_RE.test(candidate)) return candidate
  }

  if (!host.includes('youtube.com')) return null

  const queryId = parsed.searchParams.get('v') ?? ''
  if (YOUTUBE_ID_RE.test(queryId)) return queryId

  const parts = path.split('/')
  for (const prefix of ['shorts', 'embed', 'live']) {
    if (parts.length >= 2 && parts[0] === prefix && YOUTUBE_ID_RE.test(parts[1])) {
      return parts[1]
    }
  }
  return null
}

function extractBilibiliId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase()
  if (!BILIBILI_HOSTS.has(host)) return null
  const match = BILIBILI_BV_RE.exec(parsed.pathname)
  return match?.[0] ?? null
}

export function extractVideoId(url: string): string {
  const [parsed, err] = to(() => new URL(url.trim())) 
  if (err) {
    // 可能是本地文件路径
     // 本地文件路径 → 取文件名（去掉扩展名）
    const name = url.split('/').pop()?.replace(/\.[^.]+$/, '')
    if (name) return name // todo: 重复性检查
    return timeId({ size: 10 })
  }
  const videoId = extractYouTubeId(parsed) ?? extractBilibiliId(parsed)
  if (videoId) return videoId
  return timeId({ size: 10 })
}

export function isYouTubeUrl(url: string): boolean {
  try {
    return extractYouTubeId(new URL(url.trim())) !== null
  } catch {
    return false
  }
}

export function isBilibiliUrl(url: string): boolean {
  try {
    return extractBilibiliId(new URL(url.trim())) !== null
  } catch {
    return false
  }
}

export async function classifySource(url: string): Promise<VideoSource> {
  if (isYouTubeUrl(url)) return 'youtube';
  if (isBilibiliUrl(url)) return 'bilibili';
  try { if (await Bun.file(url).exists()) return 'local'; } catch {}
  if (/^https?:\/\//.test(url)) return 'remote';
  throw new Error('Unable to classify video source. URL must be a valid YouTube/Bilibili link, an existing local file path, or a remote URL.');
}
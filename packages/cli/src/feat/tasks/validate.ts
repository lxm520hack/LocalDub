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
  const parsed = new URL(url.trim())
  const videoId = extractYouTubeId(parsed) ?? extractBilibiliId(parsed)
  if (videoId) return videoId
  throw new Error('Only YouTube or Bilibili single-video URLs are supported.')
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

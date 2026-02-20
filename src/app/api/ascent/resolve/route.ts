import { NextResponse } from 'next/server'

const WATCH_HOST = 'app.tryascent.gg'
const WATCH_PATH = '/watch'
const CLIPS_PREFIX = '/clips/'
const GO_BASE = 'https://api.ascent.cliffside.gg/go'

type ResolvePayload = {
  url?: string
}

function getVideoId(input: string): string | null {
  try {
    const parsed = new URL(input)
    if (parsed.host !== WATCH_HOST) return null

    if (parsed.pathname === WATCH_PATH) {
      const id = parsed.searchParams.get('v')
      return id && id.trim().length > 0 ? id.trim() : null
    }

    if (parsed.pathname.startsWith(CLIPS_PREFIX)) {
      const clipId = parsed.pathname.slice(CLIPS_PREFIX.length).split('/')[0]?.trim()
      return clipId && clipId.length > 0 ? clipId : null
    }

    return null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ResolvePayload
    const url = body.url?.trim() ?? ''
    const videoId = getVideoId(url)
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid Ascent link.' }, { status: 400 })
    }

    const response = await fetch(`${GO_BASE}/${encodeURIComponent(videoId)}/video`, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'climb-lol/1.0',
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Unable to resolve video link.' }, { status: 400 })
    }

    return NextResponse.json({ url: response.url })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unable to resolve link.' }, { status: 500 })
  }
}

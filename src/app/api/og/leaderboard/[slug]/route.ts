import { ImageResponse } from 'next/og'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'edge'

const SIZE = {
  width: 1200,
  height: 630,
}

const DEFAULT_BG = 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0b1120 100%)'

function formatPlayerName(gameName: string | null, tagLine: string | null) {
  if (!gameName && !tagLine) return null
  if (!tagLine) return gameName
  return `${gameName ?? ''}#${tagLine}`
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const admin = createServiceClient()

  const { data: lb } = await admin
    .from('leaderboards')
    .select('id, name, description, visibility, banner_url')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb || lb.visibility === 'PRIVATE') {
    return new Response('Not found', { status: 404 })
  }

  const { data: playersRaw } = await admin
    .from('leaderboard_players')
    .select('game_name, tag_line, sort_order')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(6)

  const players = (playersRaw ?? [])
    .map((player) => formatPlayerName(player.game_name, player.tag_line))
    .filter((name): name is string => Boolean(name))

  const title = lb.name?.trim() || 'Leaderboard'
  const description =
    lb.description?.trim() || 'Custom League of Legends leaderboard with live rank updates.'
  const bannerUrl = lb.banner_url?.trim() || null

  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: DEFAULT_BG,
          color: '#f8fafc',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt=""
            width={SIZE.width}
            height={SIZE.height}
            style={{
              position: 'absolute',
              inset: 0,
              objectFit: 'cover',
              opacity: 0.35,
            }}
          />
        ) : null}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.65) 60%, rgba(15, 23, 42, 0.35) 100%)',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '56px 64px',
            width: '100%',
            height: '100%',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <span
              style={{
                fontSize: 24,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
                color: '#94a3b8',
              }}
            >
              CWF.LOL Leaderboard
            </span>
            <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05 }}>{title}</span>
            <span style={{ fontSize: 28, color: '#e2e8f0', lineHeight: 1.4 }}>{description}</span>
          </div>

          {players.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontSize: 22, color: '#cbd5f5', letterSpacing: '0.12em' }}>
                TOP PLAYERS
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                {players.map((player) => (
                  <span
                    key={player}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 999,
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(148, 163, 184, 0.4)',
                      fontSize: 22,
                    }}
                  >
                    {player}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 22, color: '#cbd5f5' }}>No players yet — be the first.</div>
          )}
        </div>
      </div>
    ),
    {
      width: SIZE.width,
      height: SIZE.height,
    }
  )

  image.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400')
  return image
}

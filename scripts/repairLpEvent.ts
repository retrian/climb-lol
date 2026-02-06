import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const BASE_URL = process.env.REPAIR_BASE_URL ?? 'http://localhost:3000'
const PUUID = process.env.REPAIR_PUUID
const WRONG_MATCH_ID = process.env.REPAIR_WRONG_MATCH_ID
const RECORDED_AT = process.env.REPAIR_RECORDED_AT
const QUEUE_TYPE = process.env.REPAIR_QUEUE_TYPE ?? 'RANKED_SOLO_5x5'

if (!PUUID || !WRONG_MATCH_ID || !RECORDED_AT) {
  throw new Error('Missing REPAIR_PUUID / REPAIR_WRONG_MATCH_ID / REPAIR_RECORDED_AT')
}

async function main() {
  const res = await fetch(`${BASE_URL}/api/lp-events/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      puuid: PUUID,
      wrongMatchId: WRONG_MATCH_ID,
      recordedAt: RECORDED_AT,
      queueType: QUEUE_TYPE,
    }),
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Repair failed ${res.status}: ${JSON.stringify(payload)}`)
  }

  console.log('[repair:lp] ok', payload)
}

main().catch((err) => {
  console.error('[repair:lp] error', err)
  process.exit(1)
})

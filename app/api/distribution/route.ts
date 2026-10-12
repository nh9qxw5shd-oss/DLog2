// ─── /api/distribution ────────────────────────────────────────────────────────
// GET ?date=YYYY-MM-DD → what the Send step needs before it can offer a send:
// whether the host is set up, how many addresses are active, the sends already
// made for that log date (no addresses), and whether the presented desk key
// (x-distribution-key header) is right. Nothing secret is returned.

import { NextRequest, NextResponse } from 'next/server'
import { config, publicConfig, keyOk, db, activeAddresses, sendsFor, publicSend, DistributionError } from '@/lib/distribution/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const c = config()
  const date = req.nextUrl.searchParams.get('date')
  const logDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  const out: Record<string, unknown> = {
    config: publicConfig(c),
    keyOk: keyOk(req.headers.get('x-distribution-key'), c),
  }
  try {
    const sb = db()
    out.activeCount = (await activeAddresses(sb)).length
    out.sends = logDate ? (await sendsFor(sb, logDate)).map(publicSend) : []
  } catch (e) {
    out.error = e instanceof DistributionError || e instanceof Error ? e.message : String(e)
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}

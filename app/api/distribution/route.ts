// ─── /api/distribution ────────────────────────────────────────────────────────
// GET ?date=YYYY-MM-DD → what the Send step needs before it can offer a send:
// whether the host is set up, how many addresses are active, the sends already
// made for that log date (no addresses). Nothing secret is returned.

import { NextRequest, NextResponse } from 'next/server'
import { config, publicConfig, db, activeAddresses, sendsFor, liveSendsFor, publicSend, DistributionError } from '@/lib/distribution/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const c = config()
  const date = req.nextUrl.searchParams.get('date')
  const logDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  const out: Record<string, unknown> = {
    config: publicConfig(c),
  }
  try {
    const sb = db()
    out.activeCount = (await activeAddresses(sb)).length
    if (logDate) {
      // Every live send for the date (however many tests followed), plus recent tests.
      const [live, recent] = await Promise.all([liveSendsFor(sb, logDate), sendsFor(sb, logDate)])
      const byId = new Map([...recent, ...live].map(s => [s.id, s]))
      out.sends = Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicSend)
    } else out.sends = []
  } catch (e) {
    out.error = e instanceof DistributionError || e instanceof Error ? e.message : String(e)
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}

// ─── /api/esr/keepalive ───────────────────────────────────────────────────────
// Called on a schedule (Supabase pg_cron → pg_net, every 5 minutes). Pulls the
// ESR feed with the stored NRSDB session, which both keeps the PHP session
// alive and refreshes today's snapshot, so the morning log finds fresh data
// with no operator step. If NRSDB answers with the login page the session is
// marked expired and the Generate step falls back to the paste flow.
//
// Auth: Authorization: Bearer ESR_INGEST_TOKEN, or ?token=… for schedulers
// that cannot set headers. GET and POST behave the same.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getServerSupabase } from '@/lib/esr/snapshotStore'
import { pullWithStoredSession } from '@/lib/esr/sessionPull'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function tokenOk(req: NextRequest): boolean | null {
  const expected = (process.env.ESR_INGEST_TOKEN || '').trim()
  if (!expected) return null
  const auth = req.headers.get('authorization') || ''
  const presented = (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : new URL(req.url).searchParams.get('token') || '').trim()
  if (!presented) return false
  const a = Buffer.from(presented), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function run(req: NextRequest) {
  const auth = tokenOk(req)
  if (auth === null) return NextResponse.json({ ok: false, message: 'ESR_INGEST_TOKEN is not set on the server.' }, { status: 503 })
  if (!auth)         return NextResponse.json({ ok: false, message: 'Invalid or missing token.' }, { status: 401 })
  const sb = getServerSupabase()
  if (!sb) return NextResponse.json({ ok: false, message: 'Supabase is not configured on the server.' }, { status: 503 })

  const routeCode = (process.env.NRSDB_ROUTECODE || 'EM').trim().toUpperCase()
  const filter = (process.env.NRSDB_FILTER || 'imposed').trim()
  const outcome = await pullWithStoredSession(sb, routeCode, { trigger: 'cron', persist: true, filter })

  if (outcome.status === 'ok') {
    return NextResponse.json({
      ok: true, status: 'ok', routeCode, snapshotDate: outcome.result.snapshotDate, counts: outcome.result.counts,
      persisted: outcome.result.persisted, session: outcome.session,
    })
  }
  return NextResponse.json({ ok: false, status: outcome.status, routeCode, message: outcome.message, ...('session' in outcome ? { session: outcome.session } : {}) })
}

export async function GET(req: NextRequest)  { return run(req) }
export async function POST(req: NextRequest) { return run(req) }

// ─── /api/esr/session ─────────────────────────────────────────────────────────
// Stores the NRSDB session cookie captured from an allowed device so the
// server can pull the ESR feed unattended (the data route is not blocked at
// NRSDB's edge; only the login page is).
//
// POST { "cookie": "PHPSESSID=…; other=…", "via": "bookmarklet" | "paste" }
//   Stores the cookie, then immediately tests it with a real pull (stored if
//   it works, so today's snapshot exists straight away). Replies with the
//   outcome so the bookmark / settings page can tell the operator.
//   Accepted from: the app's own origin (settings page), the nrsdb.uk origin
//   (the bookmark, via CORS), or anything presenting Bearer ESR_INGEST_TOKEN.
// GET  → status summary (never the cookie value) + recent checks.
// DELETE → forget the session.
//
// Needs SUPABASE_SERVICE_ROLE_KEY on the host: esr_session is service-role only.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getServerSupabase } from '@/lib/esr/snapshotStore'
import { getSession, setSession, summarise, recentChecks, SessionAccessError } from '@/lib/esr/sessionStore'
import { pullWithStoredSession } from '@/lib/esr/sessionPull'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NRSDB_ORIGIN = (process.env.NRSDB_BASE_URL || 'https://nrsdb.uk').replace(/\/$/, '')

function routeCode(): string { return (process.env.NRSDB_ROUTECODE || 'EM').trim().toUpperCase() }

function cors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get('origin')
  if (origin && origin === NRSDB_ORIGIN) {
    res.headers.set('Access-Control-Allow-Origin', origin)
    res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    res.headers.set('Vary', 'Origin')
  }
  return res
}

function bearerOk(req: NextRequest): boolean {
  const expected = (process.env.ESR_INGEST_TOKEN || '').trim()
  const auth = req.headers.get('authorization') || ''
  if (!expected || !auth.toLowerCase().startsWith('bearer ')) return false
  const a = Buffer.from(auth.slice(7).trim()), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function callerAllowed(req: NextRequest): boolean {
  if (bearerOk(req)) return true
  const origin = req.headers.get('origin')
  if (!origin) return false                                  // curl etc. must use the token
  if (origin === NRSDB_ORIGIN) return true                    // the bookmark
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  try { return new URL(origin).host === host } catch { return false }   // the settings page
}

export async function OPTIONS(req: NextRequest) {
  return cors(req, new NextResponse(null, { status: 204 }))
}

export async function GET() {
  const sb = getServerSupabase()
  if (!sb) return NextResponse.json({ ok: false, message: 'Supabase is not configured on the server.' }, { status: 503 })
  try {
    const rc = routeCode()
    const s = await getSession(sb, rc)
    const checks = await recentChecks(sb, rc)
    return NextResponse.json({ ok: true, routeCode: rc, session: s ? summarise(s) : null, checks, serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY })
  } catch (e) {
    const status = e instanceof SessionAccessError ? 503 : 500
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status })
  }
}

export async function POST(req: NextRequest) {
  if (!callerAllowed(req)) {
    return cors(req, NextResponse.json({ ok: false, message: 'Not allowed from this origin without the ingest token.' }, { status: 401 }))
  }
  const sb = getServerSupabase()
  if (!sb) return cors(req, NextResponse.json({ ok: false, message: 'Supabase is not configured on the server.' }, { status: 503 }))

  let cookie = '', via = 'api'
  try {
    const body = await req.json()
    cookie = typeof body?.cookie === 'string' ? body.cookie.trim() : ''
    if (typeof body?.via === 'string') via = body.via.slice(0, 32)
  } catch { /* fall through */ }
  if (!cookie || !cookie.includes('=')) {
    return cors(req, NextResponse.json({ ok: false, message: 'Body must be { "cookie": "name=value; …" } — the NRSDB session cookie.' }, { status: 400 }))
  }

  const rc = routeCode()
  try {
    await setSession(sb, rc, cookie, via)
    const test = await pullWithStoredSession(sb, rc, { trigger: 'supply', persist: true })
    const ok = test.status === 'ok'
    return cors(req, NextResponse.json({
      ok,
      stored: true,
      test: test.status === 'ok'
        ? { status: 'ok', esrCount: test.esrCount, counts: test.result.counts, snapshotDate: test.result.snapshotDate, persisted: test.result.persisted }
        : { status: test.status, message: test.message, ...('httpStatus' in test ? { httpStatus: test.httpStatus } : {}) },
      message: ok
        ? `Session stored and working: ${test.esrCount} imposed ESRs pulled and stored for today.`
        : `Session stored but the test pull failed: ${test.message}`,
    }))
  } catch (e) {
    const status = e instanceof SessionAccessError ? 503 : 500
    return cors(req, NextResponse.json({ ok: false, message: (e as Error).message }, { status }))
  }
}

export async function DELETE(req: NextRequest) {
  if (!callerAllowed(req)) return NextResponse.json({ ok: false, message: 'Not allowed.' }, { status: 401 })
  const sb = getServerSupabase()
  if (!sb) return NextResponse.json({ ok: false, message: 'Supabase is not configured on the server.' }, { status: 503 })
  const { error } = await sb.from('esr_session').delete().eq('route_code', routeCode())
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ─── POST /api/esr/ingest ─────────────────────────────────────────────────────
// Accepts the raw NRSDB getEsrsByRouteCode JSON from a machine that nrsdb.uk
// allows (an operator PC, a Network Rail host) and runs the same flatten →
// diff → store pipeline the log build uses. Exists because nrsdb.uk's host
// bot-protection refuses logins from datacentre IPs, so the deployed app
// cannot pull for itself; scripts/nrsdb_push.py is the intended caller.
//
// Auth:  Authorization: Bearer <ESR_INGEST_TOKEN>   (or X-Ingest-Token header)
// Body:  the bare NRSDB array, or
//        { "payload": [...], "routeCode": "EM", "reportDate": "YYYY-MM-DD", "dryRun": false }
// Reply: the same EsrSnapshotResult the PDF consumes (counts, active, removed).
//
// GET returns whether the endpoint is configured (no secrets).

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { buildFromPayload } from '@/lib/esr/pipeline'
import { parsePastedFeed, detectNotAuthenticated } from '@/lib/esr/paste'
import { getServerSupabase } from '@/lib/esr/snapshotStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function tokenOk(req: NextRequest): boolean | null {
  const expected = (process.env.ESR_INGEST_TOKEN || '').trim()
  if (!expected) return null
  const auth = req.headers.get('authorization') || ''
  const presented = (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : req.headers.get('x-ingest-token') || '').trim()
  if (!presented) return false
  const a = Buffer.from(presented), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET() {
  return NextResponse.json({
    configured: !!(process.env.ESR_INGEST_TOKEN || '').trim(),
    supabase: !!getServerSupabase(),
    routeCode: (process.env.NRSDB_ROUTECODE || 'EM').trim().toUpperCase(),
  })
}

export async function POST(req: NextRequest) {
  const auth = tokenOk(req)
  if (auth === null) return NextResponse.json({ ok: false, reason: 'not_configured', message: 'ESR_INGEST_TOKEN is not set on the server.' }, { status: 503 })
  if (!auth)         return NextResponse.json({ ok: false, reason: 'error', message: 'Invalid or missing ingest token.' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, reason: 'bad_payload', message: 'Body must be JSON.' }, { status: 400 })
  }

  let payload: unknown = body
  let routeCode = (process.env.NRSDB_ROUTECODE || 'EM').trim().toUpperCase()
  let reportDate: string | null = null
  let dryRun = false
  if (body && typeof body === 'object' && !Array.isArray(body) && 'payload' in (body as object)) {
    const b = body as { payload: unknown; routeCode?: unknown; reportDate?: unknown; dryRun?: unknown }
    payload = b.payload
    if (typeof b.routeCode === 'string' && b.routeCode.trim()) routeCode = b.routeCode.trim().toUpperCase()
    if (typeof b.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.reportDate)) reportDate = b.reportDate
    dryRun = b.dryRun === true
  }
  if (new URL(req.url).searchParams.get('dryRun') === '1') dryRun = true

  const sb = getServerSupabase()
  if (!sb) return NextResponse.json({ ok: false, reason: 'not_configured', message: 'Supabase is not configured on the server; nothing to store into.' }, { status: 503 })

  // A client that could not parse NRSDB's reply (iOS Shortcuts, curl) may
  // send it as text. Classify it the same way the paste box does, so the
  // reply says "that was the login page" rather than a generic rejection.
  if (typeof payload === 'string') {
    const parsed = parsePastedFeed(payload, routeCode)
    if (!parsed.ok) return NextResponse.json({ ok: false, reason: 'bad_payload', problem: parsed.problem, message: `NRSDB reply was not the ESR feed: ${parsed.message}` }, { status: 400 })
    payload = parsed.payload
  }
  const notAuth = detectNotAuthenticated(payload)
  if (notAuth) return NextResponse.json({ ok: false, reason: 'bad_payload', problem: 'not_authenticated', message: notAuth }, { status: 400 })
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !('data' in (payload as object))) {
    const keys = Object.keys(payload as object)
    if (keys.length && keys.every(k => k.length <= 8)) {
      return NextResponse.json({ ok: false, reason: 'bad_payload', message: `Body has key(s) ${keys.map(k => `"${k}"`).join(', ')} but no "payload". Send { "payload": <NRSDB reply>, "routeCode": "EM" }.` }, { status: 400 })
    }
  }

  const result = await buildFromPayload({ payload, routeCode, reportDate, dryRun, sb })
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}

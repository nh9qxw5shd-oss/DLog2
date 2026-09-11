// ─── /api/esr/snapshot ────────────────────────────────────────────────────────
// POST — called by the log build stage. Tries a live pull of the route's
// imposed ESRs from NRSDB (server-side, with the configured account), stores
// today's snapshot, diffs against the previous one and returns the classified
// list for the PDF. If the live pull is not possible — nrsdb.uk's host
// bot-protection refuses logins from datacentre IPs, which includes Vercel
// and Netlify functions — it falls back to the latest snapshot stored by
// /api/esr/ingest and says so in the result (source: 'stored', liveError).
//
// Body: { "reportDate": "YYYY-MM-DD", "dryRun": false, "payload": [...]? }
//   reportDate — the DLog2 log date, recorded on the run row
//   dryRun     — Test Mode: scrape + baseline diff as normal, but write nothing
//   payload    — the raw NRSDB feed pasted by the operator in the browser
//                (the production path: NRSDB blocks hosted servers, the
//                operator's own logged-in browser is not blocked). When
//                present, no live pull is attempted; the payload is diffed
//                and stored exactly as a live pull would be.
//
// GET ?probe=1 — diagnostics for fault-finding a deployment: which env vars
// are present (booleans only), what is stored, and the outcome of a live
// login attempt (status, final URL, whether the edge blocked it). No secrets.
//
// Server-only env (never NEXT_PUBLIC_*):
//   NRSDB_EMAIL, NRSDB_PASSWORD      — enable the live pull
//   NRSDB_ROUTECODE / NRSDB_FILTER   — default "EM" / "imposed"
//   SUPABASE_SERVICE_ROLE_KEY        — preferred for writes (anon key fallback)
//   SUPABASE_URL                     — falls back to NEXT_PUBLIC_SUPABASE_URL
//   ESR_INGEST_TOKEN                 — see /api/esr/ingest

import { NextRequest, NextResponse } from 'next/server'
import { NrsdbClient, NrsdbAuthError, NrsdbFetchError, NrsdbPayloadError, LoginOutcome } from '@/lib/esr/nrsdbClient'
import { buildFromPayload, loadStoredResult } from '@/lib/esr/pipeline'
import { getServerSupabase, fetchLatestRun } from '@/lib/esr/snapshotStore'
import { pullWithStoredSession } from '@/lib/esr/sessionPull'
import { getSession, summarise, recentChecks, SessionAccessError } from '@/lib/esr/sessionStore'
import type { EsrSnapshotResponse, EsrSnapshotResult, EsrSnapshotFailure } from '@/lib/esr/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 60_000
let cache: { at: number; key: string; result: EsrSnapshotResult } | null = null

function env(name: string): string {
  // Tolerate the usual paste accidents: surrounding quotes, trailing newline.
  return (process.env[name] || '').trim().replace(/^["']|["']$/g, '')
}

function fail(reason: EsrSnapshotFailure['reason'], message: string, detail?: string): NextResponse<EsrSnapshotResponse> {
  return NextResponse.json({ ok: false, reason, message, ...(detail ? { detail } : {}) })
}

type LiveOutcome =
  | { ok: true; payload: unknown }
  | { ok: false; reason: EsrSnapshotFailure['reason']; message: string; detail?: string }

async function livePull(email: string, password: string, routeCode: string, filter: string): Promise<LiveOutcome> {
  try {
    const client = new NrsdbClient({ email, password })
    const login = await client.loginDetailed()
    if (!login.ok) {
      return {
        ok: false,
        reason: login.blocked ? 'blocked' : 'auth_failed',
        message: login.message,
        detail: `HTTP ${login.status} · landed on ${login.finalUrl} · ${login.cookies} cookie(s)${login.stackProtect ? ' · x-stackprotect-id present' : ''}${login.bodySnippet ? ` · "${login.bodySnippet}"` : ''}`,
      }
    }
    return { ok: true, payload: await client.getEsrs(routeCode, filter) }
  } catch (e) {
    if (e instanceof NrsdbAuthError)    return { ok: false, reason: 'auth_failed',  message: e.message }
    if (e instanceof NrsdbPayloadError) return { ok: false, reason: 'bad_payload',  message: e.message }
    if (e instanceof NrsdbFetchError)   return { ok: false, reason: e.message.includes('403') ? 'blocked' : 'fetch_failed', message: e.message }
    return { ok: false, reason: 'error', message: (e as Error).message || 'Unexpected error contacting NRSDB.' }
  }
}

export async function POST(req: NextRequest) {
  const email     = env('NRSDB_EMAIL')
  const password  = env('NRSDB_PASSWORD')
  const routeCode = (env('NRSDB_ROUTECODE') || 'EM').toUpperCase()
  const filter    = env('NRSDB_FILTER') || 'imposed'
  const credsSet  = !!(email && password)
  const sb        = getServerSupabase()

  let reportDate: string | null = null
  let dryRun = false
  let pasted: unknown = undefined
  try {
    const body = await req.json().catch(() => ({}))
    const rd = typeof body?.reportDate === 'string' ? body.reportDate : ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(rd)) reportDate = rd
    dryRun = body?.dryRun === true
    if (body && typeof body === 'object' && body.payload !== undefined) pasted = body.payload
  } catch { /* body optional */ }

  // 0. Operator-supplied feed ─────────────────────────────────────────────
  if (pasted !== undefined) {
    const result = await buildFromPayload({ payload: pasted, routeCode, reportDate, dryRun, sb, source: 'pasted' })
    if (result.ok && result.persisted) cache = { at: Date.now(), key: `${routeCode}|${filter}`, result }
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  }

  const cacheKey = `${routeCode}|${filter}`
  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    // A cached result was persisted by a real run; a dry-run caller may reuse
    // it (it reflects the same live pull) but is told nothing was written by it.
    return NextResponse.json(dryRun ? { ...cache.result, dryRun: true } : cache.result)
  }

  // 1a. Stored NRSDB session (unattended path) ────────────────────────────
  let sessionNote = ''
  if (sb) {
    const viaSession = await pullWithStoredSession(sb, routeCode, { trigger: 'build', persist: !dryRun, reportDate, filter })
    if (viaSession.status === 'ok') {
      const result = dryRun ? { ...viaSession.result, dryRun: true } : viaSession.result
      if (result.persisted) cache = { at: Date.now(), key: cacheKey, result }
      return NextResponse.json(result)
    }
    if (viaSession.status !== 'none' && viaSession.status !== 'unavailable') sessionNote = viaSession.message
  }

  // 1b. Live login pull (works only from non-datacentre hosts) ─────────────
  let live: LiveOutcome = { ok: false, reason: 'not_configured', message: 'NRSDB_EMAIL / NRSDB_PASSWORD are not set on the server.' }
  if (credsSet) live = await livePull(email, password, routeCode, filter)
  if (!live.ok && sessionNote) live = { ...live, message: `${sessionNote} ${live.message}` }

  if (live.ok) {
    const result = await buildFromPayload({ payload: live.payload, routeCode, reportDate, dryRun, sb })
    if (result.ok) {
      if (result.persisted) cache = { at: Date.now(), key: cacheKey, result }
      return NextResponse.json(result)
    }
    live = { ok: false, reason: result.reason, message: result.message }
  }

  // 2. Fall back to the latest stored snapshot (fed by /api/esr/ingest) ───
  if (sb) {
    try {
      const stored = await loadStoredResult(sb, routeCode)
      if (stored) {
        return NextResponse.json({ ...stored, liveError: live.message, ...(dryRun ? { dryRun: true } : {}) })
      }
    } catch (e) {
      return fail('persist_failed', `Live pull failed (${live.message}) and the stored snapshot could not be read: ${(e as Error).message}`)
    }
  }

  // 3. Nothing to give ─────────────────────────────────────────────────────
  if (!credsSet && !sb) return fail('not_configured', 'Neither NRSDB credentials nor Supabase are configured on the server.')
  if (!credsSet) return fail('not_configured', 'NRSDB credentials are not set on the server and no ESR snapshot has been ingested yet (see /api/esr/ingest).')
  const suffix = sb ? ' No stored snapshot is available to fall back on — push one via /api/esr/ingest.' : ' Supabase is not configured, so there is no stored snapshot to fall back on.'
  return fail(live.reason, live.message + suffix, live.detail)
}

// ── GET ?probe=1 — deployment diagnostics ────────────────────────────────────

export async function GET(req: NextRequest) {
  const probe = new URL(req.url).searchParams.get('probe')
  if (probe !== '1') {
    return NextResponse.json({ ok: false, reason: 'error', message: 'Use POST to take a snapshot, or GET ?probe=1 for diagnostics.' }, { status: 405 })
  }
  const email     = env('NRSDB_EMAIL')
  const password  = env('NRSDB_PASSWORD')
  const routeCode = (env('NRSDB_ROUTECODE') || 'EM').toUpperCase()
  const sb        = getServerSupabase()

  const config = {
    nrsdbEmailSet: !!email,
    nrsdbPasswordSet: !!password,
    routeCode,
    supabaseUrlSet: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRoleKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseAnonKeyFallback: !process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ingestTokenSet: !!env('ESR_INGEST_TOKEN'),
  }

  let stored: unknown = null
  let storedError: string | undefined
  if (sb) {
    try {
      const run = await fetchLatestRun(sb, routeCode)
      stored = run ? { snapshotDate: run.snapshotDate, capturedAt: run.capturedAt, esrCount: run.esrCount, baselineDate: run.baselineDate } : null
    } catch (e) { storedError = (e as Error).message }
  }

  let session: unknown = null
  let sessionCheck: unknown = null
  if (sb) {
    try {
      const s = await getSession(sb, routeCode)
      session = s ? { ...summarise(s), recent: await recentChecks(sb, routeCode, 8) } : null
      if (s) {
        const o = await pullWithStoredSession(sb, routeCode, { trigger: 'probe', persist: false })
        sessionCheck = o.status === 'ok'
          ? { status: 'ok', esrCount: o.esrCount, note: 'Data route reachable with the stored session; snapshot not stored by the probe.' }
          : { status: o.status, message: o.message }
      }
    } catch (e) {
      session = { error: e instanceof SessionAccessError ? e.message : (e as Error).message }
    }
  }

  let liveLogin: Omit<LoginOutcome, 'bodySnippet'> & { bodySnippet?: string } | { skipped: string } = { skipped: 'NRSDB credentials not set' }
  if (email && password) {
    try {
      liveLogin = await new NrsdbClient({ email, password }).loginDetailed()
    } catch (e) {
      liveLogin = { skipped: `request failed: ${(e as Error).message}` }
    }
  }

  const sessionOk = !!(sessionCheck && (sessionCheck as { status?: string }).status === 'ok')
  return NextResponse.json({
    config,
    stored,
    ...(storedError ? { storedError } : {}),
    session,
    sessionCheck,
    liveLogin,
    verdict: sessionOk
      ? 'Stored NRSDB session works from this server: unattended pulls are possible. Keep it alive with the keepalive schedule.'
      : !email || !password
      ? 'No NRSDB credentials on the server; the log will use the stored snapshot pushed via /api/esr/ingest.'
      : 'ok' in liveLogin && liveLogin.ok
        ? 'Live NRSDB login works from this server.'
        : 'blocked' in liveLogin && liveLogin.blocked
          ? 'NRSDB blocks this server\'s IP at the edge (bot protection). Credentials are not the problem. Use scripts/nrsdb_push.py from an allowed machine to feed /api/esr/ingest; the log falls back to that stored snapshot automatically.'
          : 'Live login failed — see liveLogin for the HTTP status and landing URL.',
  })
}

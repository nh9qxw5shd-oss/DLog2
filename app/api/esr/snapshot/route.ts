// ─── POST /api/esr/snapshot ───────────────────────────────────────────────────
// Called by the log build stage. Pulls the route's currently imposed ESRs from
// NRSDB (server-side, with the configured account), stores today's snapshot in
// Supabase, diffs it against the most recent prior snapshot and returns the
// classified list for the PDF.
//
// Body: { "reportDate": "YYYY-MM-DD", "dryRun": false }
//   reportDate — the DLog2 log date, recorded on the run row
//   dryRun     — Test Mode: scrape + baseline diff as normal, but write nothing
//
// Server-only env (never NEXT_PUBLIC_*):
//   NRSDB_EMAIL, NRSDB_PASSWORD      — required; without them the response is
//                                      { ok:false, reason:'not_configured' }
//   NRSDB_ROUTECODE                  — default "EM"
//   NRSDB_FILTER                     — default "imposed"
//   SUPABASE_SERVICE_ROLE_KEY        — preferred for writes; falls back to the
//                                      public anon key (migration 009 allows it)
//   SUPABASE_URL                     — falls back to NEXT_PUBLIC_SUPABASE_URL
//
// The scrape result is cached in-process for a short window so repeated
// "Regenerate PDF" clicks (or two operators building at once) do not hammer
// NRSDB's login endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { NrsdbClient, NrsdbAuthError, NrsdbFetchError, NrsdbPayloadError } from '@/lib/esr/nrsdbClient'
import { extractEsrList, flattenPull, diffRows } from '@/lib/esr/diff'
import { getServerSupabase, fetchPriorBaseline, persistSnapshot } from '@/lib/esr/snapshotStore'
import type { EsrSnapshotResponse, EsrSnapshotResult, EsrSnapshotFailure, EsrRow, EsrStatus, EsrFieldChange } from '@/lib/esr/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 60_000
let cache: { at: number; key: string; result: EsrSnapshotResult } | null = null

function londonDateOf(d: Date): string {
  // en-CA gives YYYY-MM-DD; Europe/London handles BST/GMT.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function fail(reason: EsrSnapshotFailure['reason'], message: string, status = 200): NextResponse<EsrSnapshotResponse> {
  return NextResponse.json({ ok: false, reason, message }, { status })
}

export async function POST(req: NextRequest) {
  const email    = process.env.NRSDB_EMAIL
  const password = process.env.NRSDB_PASSWORD
  const routeCode = (process.env.NRSDB_ROUTECODE || 'EM').trim().toUpperCase()
  const filter    = (process.env.NRSDB_FILTER || 'imposed').trim()

  if (!email || !password) {
    return fail('not_configured', 'NRSDB_EMAIL / NRSDB_PASSWORD are not set on the server.')
  }

  let reportDate: string | null = null
  let dryRun = false
  try {
    const body = await req.json().catch(() => ({}))
    const rd = typeof body?.reportDate === 'string' ? body.reportDate : ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(rd)) reportDate = rd
    dryRun = body?.dryRun === true
  } catch { /* body optional */ }

  const cacheKey = `${routeCode}|${filter}`
  if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
    // A cached result was persisted by a real run; a dry-run caller may reuse
    // it (it reflects the same live pull) but is told nothing was written by it.
    return NextResponse.json(dryRun ? { ...cache.result, dryRun: true } : cache.result)
  }

  // 1. Scrape ──────────────────────────────────────────────────────────────
  let payload: unknown
  try {
    const client = new NrsdbClient({ email, password })
    if (!(await client.login())) {
      return fail('auth_failed', 'NRSDB login failed — check NRSDB_EMAIL / NRSDB_PASSWORD.')
    }
    payload = await client.getEsrs(routeCode, filter)
  } catch (e) {
    if (e instanceof NrsdbAuthError)    return fail('auth_failed', e.message)
    if (e instanceof NrsdbPayloadError) return fail('bad_payload', e.message)
    if (e instanceof NrsdbFetchError)   return fail('fetch_failed', e.message)
    return fail('error', (e as Error).message || 'Unexpected error contacting NRSDB.')
  }

  const list = extractEsrList(payload)
  if (!list) return fail('bad_payload', 'NRSDB response did not contain an ESR list.')
  const rows = flattenPull(list)
  if (rows.length === 0) {
    // An empty pull almost certainly means the session/payload is wrong, not
    // that the route has no restrictions. Do not overwrite today's snapshot.
    return fail('bad_payload', `NRSDB returned no imposed ESRs for route ${routeCode}; snapshot not taken.`)
  }

  // 2. Baseline + diff ─────────────────────────────────────────────────────
  const now = new Date()
  const capturedAt = now.toISOString()
  const snapshotDate = londonDateOf(now)

  const sb = getServerSupabase()
  let baselineDate: string | null = null
  let baselineCapturedAt: string | null = null
  let baselineRows: EsrRow[] = []
  let persistError: string | undefined

  if (sb) {
    try {
      const baseline = await fetchPriorBaseline(sb, routeCode, snapshotDate)
      if (baseline) {
        baselineDate = baseline.date
        baselineCapturedAt = baseline.capturedAt
        baselineRows = baseline.rows
      }
    } catch (e) {
      persistError = (e as Error).message
    }
  }

  const diff = diffRows(rows, baselineRows)

  // 3. Persist ─────────────────────────────────────────────────────────────
  let persisted = false
  if (sb && !persistError && !dryRun) {
    try {
      await persistSnapshot(sb, {
        routeCode, snapshotDate, reportDate, capturedAt, rows,
        baselineDate, diff, raw: payload,
      })
      persisted = true
    } catch (e) {
      persistError = (e as Error).message
    }
  }

  // 4. Shape for the PDF ──────────────────────────────────────────────────
  const statusBy = new Map<string, { status: EsrStatus; changes?: EsrFieldChange[] }>()
  for (const r of diff.new)       statusBy.set(r.baseRef, { status: 'NEW' })
  for (const a of diff.amended)   statusBy.set(a.row.baseRef, { status: 'AMENDED', changes: a.changes })
  for (const r of diff.unchanged) statusBy.set(r.baseRef, { status: 'UNCHANGED' })

  const result: EsrSnapshotResult = {
    ok: true,
    routeCode,
    snapshotDate,
    capturedAt,
    baselineDate,
    baselineCapturedAt,
    persisted,
    ...(dryRun ? { dryRun: true } : {}),
    ...(persistError ? { persistError } : {}),
    counts: {
      active: rows.length,
      new: diff.new.length,
      amended: diff.amended.length,
      removed: diff.removed.length,
      unchanged: diff.unchanged.length,
    },
    active: rows.map(row => ({ row, ...(statusBy.get(row.baseRef) ?? { status: 'UNCHANGED' as EsrStatus }) })),
    removed: diff.removed,
  }

  if (persisted) cache = { at: Date.now(), key: cacheKey, result }
  return NextResponse.json(result)
}

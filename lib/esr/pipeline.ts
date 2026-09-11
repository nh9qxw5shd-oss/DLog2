// ─── ESR pipeline (server-side only) ─────────────────────────────────────────
// The shared middle of both API routes:
//   raw NRSDB payload → flatten → baseline lookup → diff → (persist) → result
// and the read-back path that turns the latest STORED snapshot into the same
// result shape, used when the live pull is impossible (nrsdb.uk's bot
// protection refuses datacentre IPs) and the data has instead been pushed in
// via /api/esr/ingest from a machine NRSDB allows.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractEsrList, flattenPull, diffRows } from './diff'
import { fetchPriorBaseline, fetchSnapshotRows, fetchLatestRun, persistSnapshot } from './snapshotStore'
import type { EsrRow, EsrDiff, EsrSnapshotResult, EsrSnapshotFailure, EsrStatus, EsrFieldChange } from './types'

export function londonDateOf(d: Date): string {
  // en-CA gives YYYY-MM-DD; Europe/London handles BST/GMT.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function shapeActive(rows: EsrRow[], diff: Pick<EsrDiff, 'new' | 'amended' | 'unchanged'>): EsrSnapshotResult['active'] {
  const statusBy = new Map<string, { status: EsrStatus; changes?: EsrFieldChange[] }>()
  for (const r of diff.new)       statusBy.set(r.baseRef, { status: 'NEW' })
  for (const a of diff.amended)   statusBy.set(a.row.baseRef, { status: 'AMENDED', changes: a.changes })
  for (const r of diff.unchanged) statusBy.set(r.baseRef, { status: 'UNCHANGED' })
  return rows.map(row => ({ row, ...(statusBy.get(row.baseRef) ?? { status: 'UNCHANGED' as EsrStatus }) }))
}

export interface BuildArgs {
  payload: unknown            // raw NRSDB JSON (array, or wrapper object)
  routeCode: string
  reportDate: string | null
  dryRun: boolean
  sb: SupabaseClient | null
}

// Flatten, diff against the prior stored baseline, persist (unless dryRun or
// no Supabase) and return the PDF-ready result.
export async function buildFromPayload(a: BuildArgs): Promise<EsrSnapshotResult | EsrSnapshotFailure> {
  const list = extractEsrList(a.payload)
  if (!list) return { ok: false, reason: 'bad_payload', message: 'NRSDB payload did not contain an ESR list.' }
  const rows = flattenPull(list)
  if (rows.length === 0) {
    // An empty pull almost certainly means the session/payload is wrong, not
    // that the route has no restrictions. Do not overwrite today's snapshot.
    return { ok: false, reason: 'bad_payload', message: `Payload contained no imposed ESRs for route ${a.routeCode}; snapshot not taken.` }
  }

  const now = new Date()
  const capturedAt = now.toISOString()
  const snapshotDate = londonDateOf(now)

  let baselineDate: string | null = null
  let baselineCapturedAt: string | null = null
  let baselineRows: EsrRow[] = []
  let persistError: string | undefined

  if (a.sb) {
    try {
      const baseline = await fetchPriorBaseline(a.sb, a.routeCode, snapshotDate)
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

  let persisted = false
  if (a.sb && !persistError && !a.dryRun) {
    try {
      await persistSnapshot(a.sb, {
        routeCode: a.routeCode, snapshotDate, reportDate: a.reportDate, capturedAt, rows,
        baselineDate, diff, raw: a.payload,
      })
      persisted = true
    } catch (e) {
      persistError = (e as Error).message
    }
  }

  return {
    ok: true,
    source: 'live',
    routeCode: a.routeCode,
    snapshotDate,
    capturedAt,
    baselineDate,
    baselineCapturedAt,
    persisted,
    ...(a.dryRun ? { dryRun: true } : {}),
    ...(persistError ? { persistError } : {}),
    counts: {
      active: rows.length,
      new: diff.new.length,
      amended: diff.amended.length,
      removed: diff.removed.length,
      unchanged: diff.unchanged.length,
    },
    active: shapeActive(rows, diff),
    removed: diff.removed,
  }
}

// The most recent stored snapshot for the route, in result shape, with the
// diff that was computed when it was captured. Null when nothing is stored.
export async function loadStoredResult(sb: SupabaseClient, routeCode: string): Promise<EsrSnapshotResult | null> {
  const run = await fetchLatestRun(sb, routeCode)
  if (!run) return null
  const rows = await fetchSnapshotRows(sb, routeCode, run.snapshotDate)
  if (rows.length === 0) return null

  const diff = run.diff
  const newRefs = new Set(diff.new.map(r => r.baseRef))
  const amendedBy = new Map(diff.amended.map(a => [a.row.baseRef, a.changes]))
  const active: EsrSnapshotResult['active'] = rows.map(row => {
    if (newRefs.has(row.baseRef)) return { row, status: 'NEW' }
    const ch = amendedBy.get(row.baseRef)
    if (ch) return { row, status: 'AMENDED', changes: ch }
    return { row, status: 'UNCHANGED' }
  })

  return {
    ok: true,
    source: 'stored',
    routeCode,
    snapshotDate: run.snapshotDate,
    capturedAt: run.capturedAt,
    baselineDate: run.baselineDate,
    baselineCapturedAt: null,
    persisted: true,
    counts: {
      active: rows.length,
      new: diff.new.length,
      amended: diff.amended.length,
      removed: diff.removed.length,
      unchanged: Math.max(0, rows.length - diff.new.length - diff.amended.length),
    },
    active,
    removed: diff.removed,
  }
}

// ─── ESR snapshot persistence (server-side only) ──────────────────────────────
// Writes each day's flattened ESR list to esr_snapshots, the run summary +
// diff to esr_snapshot_runs, and reads back the most recent prior baseline.
// Uses the service-role key when present (bypasses RLS) and otherwise the
// public anon key, which migration 009 permits.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { EsrRow, EsrDiff } from './types'

export function getServerSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ── Row mapping ──────────────────────────────────────────────────────────────

interface SnapshotDbRow {
  snapshot_date: string
  route_code: string
  base_ref: string
  refnum: string
  revision_letter: string
  revision_rank: number
  nrsdb_id: number | null
  speed_value: string | null
  speed_unit: string | null
  linespeed: string | null
  du_name: string | null
  elr_code: string | null
  elr_description: string | null
  lor_code: string | null
  lor_description: string | null
  location: string | null
  reason: string | null
  lines: unknown
  lines_text: string | null
  when_imposed_raw: string | null
  when_imposed: string | null
  etr_raw: string | null
  etr: string | null
  fms_number: string | null
  ccil_number: string | null
  tsr_reference: string | null
  captured_at?: string
}

function toDb(row: EsrRow, snapshotDate: string, routeCode: string, capturedAt: string): SnapshotDbRow {
  return {
    snapshot_date: snapshotDate,
    route_code: routeCode,
    base_ref: row.baseRef,
    refnum: row.refnum,
    revision_letter: row.revisionLetter,
    revision_rank: row.revisionRank,
    nrsdb_id: row.nrsdbId,
    speed_value: row.speedValue,
    speed_unit: row.speedUnit,
    linespeed: row.linespeed,
    du_name: row.duName,
    elr_code: row.elrCode,
    elr_description: row.elrDescription,
    lor_code: row.lorCode,
    lor_description: row.lorDescription,
    location: row.location,
    reason: row.reason,
    lines: row.lines ?? null,
    lines_text: row.linesText,
    when_imposed_raw: row.whenImposedRaw,
    when_imposed: row.whenImposed,
    etr_raw: row.etrRaw,
    etr: row.etr,
    fms_number: row.fmsNumber,
    ccil_number: row.ccilNumber,
    tsr_reference: row.tsrReference,
    captured_at: capturedAt,
  }
}

function fromDb(r: SnapshotDbRow): EsrRow {
  return {
    baseRef: r.base_ref,
    refnum: r.refnum,
    revisionLetter: r.revision_letter ?? '',
    revisionRank: r.revision_rank ?? 0,
    nrsdbId: r.nrsdb_id,
    speedValue: r.speed_value,
    speedUnit: r.speed_unit,
    linespeed: r.linespeed,
    duName: r.du_name,
    elrCode: r.elr_code,
    elrDescription: r.elr_description,
    lorCode: r.lor_code,
    lorDescription: r.lor_description,
    location: r.location,
    reason: r.reason,
    lines: r.lines,
    linesText: r.lines_text,
    whenImposedRaw: r.when_imposed_raw,
    whenImposed: r.when_imposed,
    etrRaw: r.etr_raw,
    etr: r.etr,
    fmsNumber: r.fms_number,
    ccilNumber: r.ccil_number,
    tsrReference: r.tsr_reference,
  }
}

// ── Baseline lookup ──────────────────────────────────────────────────────────

export interface Baseline {
  date: string
  capturedAt: string | null
  rows: EsrRow[]
}

// Most recent snapshot strictly before `beforeDate` for the route. Walks back
// over any gap (weekends, missed builds) by simply taking the max prior date.
export async function fetchPriorBaseline(sb: SupabaseClient, routeCode: string, beforeDate: string): Promise<Baseline | null> {
  const { data: runRows, error: runErr } = await sb
    .from('esr_snapshot_runs')
    .select('snapshot_date, captured_at')
    .eq('route_code', routeCode)
    .lt('snapshot_date', beforeDate)
    .order('snapshot_date', { ascending: false })
    .limit(1)
  if (runErr) throw new Error(`ESR baseline lookup failed: ${runErr.message}`)

  let date: string | null = runRows?.[0]?.snapshot_date ?? null
  let capturedAt: string | null = runRows?.[0]?.captured_at ?? null

  // A snapshot written without its run row (partial earlier failure) is still
  // a usable baseline — fall back to the items table.
  if (!date) {
    const { data: itemRows, error: itemErr } = await sb
      .from('esr_snapshots')
      .select('snapshot_date, captured_at')
      .eq('route_code', routeCode)
      .lt('snapshot_date', beforeDate)
      .order('snapshot_date', { ascending: false })
      .limit(1)
    if (itemErr) throw new Error(`ESR baseline lookup failed: ${itemErr.message}`)
    date = itemRows?.[0]?.snapshot_date ?? null
    capturedAt = itemRows?.[0]?.captured_at ?? null
  }
  if (!date) return null

  const { data, error } = await sb
    .from('esr_snapshots')
    .select('*')
    .eq('route_code', routeCode)
    .eq('snapshot_date', date)
  if (error) throw new Error(`ESR baseline fetch failed: ${error.message}`)
  return { date, capturedAt, rows: (data as SnapshotDbRow[]).map(fromDb) }
}

// ── Write ────────────────────────────────────────────────────────────────────

export interface PersistArgs {
  routeCode: string
  snapshotDate: string
  reportDate: string | null
  capturedAt: string
  rows: EsrRow[]
  baselineDate: string | null
  diff: EsrDiff
  raw: unknown
}

export async function persistSnapshot(sb: SupabaseClient, a: PersistArgs): Promise<void> {
  // Upsert today's rows first, then prune any row from an earlier run today
  // that is no longer imposed, so a same-day rebuild converges on the latest
  // pull without ever leaving the day empty mid-write.
  const dbRows = a.rows.map(r => toDb(r, a.snapshotDate, a.routeCode, a.capturedAt))
  if (dbRows.length > 0) {
    const { error } = await sb
      .from('esr_snapshots')
      .upsert(dbRows, { onConflict: 'snapshot_date,route_code,base_ref' })
    if (error) throw new Error(`ESR snapshot upsert failed: ${error.message}`)
  }
  {
    let q = sb
      .from('esr_snapshots')
      .delete()
      .eq('snapshot_date', a.snapshotDate)
      .eq('route_code', a.routeCode)
    if (dbRows.length > 0) q = q.lt('captured_at', a.capturedAt)
    const { error } = await q
    if (error) throw new Error(`ESR snapshot prune failed: ${error.message}`)
  }

  const { error: runErr } = await sb
    .from('esr_snapshot_runs')
    .upsert({
      snapshot_date: a.snapshotDate,
      route_code: a.routeCode,
      report_date: a.reportDate,
      captured_at: a.capturedAt,
      esr_count: a.rows.length,
      baseline_date: a.baselineDate,
      new_count: a.diff.new.length,
      amended_count: a.diff.amended.length,
      removed_count: a.diff.removed.length,
      unchanged_count: a.diff.unchanged.length,
      diff: { new: a.diff.new, amended: a.diff.amended, removed: a.diff.removed },
      raw: a.raw ?? null,
    }, { onConflict: 'snapshot_date,route_code' })
  if (runErr) throw new Error(`ESR run upsert failed: ${runErr.message}`)
}

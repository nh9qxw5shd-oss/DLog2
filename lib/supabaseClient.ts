'use client'

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { LogState, CATEGORY_CONFIG, IncidentCategory } from './types'

// ─── Client singleton ─────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!_client) _client = createClient(url, key)
  return _client
}

export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportTrendPoint {
  date: string         // YYYY-MM-DD
  totalDelay: number
  incidentCount: number
}

export interface CategoryBreakdown {
  category: string
  label: string
  color: string
  count: number
}

export interface LocationBreakdown {
  location: string
  count: number
}

export interface SafetyCategoryTrendPoint {
  date: string
  counts: Partial<Record<string, number>>
}

export const ANALYTICS_WINDOW_DAYS = 30

export interface HistoricalChartData {
  trendPoints: ReportTrendPoint[]
  categoryBreakdown: CategoryBreakdown[]
  locationBreakdown: LocationBreakdown[]
  timeOfDayBreakdown: number[]               // 24 entries, index = hour (0–23)
  safetyCategoryTrend: SafetyCategoryTrendPoint[]
  reportCount: number
  windowDays: number
}

// ─── Upsert ───────────────────────────────────────────────────────────────────
// De-duplication: upsert on report_date (unique constraint).
// Existing incidents for the report are deleted and re-inserted so a re-run
// of the same date always reflects the latest reviewed data.
//
// Cross-log continuation: any CCIL reference that already appears in a prior
// report is flagged as a continuation. Its event-type count is suppressed and
// only the incremental delay (delta) is recorded, so multi-day incidents don't
// inflate totals.

export async function upsertReportData(log: LogState): Promise<void> {
  const sb = getClient()
  if (!sb || !log.date) return

  // ── Cross-date CCIL lookup ─────────────────────────────────────────────────
  // For every CCIL reference in this log, find the most recent prior occurrence
  // (report_date strictly before today's log) so we can compute deltas.
  const ccilRefs = log.incidents.map(i => i.ccil).filter((c): c is string => !!c)
  const priorByccil = new Map<string, number>() // ccil → most recent minutes_delay

  if (ccilRefs.length > 0) {
    const { data: priorRows } = await sb
      .from('incidents')
      .select('ccil, minutes_delay, report_date')
      .in('ccil', ccilRefs)
      .lt('report_date', log.date)
      .order('report_date', { ascending: false })

    for (const row of priorRows ?? []) {
      // Only keep the most recent occurrence per CCIL (rows are desc by date)
      if (row.ccil && !priorByccil.has(row.ccil)) {
        priorByccil.set(row.ccil, row.minutes_delay ?? 0)
      }
    }
  }

  // Annotate incidents with continuation status and delta delay
  const annotated = log.incidents.map(inc => {
    if (inc.ccil && priorByccil.has(inc.ccil)) {
      const prevDelay = priorByccil.get(inc.ccil)!
      const delta = Math.max(0, (inc.minutesDelay ?? 0) - prevDelay)
      return { ...inc, isContinuation: true, delayDelta: delta }
    }
    return { ...inc, isContinuation: false, delayDelta: undefined }
  })

  // Totals use delta delay for continuations, raw delay for first-seen incidents
  const totalDelay = annotated.reduce((s, i) =>
    s + (i.isContinuation ? (i.delayDelta ?? 0) : (i.minutesDelay ?? 0)), 0)
  const totalCancelled     = annotated.reduce((s, i) => s + (i.cancelled     || 0), 0)
  const totalPartCancelled = annotated.reduce((s, i) => s + (i.partCancelled || 0), 0)

  // Upsert report row (conflict on report_date → update in place)
  const { data: reportRow, error: reportErr } = await sb
    .from('reports')
    .upsert(
      {
        report_date:          log.date,
        period:               log.period       || null,
        control_centre:       log.controlCentre|| null,
        created_by:           log.createdBy    || null,
        season_mode:          log.seasonMode,
        total_delay:          totalDelay,
        total_cancelled:      totalCancelled,
        total_part_cancelled: totalPartCancelled,
        incident_count:       log.incidents.length,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'report_date', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (reportErr) throw new Error(`Report upsert failed: ${reportErr.message}`)

  const reportId = reportRow.id

  // Remove any previously stored incidents for this report, then re-insert fresh
  const { error: delErr } = await sb
    .from('incidents')
    .delete()
    .eq('report_id', reportId)

  if (delErr) throw new Error(`Incident clear failed: ${delErr.message}`)

  if (annotated.length === 0) return

  const rows = annotated.map(inc => ({
    report_id:       reportId,
    report_date:     log.date,
    ccil:            inc.ccil          || null,
    category:        inc.category,
    severity:        inc.severity,
    title:           inc.title,
    location:        inc.location      || null,
    area:            inc.area          || null,
    incident_start:  inc.incidentStart || null,
    minutes_delay:   inc.minutesDelay  ?? 0,
    trains_delayed:  inc.trainsDelayed ?? 0,
    cancelled:       inc.cancelled     ?? 0,
    part_cancelled:  inc.partCancelled ?? 0,
    is_highlight:    inc.isHighlight,
    is_continuation: inc.isContinuation ?? false,
    delay_delta:     inc.delayDelta    ?? null,
  }))

  const { error: insErr } = await sb.from('incidents').insert(rows)
  if (insErr) throw new Error(`Incident insert failed: ${insErr.message}`)
}

// ─── Fetch historical data for chart rendering ────────────────────────────────

export async function fetchHistoricalData(
  windowDays = ANALYTICS_WINDOW_DAYS,
): Promise<HistoricalChartData | null> {
  const sb = getClient()
  if (!sb) return null

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - windowDays + 1)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  // Rolling window query: only incidents within the analytics window
  const { data: rows, error } = await sb
    .from('incidents')
    .select('report_date, category, minutes_delay, delay_delta, is_continuation, location, incident_start')
    .gte('report_date', cutoffDate)
    .order('report_date', { ascending: true })

  if (error) throw new Error(`Historical fetch failed: ${error.message}`)

  // ── Delay trend: aggregate by report_date ───────────────────────────────
  // Use delay_delta for continuations so multi-day incidents don't double-count.
  const byDate = new Map<string, { totalDelay: number; incidentCount: number }>()
  for (const row of rows ?? []) {
    const agg = byDate.get(row.report_date) ?? { totalDelay: 0, incidentCount: 0 }
    const delayContrib = row.is_continuation
      ? (row.delay_delta ?? 0)
      : (row.minutes_delay ?? 0)
    byDate.set(row.report_date, {
      totalDelay:    agg.totalDelay    + delayContrib,
      incidentCount: agg.incidentCount + 1,
    })
  }
  const trendPoints: ReportTrendPoint[] = Array.from(byDate.entries()).map(
    ([date, agg]) => ({ date, ...agg })
  )

  // ── Category split: count by category across all time ──────────────────
  // Continuations are the same event seen again — exclude from tallies.
  const byCat = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row.is_continuation) continue
    byCat.set(row.category, (byCat.get(row.category) ?? 0) + 1)
  }
  const categoryBreakdown: CategoryBreakdown[] = Array.from(byCat.entries())
    .map(([category, count]) => ({
      category,
      count,
      label: CATEGORY_CONFIG[category as IncidentCategory]?.label ?? category,
      color: CATEGORY_CONFIG[category as IncidentCategory]?.color ?? '#4A6FA5',
    }))
    .sort((a, b) => b.count - a.count)

  // ── Top locations: count by location, top 12 ───────────────────────────
  const byLoc = new Map<string, number>()
  for (const row of rows ?? []) {
    if (row.is_continuation) continue
    const loc = row.location?.trim()
    if (!loc) continue
    byLoc.set(loc, (byLoc.get(loc) ?? 0) + 1)
  }
  const locationBreakdown: LocationBreakdown[] = Array.from(byLoc.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  // ── Time-of-day distribution (24-hour breakdown) ──────────────────────
  const byHour = new Array(24).fill(0) as number[]
  for (const row of rows ?? []) {
    if (row.is_continuation) continue
    if (!row.incident_start) continue
    const hour = parseInt((row.incident_start as string).split(':')[0] ?? '-1', 10)
    if (hour >= 0 && hour < 24) byHour[hour]++
  }

  // ── Safety-critical category trend (per report date) ───────────────────
  const SAFETY_KEYS = new Set(['SPAD','TPWS','NEAR_MISS','BRIDGE_STRIKE','PERSON_STRUCK','FATALITY'])
  const safetyByDate = new Map<string, Record<string, number>>()
  for (const row of rows ?? []) {
    if (row.is_continuation) continue
    if (!SAFETY_KEYS.has(row.category)) continue
    if (!safetyByDate.has(row.report_date)) safetyByDate.set(row.report_date, {})
    const m = safetyByDate.get(row.report_date)!
    m[row.category] = (m[row.category] ?? 0) + 1
  }
  const safetyCategoryTrend: SafetyCategoryTrendPoint[] = Array.from(safetyByDate.entries())
    .map(([date, counts]) => ({ date, counts }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Count distinct reports
  const { count, error: repErr } = await sb
    .from('reports')
    .select('*', { count: 'exact', head: true })

  if (repErr) throw new Error(`Report count failed: ${repErr.message}`)

  return {
    trendPoints,
    categoryBreakdown,
    locationBreakdown,
    timeOfDayBreakdown: byHour,
    safetyCategoryTrend,
    reportCount: count ?? 0,
    windowDays,
  }
}

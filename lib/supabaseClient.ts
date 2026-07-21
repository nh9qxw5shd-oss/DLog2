'use client'

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  LogState, Incident, RosterData, CATEGORY_CONFIG, IncidentCategory,
  HazardLevel, WeatherRisk, deriveWeatherLevel, worseHazard,
} from './types'
import { backfillAreasByLocation, reapplyHighlights, londonNow, voteLogDate } from './ccilParser'

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

// ─── Carryover annotation ─────────────────────────────────────────────────────
// Queries the DB for any prior occurrence of each CCIL reference and marks
// matching incidents as continuations with an incremental delay delta.
// Returns a new LogState with annotated incidents; safe to call before save.

export async function annotateWithContinuations(log: LogState): Promise<LogState> {
  const sb = getClient()
  if (!sb || !log.date) return log

  const ccilRefs = log.incidents.map(i => i.ccil).filter((c): c is string => !!c)
  const priorByccil = new Map<string, number>()

  if (ccilRefs.length > 0) {
    const { data: priorRows } = await sb
      .from('incidents')
      .select('ccil, minutes_delay, report_date')
      .in('ccil', ccilRefs)
      .lt('report_date', log.date)
      .order('report_date', { ascending: false })

    for (const row of priorRows ?? []) {
      if (row.ccil && !priorByccil.has(row.ccil)) {
        priorByccil.set(row.ccil, row.minutes_delay ?? 0)
      }
    }
  }

  let incidents: Incident[] = log.incidents.map(inc => {
    if (inc.ccil && priorByccil.has(inc.ccil)) {
      const prevDelay = priorByccil.get(inc.ccil)!
      const delta = Math.max(0, (inc.minutesDelay ?? 0) - prevDelay)
      return { ...inc, isContinuation: true, delayDelta: delta }
    }
    return { ...inc, isContinuation: false, delayDelta: undefined }
  })

  // Backfill any null area codes from historical records for the same location
  const locationsNeedingArea = incidents
    .filter(inc => !inc.area && inc.location && inc.location !== 'Unknown')
    .map(inc => inc.location)

  if (locationsNeedingArea.length > 0) {
    const { data: areaRows } = await sb
      .from('incidents')
      .select('location, area')
      .in('location', locationsNeedingArea)
      .not('area', 'is', null)
      .limit(500)

    const dbLocationToArea = new Map<string, string>()
    for (const row of areaRows ?? []) {
      if (row.location && row.area && !dbLocationToArea.has(row.location)) {
        dbLocationToArea.set(row.location, row.area)
      }
    }

    if (dbLocationToArea.size > 0) {
      incidents = incidents.map(inc => {
        if (!inc.area && inc.location && dbLocationToArea.has(inc.location)) {
          return { ...inc, area: dbLocationToArea.get(inc.location) }
        }
        return inc
      })
    }
  }

  // Within-document: locations that gained an area from DB can now help others
  incidents = backfillAreasByLocation(incidents)

  // Re-evaluate highlights now that continuation status and delayDelta are set
  incidents = reapplyHighlights(incidents)

  return { ...log, incidents }
}

// ─── Team-at-time helper ──────────────────────────────────────────────────────
// Returns every filled roster slot whose shift window covers the given HH:MM.
// Night shifts that cross midnight (e.g. 18:00–06:00) are handled correctly.

function toMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

interface TeamMemberAtTime {
  name:  string
  role:  string
  shift: 'day' | 'night'
}

function getTeamAtTime(roster: RosterData, incidentTime: string): TeamMemberAtTime[] {
  if (!incidentTime || !/^\d{2}:\d{2}$/.test(incidentTime)) return []
  const incMins = toMins(incidentTime)

  const result: TeamMemberAtTime[] = []

  const check = (slots: typeof roster.dayShift, shift: 'day' | 'night') => {
    for (const slot of slots) {
      if (!slot.name.trim()) continue
      const s = toMins(slot.start)
      const e = toMins(slot.end)
      const onDuty = s <= e
        ? incMins >= s && incMins < e
        : incMins >= s || incMins < e   // midnight-crossing
      if (onDuty) result.push({ name: slot.name.trim(), role: slot.role, shift })
    }
  }

  check(roster.dayShift,   'day')
  check(roster.nightShift, 'night')
  return result
}

// ─── Incident row builder ──────────────────────────────────────────────────────
// Maps annotated incidents to DB-shaped rows. Shared by the replace-mode and
// additive-merge upsert paths. `id` is intentionally omitted — callers either
// let Postgres generate it (plain insert) or assign one explicitly so a merge
// can update a matched row in place (additive mode).

function buildIncidentRows(annotated: Incident[], reportId: string, reportDate: string) {
  return annotated.map(inc => {
    // Pre-compute hour-of-day and day-of-week — cheap to store, avoids repeated
    // extraction in every analytics query.
    let hourOfDay: number | null = null
    let dayOfWeek: number | null = null
    if (inc.incidentStart && /^\d{2}:\d{2}$/.test(inc.incidentStart)) {
      hourOfDay = parseInt(inc.incidentStart.slice(0, 2), 10)
    }
    if (reportDate) {
      const [y, m, d] = reportDate.split('-').map(Number)
      dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    }

    return {
      report_id:       reportId,
      report_date:     reportDate,
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
      is_off_route:    inc.isOffRoute    ?? false,
      is_continuation: inc.isContinuation ?? false,
      delay_delta:     inc.delayDelta    ?? null,

      // ── Extended Insight fields ──────────────────────────────────────────
      incident_type_code:  inc.incidentTypeCode  ?? null,
      incident_type_label: inc.incidentTypeLabel ?? null,
      display_group:       inc.displayGroup      ?? null,
      equipment:           inc.equipment         ?? null,
      line:                inc.line              ?? null,
      fault_number:        inc.faultNo           ?? null,
      possession_ref:      inc.possessionRef     ?? null,
      btp_ref:             inc.btpRef            ?? null,
      third_party_ref:     inc.thirdPartyRef     ?? null,
      action_code:         inc.actionCode        ?? null,
      responder_initials:  inc.responderInitials ?? null,
      advised_time:        inc.advisedTime       ?? null,
      initial_resp_time:   inc.initialRespTime   ?? null,
      arrived_at_time:     inc.arrivedAtTime     ?? null,
      nwr_time:            inc.nwrTime           ?? null,
      mins_to_advised:     inc.minsToAdvised     ?? null,
      mins_to_response:    inc.minsToResponse    ?? null,
      mins_to_arrival:     inc.minsToArrival     ?? null,
      incident_duration:   inc.incidentDuration  ?? null,
      train_id:            inc.trainId           ?? null,
      train_company:       inc.trainCompany      ?? null,
      train_origin:        inc.trainOrigin       ?? null,
      train_destination:   inc.trainDestination  ?? null,
      unit_numbers:        inc.unitNumbers       ?? null,
      trust_ref:           inc.trustRef          ?? null,
      tda_ref:             inc.tdaRef            ?? null,
      trmc_code:           inc.trmcCode          ?? null,
      fts_div_count:       inc.ftsDivCount       ?? null,
      event_count:         inc.eventCount        ?? null,
      events:              inc.events            ?? null,
      has_files:           inc.hasFiles          ?? false,
      hour_of_day:         hourOfDay,
      day_of_week:         dayOfWeek,
    }
  })
}

// Delay/cancellation totals for a report, computed over whatever set of rows is
// passed (incoming batch, surviving DB rows, or the union of both). Continuations
// contribute their incremental delta; off-route incidents are visibility-only and
// excluded from every total.
interface AggRow {
  is_off_route?:    boolean | null
  is_continuation?: boolean | null
  delay_delta?:     number  | null
  minutes_delay?:   number  | null
  cancelled?:       number  | null
  part_cancelled?:  number  | null
}

function computeReportTotals(rows: AggRow[]) {
  let total_delay = 0, total_cancelled = 0, total_part_cancelled = 0
  for (const r of rows) {
    if (r.is_off_route) continue
    total_delay          += r.is_continuation ? (r.delay_delta ?? 0) : (r.minutes_delay ?? 0)
    total_cancelled      += r.cancelled      ?? 0
    total_part_cancelled += r.part_cancelled ?? 0
  }
  return { total_delay, total_cancelled, total_part_cancelled }
}

// Identity key used to decide whether an incoming incident is the SAME incident
// as one already stored for a date. A CCIL ref is authoritative when present;
// otherwise fall back to a natural key (title + start time + location + category)
// so CCIL-less rows still merge instead of duplicating. The `ccil:`/`nat:`
// namespaces keep the two key spaces from ever colliding.
function incidentMatchKey(r: {
  ccil?: string | null; title?: string | null; incident_start?: string | null
  location?: string | null; category?: string | null
}): string {
  if (r.ccil && r.ccil.trim()) return 'ccil:' + r.ccil.trim().toLowerCase()
  return 'nat:' + [r.title, r.incident_start, r.location, r.category]
    .map(v => (v ?? '').toString().trim().toLowerCase())
    .join('|')
}

// ─── Daily weather statement (5 Day Look Ahead persistence) ───────────────────
// The look-ahead compiled with log date D is forward-looking from the morning
// the report is generated (D+1): column i forecasts date D+1+i. One row is
// written per forecast date so analytics can join a day's weather to that
// day's incidents on weather_date = report_date.
//
// Newest-source-wins: a forecast for date X can be written by the reports of
// logs X-5 … X-1, and the closest report carries the most up-to-date
// statement. An older report saved out of order (a backfill) never clobbers a
// newer statement. The value that finally sticks for X is the FIRST column of
// the report generated the morning of X — the last statement issued before
// X's own log exists.

function addDaysIso(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

async function upsertDailyWeather(sb: SupabaseClient, log: LogState): Promise<void> {
  if (!log.date || !log.fiveDayWeather) return

  const rows = Array.from({ length: 5 }, (_, i) => {
    const em = log.fiveDayWeather.eastMidlands[i] ?? { risks: {} }
    const ln = log.fiveDayWeather.londonNorth[i]  ?? { risks: {} }
    const emLevel: HazardLevel = deriveWeatherLevel(em)
    const lnLevel: HazardLevel = deriveWeatherLevel(ln)
    const riskTypes = Array.from(new Set([
      ...Object.keys(em.risks), ...Object.keys(ln.risks),
    ]))
    return {
      weather_date:        addDaysIso(log.date, i + 1),
      source_report_date:  log.date,
      day_offset:          i + 1,
      east_midlands_risks: em.risks,
      london_north_risks:  ln.risks,
      east_midlands_level: emLevel,
      london_north_level:  lnLevel,
      overall_level:       worseHazard(emLevel, lnLevel),
      risk_types:          riskTypes,
      risk_note:           log.lookAheadNotes?.risks[i] ?? null,
      toc_note:            log.lookAheadNotes?.toc[i]   ?? null,
      foc_note:            log.lookAheadNotes?.foc[i]   ?? null,
      updated_at:          new Date().toISOString(),
    }
  })

  const { data: existing, error: exErr } = await sb
    .from('weather_lookahead')
    .select('weather_date, source_report_date')
    .in('weather_date', rows.map(r => r.weather_date))
  if (exErr) throw new Error(`Weather look-ahead lookup failed: ${exErr.message}`)

  const existingSource = new Map(
    (existing ?? []).map(r => [r.weather_date as string, r.source_report_date as string]))

  // >= so re-generating the same day's report updates its own statement.
  const winners = rows.filter(r => {
    const prev = existingSource.get(r.weather_date)
    return !prev || r.source_report_date >= prev
  })
  if (winners.length === 0) return

  const { error } = await sb
    .from('weather_lookahead')
    .upsert(winners, { onConflict: 'weather_date', ignoreDuplicates: false })
  if (error) throw new Error(`Weather look-ahead upsert failed: ${error.message}`)
}

export interface DailyWeatherDay {
  date:              string                 // YYYY-MM-DD, joins to report_date
  sourceReportDate:  string
  eastMidlandsRisks: Partial<Record<WeatherRisk, string>>
  londonNorthRisks:  Partial<Record<WeatherRisk, string>>
  eastMidlandsLevel: HazardLevel
  londonNorthLevel:  HazardLevel
  overallLevel:      HazardLevel            // worst of both regions; GREEN = normal
  riskTypes:         WeatherRisk[]          // union across both regions
  riskNote:          string | null
}

export async function fetchWeatherHistory(
  windowDays = ANALYTICS_WINDOW_DAYS,
): Promise<DailyWeatherDay[]> {
  const sb = getClient()
  if (!sb) return []

  const today = new Date()
  const todayDate = today.toISOString().slice(0, 10)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - windowDays + 1)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const { data, error } = await sb
    .from('weather_lookahead')
    .select('weather_date, source_report_date, east_midlands_risks, london_north_risks, east_midlands_level, london_north_level, overall_level, risk_types, risk_note')
    .gte('weather_date', cutoffDate)
    .lte('weather_date', todayDate)
    .order('weather_date', { ascending: true })
  if (error) throw new Error(`Weather history fetch failed: ${error.message}`)

  return (data ?? []).map(r => ({
    date:              r.weather_date,
    sourceReportDate:  r.source_report_date,
    eastMidlandsRisks: r.east_midlands_risks ?? {},
    londonNorthRisks:  r.london_north_risks  ?? {},
    eastMidlandsLevel: r.east_midlands_level as HazardLevel,
    londonNorthLevel:  r.london_north_level  as HazardLevel,
    overallLevel:      r.overall_level       as HazardLevel,
    riskTypes:         (r.risk_types ?? []) as WeatherRisk[],
    riskNote:          r.risk_note,
  }))
}

// ─── Upsert ───────────────────────────────────────────────────────────────────
// De-duplication: upsert on report_date (unique constraint).
//
// Two modes:
//   • Replace (default) — used by the reviewed single-day raw-log flow. Existing
//     incidents for the report are cleared and re-inserted so removing an incident
//     during review and re-generating drops it from the DB.
//   • Additive (`options.additive`) — used by the historical bulk import. A
//     period may bleed across the 06:00 boundary into a day that already has
//     data; this mode never wipes that day. Incidents already present (matched by
//     CCIL, or by natural key when CCIL-less) are updated in place with the newest
//     data; genuinely new incidents are added; existing unique incidents not in
//     the batch are left untouched. Report aggregates are recomputed over the
//     merged set and report metadata is preserved for a pre-existing day.
//
// Cross-log continuation: any CCIL reference that already appears in a PRIOR
// report is flagged as a continuation. Its event-type count is suppressed and
// only the incremental delay (delta) is recorded, so multi-day incidents don't
// inflate totals.

// Thrown by the log-date integrity gates below. `overridable` distinguishes
// heuristic gates (operator may consciously bypass with force) from the
// impossible-period gate (never bypassable).
export class SaveBlockedError extends Error {
  overridable: boolean
  constructor(message: string, overridable: boolean) {
    super(message)
    this.name = 'SaveBlockedError'
    this.overridable = overridable
  }
}

export async function upsertReportData(
  log: LogState,
  options: { additive?: boolean; force?: boolean } = {},
): Promise<void> {
  const sb = getClient()
  if (!sb || !log.date) return

  const annotatedLog = await annotateWithContinuations(log)

  if (options.additive) {
    await upsertReportDataAdditive(sb, log, annotatedLog)
    return
  }

  const annotated = annotatedLog.incidents

  // ─── Log-date integrity gates ─────────────────────────────────────────────
  // report_date is the primary key of the whole analytics pipeline: one wrong
  // value blanks a day in Insight AND corrupts the day it lands on (a later
  // correctly-dated upload merges into it via the report_date unique key).
  // Mis-dated logs have reached the DB three times (22 Jun, 23 Jun, 13 Jul
  // 2026 — each time stamped with the upload day instead of the log day), so
  // these are hard failures at the save boundary, not UI warnings.

  // Gate 1 — impossible period. A log dated D covers D 06:00 → D+1 06:00
  // Europe/London; if that period hasn't STARTED yet, the date cannot be
  // right. This is exactly the recurring failure signature (a small-hours
  // upload stamped with the new day instead of the day being reported).
  // Never overridable: no genuine log describes a period in the future.
  const now = londonNow()
  if (log.date > now.date || (log.date === now.date && now.time < '06:00')) {
    throw new SaveBlockedError(
      `SAVE BLOCKED — Log Date looks wrong: the log is dated ${log.date}, but that ` +
      `06:00→06:00 period has not started yet (it is now ${now.time} on ${now.date} UK time). ` +
      `A daily log compiled overnight covers the PREVIOUS day — go back to the Roster step ` +
      `and correct the Log Date.`,
      false,
    )
  }

  // Gate 2 — the log's own rows disagree. Freshly-started incidents (not
  // continuations) always fall inside the log's period, and their CCIL header
  // timestamps are machine-stamped — so a strong majority pointing at a
  // different date means the Log Date is wrong, whatever the hand-edited
  // period header said.
  if (!options.force) {
    const vote = voteLogDate(annotated, { excludeContinuations: true, minRows: 3 })
    if (vote && vote.date !== log.date && vote.share >= 0.6) {
      throw new SaveBlockedError(
        `SAVE BLOCKED — Log Date looks wrong: ${vote.votes} of ${vote.total} newly-started ` +
        `incidents in this document are timestamped inside the ${vote.date} 06:00→06:00 period, ` +
        `but the Log Date is ${log.date}. Correct the Log Date on the Roster step ` +
        `(or use Override if you are certain).`,
        true,
      )
    }
  }

  // Gate 3 — collision with a different day's report. A legitimate re-upload
  // of the same day shares most of its CCIL references with what is already
  // stored; near-zero overlap means this date already holds a DIFFERENT
  // day's log and saving would silently interleave two days' incidents
  // (which is how 12+13 Jul 2026 ended up merged under one date).
  if (!options.force) {
    const { data: existingRep, error: exRepErr } = await sb
      .from('reports').select('id').eq('report_date', log.date).maybeSingle()
    if (exRepErr) throw new Error(`Report lookup failed: ${exRepErr.message}`)
    if (existingRep) {
      const { data: exInc, error: exIncErr } = await sb
        .from('incidents').select('ccil').eq('report_id', existingRep.id)
      if (exIncErr) throw new Error(`Incident lookup failed: ${exIncErr.message}`)
      const existingCcils = new Set(
        (exInc ?? []).map(r => (r.ccil ?? '').trim()).filter(Boolean))
      if (existingCcils.size >= 5) {
        const incoming = new Set(
          annotated.map(i => (i.ccil ?? '').trim()).filter(Boolean))
        const overlap = Array.from(existingCcils).filter(c => incoming.has(c)).length
        if (overlap / existingCcils.size < 0.25) {
          throw new SaveBlockedError(
            `SAVE BLOCKED — ${log.date} already holds a report whose ${existingCcils.size} ` +
            `incidents share almost nothing with this upload (${overlap} matching CCIL refs). ` +
            `This looks like a different day's log filed under the same date. Check the Log ` +
            `Date on the Roster step (or use Override to deliberately replace that report).`,
            true,
          )
        }
      }
    }
  }

  // Totals use delta delay for continuations, raw delay for first-seen incidents.
  // Off-route incidents are excluded — they are in the log for visibility only.
  const routeIncidents = annotated.filter(i => !i.isOffRoute)
  const totalDelay = routeIncidents.reduce((s, i) =>
    s + (i.isContinuation ? (i.delayDelta ?? 0) : (i.minutesDelay ?? 0)), 0)
  const totalCancelled     = routeIncidents.reduce((s, i) => s + (i.cancelled     || 0), 0)
  const totalPartCancelled = routeIncidents.reduce((s, i) => s + (i.partCancelled || 0), 0)

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

  // Persist the 5 Day Look Ahead statement against the dates it forecasts.
  // Only the reviewed interactive flow reaches here — the additive bulk-import
  // path returns earlier and carries no weather data, so historical imports
  // can never overwrite a real statement with empty defaults.
  await upsertDailyWeather(sb, log)

  if (annotated.length === 0) return

  const rows = buildIncidentRows(annotated, reportId, log.date)

  // CCIL-aware additive upsert: only replace incidents that are in this upload.
  // Incidents from prior uploads not covered by this batch are left untouched,
  // so re-running a period never duplicates data or loses unrelated rows.
  const incomingCcils = rows.filter(r => r.ccil).map(r => r.ccil as string)
  if (incomingCcils.length > 0) {
    const { error: delCciledErr } = await sb
      .from('incidents')
      .delete()
      .eq('report_id', reportId)
      .in('ccil', incomingCcils)
    if (delCciledErr) throw new Error(`Incident ccil-clear failed: ${delCciledErr.message}`)
  }
  const hasUncciledRows = rows.some(r => !r.ccil)
  if (hasUncciledRows) {
    const { error: delUncciledErr } = await sb
      .from('incidents')
      .delete()
      .eq('report_id', reportId)
      .is('ccil', null)
    if (delUncciledErr) throw new Error(`Incident null-clear failed: ${delUncciledErr.message}`)
  }
  const { data: insertedIncidents, error: insErr } = await sb
    .from('incidents')
    .insert(rows)
    .select('id, incident_start')
  if (insErr) throw new Error(`Incident insert failed: ${insErr.message}`)

  // Save one row per team member per incident based on who was on duty at the
  // time of each incident's start. ON DELETE CASCADE on incident_id means
  // these are automatically cleaned up whenever incidents are re-inserted.
  if (insertedIncidents && insertedIncidents.length > 0 && annotatedLog.roster) {
    const teamRows = insertedIncidents.flatMap(row => {
      if (!row.incident_start) return []
      return getTeamAtTime(annotatedLog.roster, row.incident_start).map(member => ({
        incident_id: row.id,
        report_date: log.date,
        name:        member.name,
        role:        member.role,
        shift:       member.shift,
      }))
    })
    if (teamRows.length > 0) {
      const { error: teamErr } = await sb.from('incident_team_members').insert(teamRows)
      if (teamErr) throw new Error(`Team member insert failed: ${teamErr.message}`)
    }
  }
}

// ─── Additive merge (historical bulk import) ────────────────────────────────────
// Purely adaptive: integrate a batch into a date without ever wiping data that is
// already there. Matched incidents are updated in place (preserving their row id
// and therefore their team-member rows); new incidents are inserted; existing
// unique incidents are left exactly as they were. Report aggregates are then
// recomputed over the full merged set so a bleed-over day keeps the figures from
// the incidents it already held.

async function upsertReportDataAdditive(
  sb: SupabaseClient,
  log: LogState,
  annotatedLog: LogState,
): Promise<void> {
  const annotated = annotatedLog.incidents
  if (annotated.length === 0) return

  // Ensure a report row exists. For a pre-existing day, keep its id and metadata
  // untouched — the historical import has no roster/period of its own to impose.
  const { data: existingReport, error: findErr } = await sb
    .from('reports')
    .select('id')
    .eq('report_date', log.date)
    .maybeSingle()
  if (findErr) throw new Error(`Report lookup failed: ${findErr.message}`)

  let reportId: string
  if (existingReport) {
    reportId = existingReport.id
  } else {
    const { data: created, error: createErr } = await sb
      .from('reports')
      .insert({
        report_date:    log.date,
        period:         log.period        || null,
        control_centre: log.controlCentre || null,
        created_by:     log.createdBy     || null,
        season_mode:    log.seasonMode,
      })
      .select('id')
      .single()
    if (createErr) throw new Error(`Report create failed: ${createErr.message}`)
    reportId = created.id
  }

  // Pull existing incidents for this report so we can tell apart "already here"
  // (update in place) from "new" (insert), and recompute totals over survivors.
  const { data: existingIncidents, error: exErr } = await sb
    .from('incidents')
    .select('id, ccil, title, incident_start, location, category, minutes_delay, delay_delta, is_continuation, is_off_route, cancelled, part_cancelled')
    .eq('report_id', reportId)
  if (exErr) throw new Error(`Existing incident fetch failed: ${exErr.message}`)

  const existingByKey = new Map<string, { id: string }>()
  for (const ex of existingIncidents ?? []) {
    const k = incidentMatchKey(ex)
    if (!existingByKey.has(k)) existingByKey.set(k, ex)
  }

  // Build incoming rows. Collapse any that share a match key (a CCIL listed twice
  // in one export, or identical CCIL-less rows) to a single row — newest wins — so
  // the in-place upsert never targets the same id twice in one payload.
  const dedupedRows = Array.from(
    buildIncidentRows(annotated, reportId, log.date)
      .reduce((m, r) => m.set(incidentMatchKey(r), r), new Map<string, ReturnType<typeof buildIncidentRows>[number]>())
      .values()
  )
  const baseRows = dedupedRows
  const incomingKeys = new Set(baseRows.map(incidentMatchKey))
  const rows: Array<{ id: string } & ReturnType<typeof buildIncidentRows>[number]> = []
  const newRows: typeof rows = []
  for (const r of baseRows) {
    const match = existingByKey.get(incidentMatchKey(r))
    if (match) {
      rows.push({ id: match.id, ...r })
    } else {
      const withId = { id: crypto.randomUUID(), ...r }
      rows.push(withId)
      newRows.push(withId)
    }
  }

  // Existing incidents the batch did NOT touch — left completely as-is.
  const surviving = (existingIncidents ?? []).filter(ex => !incomingKeys.has(incidentMatchKey(ex)))

  const { error: mergeErr } = await sb
    .from('incidents')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: false })
  if (mergeErr) throw new Error(`Incident merge failed: ${mergeErr.message}`)

  // Recompute report aggregates over the merged set: survivors + everything we
  // just upserted. This restores the figures a bleed-over day already had.
  const totals = computeReportTotals([...surviving, ...rows])
  const { error: aggErr } = await sb
    .from('reports')
    .update({
      ...totals,
      incident_count: surviving.length + rows.length,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', reportId)
  if (aggErr) throw new Error(`Report aggregate update failed: ${aggErr.message}`)

  // Team members only for newly inserted incidents — matched incidents keep the
  // team rows already attached to their (unchanged) id. Historical imports carry
  // an empty roster, so this is typically a no-op, but stays correct if one day a
  // roster is supplied alongside the import.
  if (newRows.length > 0 && annotatedLog.roster) {
    const teamRows = newRows.flatMap(row => {
      if (!row.incident_start) return []
      return getTeamAtTime(annotatedLog.roster, row.incident_start).map(member => ({
        incident_id: row.id,
        report_date: log.date,
        name:        member.name,
        role:        member.role,
        shift:       member.shift,
      }))
    })
    if (teamRows.length > 0) {
      const { error: teamErr } = await sb.from('incident_team_members').insert(teamRows)
      if (teamErr) throw new Error(`Team member insert failed: ${teamErr.message}`)
    }
  }
}

// ─── Fetch historical data for chart rendering ────────────────────────────────

export async function fetchHistoricalData(
  windowDays = ANALYTICS_WINDOW_DAYS,
): Promise<HistoricalChartData | null> {
  const sb = getClient()
  if (!sb) return null

  const today = new Date()
  const todayDate = today.toISOString().slice(0, 10)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - windowDays + 1)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  // Paginate to collect all incidents in the window.
  // PostgREST's server-side max-rows cap (typically 1 000) silently truncates
  // any single request — .limit(N) cannot exceed it. Fetching in 1 000-row
  // pages via .range() stays within the cap per request while gathering
  // everything, so recent dates are never dropped from the chart.
  type IncidentRow = {
    report_date: string; category: string; minutes_delay: number
    delay_delta: number | null; is_continuation: boolean; is_off_route: boolean
    location: string | null; incident_start: string | null
  }
  const rows: IncidentRow[] = []
  const PAGE = 1_000
  let offset = 0
  while (true) {
    const { data: page, error } = await sb
      .from('incidents')
      .select('report_date, category, minutes_delay, delay_delta, is_continuation, is_off_route, location, incident_start')
      .gte('report_date', cutoffDate)
      .lte('report_date', todayDate)
      .order('report_date', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`Historical fetch failed: ${error.message}`)
    if (!page || page.length === 0) break
    rows.push(...(page as IncidentRow[]))
    if (page.length < PAGE) break
    offset += PAGE
  }

  // ── Delay trend: aggregate by report_date ───────────────────────────────
  // Use delay_delta for continuations so multi-day incidents don't double-count.
  // Exclude continuations from incidentCount so the count and average-delay-per-
  // incident charts reflect new incidents only, not repeated carry-overs.
  // Off-route incidents are excluded from delay totals (visibility only).
  const byDate = new Map<string, { totalDelay: number; incidentCount: number }>()
  for (const row of rows ?? []) {
    const agg = byDate.get(row.report_date) ?? { totalDelay: 0, incidentCount: 0 }
    const delayContrib = row.is_off_route
      ? 0
      : row.is_continuation
        ? (row.delay_delta ?? 0)
        : (row.minutes_delay ?? 0)
    byDate.set(row.report_date, {
      totalDelay:    agg.totalDelay    + delayContrib,
      incidentCount: agg.incidentCount + (row.is_continuation ? 0 : 1),
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

// ─── App settings (global) ────────────────────────────────────────────────────

const APP_SETTINGS_KEY = 'category-settings'

export async function saveAppSettings(data: unknown): Promise<void> {
  const sb = getClient()
  if (!sb) return
  await sb
    .from('app_settings')
    .upsert({ key: APP_SETTINGS_KEY, value: data, updated_at: new Date().toISOString() })
}

export async function loadAppSettings(): Promise<unknown | null> {
  const sb = getClient()
  if (!sb) return null
  const { data, error } = await sb
    .from('app_settings')
    .select('value')
    .eq('key', APP_SETTINGS_KEY)
    .maybeSingle()
  if (error) return null
  return data?.value ?? null
}

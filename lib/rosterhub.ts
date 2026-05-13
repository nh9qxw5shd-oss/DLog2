'use client'

// ─── rosterhub integration ────────────────────────────────────────────────────
// Pulls published roster data from the sibling "rosterhub" Supabase project
// and maps it into DLog2's RosterData shape.
//
// Auto-import is a "nice to have" layer — the manual Roster Entry UI is
// preserved. The user can click Import to fill in names/times from rosterhub
// for the report date, then edit anything the parser couldn't infer.
//
// rosterhub stores rosters as one row per (link, week_ending) in roster_weeks.
// The `data` JSONB contains:
//   { sections: [ { title, rows: [ { staff_name, shifts: { sun..sat: <code> } } ] } ] }
// Shift cells are free-text. Sometimes they contain times like "06:00-18:00";
// sometimes they're codes like "AL"/"OFF"/"SPARE" meaning the person is not
// working that day. We parse times when present and skip the rest.

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { RosterData, ShiftSlot } from './types'

let _client: SupabaseClient | null = null

function getRosterhubClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_ROSTERHUB_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_ROSTERHUB_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!_client) _client = createClient(url, key)
  return _client
}

export function isRosterhubConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_ROSTERHUB_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_ROSTERHUB_SUPABASE_ANON_KEY
  )
}

// Configurable list of rosterhub "link" codes (roster groups) to merge.
// Defaults to CTRL+SNDM — adjust via env if more groups feed DLog2.
function getLinks(): string[] {
  const raw = process.env.NEXT_PUBLIC_ROSTERHUB_LINKS
  if (!raw) return ['CTRL', 'SNDM']
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
type DayKey = typeof DAY_KEYS[number]

// rosterhub keys weeks by Saturday week_ending. Find the Saturday on/after
// the given date in local time (matches rosterhub's UI behaviour).
function weekEndingSaturday(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay()              // 0=Sun … 6=Sat
  const daysToSat = (6 - dow + 7) % 7
  dt.setUTCDate(dt.getUTCDate() + daysToSat)
  return dt.toISOString().slice(0, 10)
}

function dayKeyFor(isoDate: string): DayKey {
  const [y, m, d] = isoDate.split('-').map(Number)
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// rosterhub uses these codes for non-working days; treat as "skip this row".
const NON_WORKING_CODES = new Set([
  'AL', 'OFF', 'REST', 'SPARE', 'LROP', 'TOIL', 'SICK',
  'FAM', 'UN', 'PH', 'TR', 'CRS', 'COURSE', 'BH',
])

// Extract one HH:MM time from `s` starting at `fromIndex`. Accepts colon form
// (07:00) or 4-digit form (0700). Returns the time string and the position
// just past the match, or null if nothing parseable was found.
function parseTime(s: string, fromIndex = 0): { time: string; nextIndex: number } | null {
  const slice = s.slice(fromIndex)

  const colon = slice.match(/(\d{1,2}):(\d{2})/)
  const digits = slice.match(/(?<!\d)(\d{4})(?!\d)/)

  let pick: { hh: number; mm: number; offset: number; len: number } | null = null

  if (colon && colon.index !== undefined) {
    pick = {
      hh: parseInt(colon[1], 10),
      mm: parseInt(colon[2], 10),
      offset: colon.index,
      len: colon[0].length,
    }
  }
  if (digits && digits.index !== undefined) {
    if (!pick || digits.index < pick.offset) {
      pick = {
        hh: parseInt(digits[1].slice(0, 2), 10),
        mm: parseInt(digits[1].slice(2, 4), 10),
        offset: digits.index,
        len: 4,
      }
    }
  }
  if (!pick) return null
  if (pick.hh > 23 || pick.mm > 59) return null

  const time =
    String(pick.hh).padStart(2, '0') + ':' + String(pick.mm).padStart(2, '0')
  return { time, nextIndex: fromIndex + pick.offset + pick.len }
}

// Parse a rosterhub shift cell into start/end times. Returns null when the
// cell is empty, a non-working code, or contains no parseable time.
// If only one time is found, default the end to start + 12 hours.
function parseShiftCell(raw: string): { start: string; end: string } | null {
  const v = raw.trim()
  if (!v) return null
  if (NON_WORKING_CODES.has(v.toUpperCase())) return null
  if (!/\d/.test(v)) return null

  const first = parseTime(v, 0)
  if (!first) return null

  const second = parseTime(v, first.nextIndex)
  let end: string
  if (second) {
    end = second.time
  } else {
    const [sh, sm] = first.time.split(':').map(Number)
    const eh = (sh + 12) % 24
    end = String(eh).padStart(2, '0') + ':' + String(sm).padStart(2, '0')
  }
  return { start: first.time, end }
}

// Map rosterhub section titles to DLog2's standard role abbreviations.
// Unrecognised titles are used as-is — users can still edit after import.
const SECTION_TITLE_TO_ROLE: Record<string, string> = {
  'SNDM':                       'SNDM',
  'Route Control Manager':       'RCM',
  'Incident Controller 1':       'IC',
  'Incident Controller 2':       'IC2',
  'Train Running Controller':    'TRC',
  'WH TRC':                      'WH TRC',
  'Incident Support Controller': 'ISC',
  'Train Safety Engineer':       'TSE',
}

function mapRole(sectionTitle: string, link: string): string {
  return SECTION_TITLE_TO_ROLE[sectionTitle] ?? sectionTitle ?? link ?? 'Staff'
}

interface RosterhubRow {
  staff_name?: string
  shifts?: Record<string, string>
}
interface RosterhubSection {
  title?: string
  rows?: RosterhubRow[]
}
interface RosterhubWeekData {
  sections?: RosterhubSection[]
}
interface RosterhubWeekRow {
  link: string
  week_ending: string
  data: RosterhubWeekData | null
}

export interface RosterhubImportResult {
  roster: RosterData
  knownNames: string[]
  sourceLinks: string[]
  date: string
  weekEnding: string
  skippedRows: number       // staff rows that had no parseable time for this day
}

export async function fetchRosterFromHub(isoDate: string): Promise<RosterhubImportResult> {
  const sb = getRosterhubClient()
  if (!sb) {
    throw new Error(
      'rosterhub is not configured. Set NEXT_PUBLIC_ROSTERHUB_SUPABASE_URL and ' +
      'NEXT_PUBLIC_ROSTERHUB_SUPABASE_ANON_KEY in Vercel env vars.'
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('Set the Log Date before importing.')
  }

  const links = getLinks()
  const weekEnding = weekEndingSaturday(isoDate)
  const dayKey = dayKeyFor(isoDate)

  const { data, error } = await sb
    .from('roster_weeks')
    .select('link, week_ending, status, data')
    .eq('week_ending', weekEnding)
    .in('link', links)
    .eq('status', 'published')

  if (error) throw new Error(`rosterhub fetch failed: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error(
      `No published roster found for week ending ${weekEnding} (links: ${links.join(', ')}).`
    )
  }

  const dayShift: ShiftSlot[] = []
  const nightShift: ShiftSlot[] = []
  const names = new Set<string>()
  const sourceLinks: string[] = []
  let skipped = 0

  for (const week of data as RosterhubWeekRow[]) {
    if (!week.data?.sections) continue
    sourceLinks.push(week.link)
    for (const section of week.data.sections) {
      const role = mapRole((section.title || '').toString().trim(), week.link)
      for (const row of section.rows ?? []) {
        const name = (row.staff_name || '').trim()
        if (!name) continue
        names.add(name)

        const cell = row.shifts?.[dayKey]
        if (!cell) continue
        const parsed = parseShiftCell(cell)
        if (!parsed) { skipped++; continue }

        const startHour = parseInt(parsed.start.slice(0, 2), 10)
        const slot: ShiftSlot = { role, name, start: parsed.start, end: parsed.end }
        // 06:00–17:59 starts → day shift; everything else → night.
        if (startHour >= 6 && startHour < 18) dayShift.push(slot)
        else nightShift.push(slot)
      }
    }
  }

  return {
    roster: { dayShift, nightShift },
    knownNames: Array.from(names).sort(),
    sourceLinks,
    date: isoDate,
    weekEnding,
    skippedRows: skipped,
  }
}

// Pull the canonical staff list from rosterhub's staff_directory for use as a
// typeahead in manual roster entry. Silent failure: if the table isn't
// readable (RLS) or rosterhub isn't configured, returns an empty list.
export async function fetchKnownStaffNames(): Promise<string[]> {
  const sb = getRosterhubClient()
  if (!sb) return []
  const { data, error } = await sb
    .from('staff_directory')
    .select('canonical_name')
    .eq('is_active', true)
    .order('canonical_name')
  if (error || !data) return []
  return data
    .map(r => (r as { canonical_name: string | null }).canonical_name)
    .filter((n): n is string => !!n)
}

import { parseCCILText } from './ccilParser'
import {
  Incident, LogState, Severity,
  DEFAULT_ROSTER,
  makeEmptyFiveDayWeather,
  makeEmptyLookAheadNotes,
  makeEmptySeasonalData,
} from './types'

// ─── Regex duplicated from ccilParser — keeps this module independent ─────────
// Matches: | Title | **Location:** | **Incident 3173890 ** | 05/12/2025 15:00 |
const INCIDENT_HEADER =
  /^\|\s*(.+?)\s*\|\s*\*\*Location:\*\*\s*\|\s*\*\*Incident\s+(\d+)\s*\*\*\s*\|\s*([\d\/]+ [\d:]+)\s*\|$/i

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Helpers ──────────────────────────────────────────────────────────────────

// DD/MM/YYYY HH:MM → YYYY-MM-DD period-start date.
// CCIL shifts run 06:00→06:00, so incidents before 06:00 belong to the
// previous calendar day's period.
function periodDateFor(dateStr: string): string {
  const [datePart, timePart] = dateStr.trim().split(' ')
  const [dd, mm, yyyy] = datePart.split('/')
  const hour = parseInt(timePart?.slice(0, 2) ?? '06', 10)
  if (isNaN(hour) || hour >= 6) {
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  // Before 06:00 → roll back one day
  const d = new Date(Date.UTC(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// "2025-01-15" → "15 Jan 2025 06:00 TO 16 Jan 2025 06:00"
function periodString(startDate: string): string {
  const [y, m, d] = startDate.split('-').map(Number)
  const end = new Date(Date.UTC(y, m - 1, d + 1))
  return (
    `${d} ${MONTHS[m - 1]} ${y} 06:00 TO ` +
    `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()} 06:00`
  )
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PeriodSlice {
  date: string        // YYYY-MM-DD period-start date
  period: string      // "15 Jan 2025 06:00 TO 16 Jan 2025 06:00"
  incidents: Incident[]
}

// ─── Core split function ──────────────────────────────────────────────────────

/**
 * Splits a multi-date CCIL export into individual 24-hour period slices.
 *
 * Uses the per-incident DD/MM/YYYY HH:MM timestamp in each incident header to
 * determine which 06:00→06:00 period the incident belongs to, then passes each
 * period's lines through the existing parseCCILText() unchanged.
 *
 * labelOverrides and groupSeverities should be sourced from readCategorySettings()
 * in the calling component, matching how app/page.tsx invokes parseCCILText().
 */
export function splitCCILByPeriod(
  parseSource: string,
  labelOverrides: Record<string, string> = {},
  groupSeverities: Record<string, Severity> = {},
): PeriodSlice[] {
  const lines = parseSource.split('\n')

  // Collect all incident header positions with their period dates
  const headers: Array<{ lineIdx: number; periodDate: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(INCIDENT_HEADER)
    if (!m) continue
    headers.push({ lineIdx: i, periodDate: periodDateFor(m[3]) })
  }

  if (headers.length === 0) return []

  // For each header, collect the block of lines up to the next header,
  // then group those blocks by period date. This handles non-contiguous
  // periods correctly (e.g. out-of-order incident timestamps).
  const periodBlocks = new Map<string, string[]>()
  for (let h = 0; h < headers.length; h++) {
    const { lineIdx, periodDate } = headers[h]
    const nextLineIdx = h + 1 < headers.length ? headers[h + 1].lineIdx : lines.length
    const block = lines.slice(lineIdx, nextLineIdx).join('\n')
    if (!periodBlocks.has(periodDate)) periodBlocks.set(periodDate, [])
    periodBlocks.get(periodDate)!.push(block)
  }

  // Parse each period's accumulated blocks using the existing unmodified parser
  const results: PeriodSlice[] = []
  for (const [date, blocks] of periodBlocks) {
    const text = blocks.join('\n')
    const incidents = parseCCILText(text, labelOverrides, groupSeverities)
    results.push({ date, period: periodString(date), incidents })
  }

  results.sort((a, b) => a.date.localeCompare(b.date))
  return results
}

// ─── LogState factory ─────────────────────────────────────────────────────────

/**
 * Wraps a PeriodSlice in a minimal LogState suitable for upsertReportData().
 * Roster, weather, and look-ahead fields are left at their empty defaults since
 * this is historical data where those forward-looking fields have no meaning.
 */
export function makeHistoricLogState(
  slice: PeriodSlice,
  createdBy?: string,
): LogState {
  return {
    date:           slice.date,
    period:         slice.period,
    controlCentre:  'East Midlands Control Centre (EMCC)',
    createdBy,
    incidents:      slice.incidents,
    roster:         DEFAULT_ROSTER,
    fiveDayWeather: makeEmptyFiveDayWeather(),
    lookAheadNotes: makeEmptyLookAheadNotes(),
    ...makeEmptySeasonalData(),
    status:         'reviewed',
  }
}

import { CCIL_LABEL_MAP, normalizeForLookup } from './ccilParser'
import {
  Incident, IncidentCategory, IncidentEvent, LogState, Severity,
  DEFAULT_ROSTER,
  makeEmptyFiveDayWeather,
  makeEmptyLookAheadNotes,
  makeEmptySeasonalData,
} from './types'

// ─── Local mirrors of unexported ccilParser constants ─────────────────────────

const BUILT_IN_CATS = new Set<string>([
  'FATALITY','PERSON_STRUCK','SPAD','TPWS','IRREGULAR_WORKING','NEAR_MISS','CRIME',
  'BRIDGE_STRIKE','HABD_WILD','LEVEL_CROSSING','FIRE','PASSENGER_INJURY','DERAILMENT',
  'INFRASTRUCTURE','TRACTION_FAILURE','TRAIN_FAULT','POSSESSION','STATION_OVERRUN',
  'STRANDED_TRAIN','WEATHER','GENERAL',
])

// Mirrors SEVERITY_RULES
const SEVERITY_MAP: Array<[string[], Severity]> = [
  [['FATALITY','PERSON_STRUCK','DERAILMENT'],                                     'CRITICAL'],
  [['SPAD','FIRE','BRIDGE_STRIKE'],                                               'HIGH'],
  [['TPWS','NEAR_MISS','IRREGULAR_WORKING','HABD_WILD',
    'CRIME','LEVEL_CROSSING','PASSENGER_INJURY','TRACTION_FAILURE','STATION_OVERRUN'], 'MEDIUM'],
  [['INFRASTRUCTURE','POSSESSION','TRAIN_FAULT'],                                 'LOW'],
]

// Mirrors SKIP_TITLE_PATTERNS — applied to both title and incident type label
const SKIP_PATTERNS = [
  /daily.*operations.*log/i,
  /daily.*fleet.*log/i,
  /fleet.*log/i,
  /\bTRC\b.*log/i,
  /WH TRC/i,
  /West Hampstead TRC/i,
  /WHTRC/i,
  /Eastern Region.*log/i,
  /actions.*taken.*improve.*performance/i,
  /supervisors.*log/i,
  /operations.*supervisors/i,
  /cancellations.*log/i,
  /scratch.*pad/i,
  /maintenance.*control.*scratch/i,
  /\bMAFU\b/i,
  /SOM Failure/i,
  /possession.*monitoring/i,
  /week \d+ possession/i,
  /item \d+ - possession/i,
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function severityForCategory(cat: IncidentCategory): Severity {
  for (let i = 0; i < SEVERITY_MAP.length; i++) {
    if (SEVERITY_MAP[i][0].indexOf(cat) !== -1) return SEVERITY_MAP[i][1]
  }
  return 'INFO'
}

// DD/MM/YYYY HH:MM → YYYY-MM-DD period-start date (06:00→06:00 shift boundary)
function periodDateFor(dateStr: string): string {
  const parts = dateStr.trim().split(' ')
  const datePart = parts[0]
  const timePart = parts[1] ?? ''
  const dmy = datePart.split('/')
  const dd = dmy[0], mm = dmy[1], yyyy = dmy[2]
  const hour = parseInt(timePart.slice(0, 2), 10)
  if (isNaN(hour) || hour >= 6) {
    return yyyy + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0')
  }
  const d = new Date(Date.UTC(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function periodString(startDate: string): string {
  const parts = startDate.split('-').map(Number)
  const y = parts[0], m = parts[1], d = parts[2]
  const end = new Date(Date.UTC(y, m - 1, d + 1))
  return (
    d + ' ' + MONTHS[m - 1] + ' ' + y + ' 06:00 TO ' +
    end.getUTCDate() + ' ' + MONTHS[end.getUTCMonth()] + ' ' + end.getUTCFullYear() + ' 06:00'
  )
}

// ─── CSV / TSV parsing ────────────────────────────────────────────────────────
// Handles RFC 4180 quoting rules: double-quoted fields may contain the
// delimiter, newlines, and escaped quotes (two consecutive double-quotes).

function detectDelimiter(firstLine: string): string {
  const tabs   = (firstLine.match(/\t/g)  || []).length
  const commas = (firstLine.match(/,/g)   || []).length
  return tabs > commas ? '\t' : ','
}

function parseCSVText(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2 }
      else if (ch === '"')                   { inQuotes = false; i++ }
      else                                   { field += ch; i++ }
    } else {
      if      (ch === '"')                         { inQuotes = true; i++ }
      else if (ch === delim)                       { row.push(field); field = ''; i++ }
      else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; i += 2
      }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++ }
      else                  { field += ch; i++ }
    }
  }
  if (row.length > 0 || field !== '') {
    row.push(field)
    if (row.some(function(f) { return f.trim() !== '' })) rows.push(row)
  }
  return rows
}

// ─── Event cell parsing ───────────────────────────────────────────────────────
// Each event cell: "[N - DD/MM/YYYY HH:MM] description text (possibly multiline)"

const EVENT_RE = /^\[(\d+)\s*-\s*(\d{2})\/(\d{2})\/\d{4}\s+(\d{2}:\d{2})\]\s*([\s\S]*)$/

function parseEventCell(cell: string): IncidentEvent | null {
  const m = cell.trim().match(EVENT_RE)
  if (!m) return null
  return {
    date:        m[2] + '/' + m[3],   // DD/MM
    time:        m[4],                 // HH:MM
    company:     '',
    description: m[5].trim(),
  }
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function extractHHMM(ts: string): string {
  if (!ts) return ''
  const parts = ts.trim().split(' ')
  return parts.length > 1 ? parts[1] : ''
}

function parseDT(ts: string): number | null {
  const m = ts ? ts.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/) : null
  if (!m) return null
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5])
}

function dtDiffMins(fromTs: string, toTs: string): number | undefined {
  const a = parseDT(fromTs)
  const b = parseDT(toTs)
  if (a === null || b === null) return undefined
  const mins = Math.round((b - a) / 60000)
  return mins >= 0 ? mins : undefined
}

// ─── Category / severity resolution ──────────────────────────────────────────

function resolveCategory(
  rawLabel: string,
  labelOverrides: Record<string, string>,
  groupSeverities: Record<string, Severity>,
): { category: IncidentCategory; severity: Severity; displayGroup?: string } {
  const norm = normalizeForLookup(rawLabel)

  // 1. User-configured label overrides (highest priority)
  const overrideKey = labelOverrides[norm]
  if (overrideKey) {
    if (BUILT_IN_CATS.has(overrideKey)) {
      const cat = overrideKey as IncidentCategory
      return { category: cat, severity: groupSeverities[overrideKey] ?? severityForCategory(cat) }
    }
    return { category: 'GENERAL', severity: groupSeverities[overrideKey] ?? 'INFO', displayGroup: overrideKey }
  }

  // 2. Built-in CCIL label map
  for (let i = 0; i < CCIL_LABEL_MAP.length; i++) {
    if (normalizeForLookup(CCIL_LABEL_MAP[i][0]) === norm) {
      const cat = CCIL_LABEL_MAP[i][1]
      return { category: cat, severity: severityForCategory(cat) }
    }
  }

  return { category: 'GENERAL', severity: 'INFO' }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PeriodSlice {
  date: string        // YYYY-MM-DD period-start date
  period: string      // "15 Jan 2025 06:00 TO 16 Jan 2025 06:00"
  incidents: Incident[]
}

// ─── Main CSV parser ──────────────────────────────────────────────────────────

/**
 * Parses a CCIL CSV/TSV export and splits it into individual 24-hour period
 * slices using the per-row Incident Start timestamp and a 06:00→06:00
 * shift boundary. Auto-detects tab vs comma delimiter.
 *
 * labelOverrides and groupSeverities should be sourced from readCategorySettings()
 * in the calling component, matching the pattern used by parseCCILText().
 */
export function parseCCILCSV(
  csvText: string,
  labelOverrides: Record<string, string> = {},
  groupSeverities: Record<string, Severity> = {},
): PeriodSlice[] {
  const firstLine = csvText.slice(0, csvText.indexOf('\n'))
  const delim = detectDelimiter(firstLine)
  const rows  = parseCSVText(csvText, delim)
  if (rows.length < 2) return []

  // Build column name → index map; trim leading/trailing spaces from header names
  const headers = rows[0].map(function(h) { return h.trim() })
  function col(name: string): number { return headers.indexOf(name) }

  const eventsCol = col('Events')  // all columns at this index and beyond are event cells

  const C = {
    ccil:         col('CCIL Ref'),
    title:        col('Incident Title'),
    start:        col('Incident Start'),
    type:         col('Incident Type'),
    area:         col('Area'),
    location:     col('Start/At Location'),
    line:         col('Line'),
    advisedAt:    col('Advised At'),
    initialResp:  col('Initial Response Advised'),
    arrivedAt:    col('Arrived At'),
    nwr:          col('Normal Working Resumed'),
    faultNo:      col('Fault Number'),
    btpRef:       col('BTP Reference'),
    tdaRef:       col('TDA Numbers'),
    cancelled:    col('Full Cancelation'),
    partCancelled:col('Part Cancelation'),
    trains:       col('Number of Trains'),
    delay:        col('Total Delay Minutes'),
    ftsdiv:       col('FTS/Div'),
    hasFiles:     col('Has Files'),
    eventCount:   col('Number of Events'),
  }

  function get(row: string[], idx: number): string {
    return idx >= 0 ? (row[idx] ?? '').trim() : ''
  }

  // Plain object + order array — avoids Map iteration (ES5 target constraint)
  const periodOrder: string[] = []
  const periodMap: Record<string, Incident[]> = {}

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const startTs = get(row, C.start)
    if (!startTs) continue

    const title     = get(row, C.title)
    const typeLabel = get(row, C.type)

    // Skip administrative log entries (same patterns as DOCX parser)
    if (SKIP_PATTERNS.some(function(p) { return p.test(title) || p.test(typeLabel) })) continue

    const { category, severity, displayGroup } = resolveCategory(typeLabel, labelOverrides, groupSeverities)

    // Parse event cells (trailing columns from eventsCol onward)
    const events: IncidentEvent[] = []
    if (eventsCol >= 0) {
      for (let c = eventsCol; c < row.length; c++) {
        const ev = parseEventCell(row[c])
        if (ev) events.push(ev)
      }
      // Sort chronologically by date+time string
      events.sort(function(a, b) {
        return (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time)
      })
    }

    const advisedAt   = get(row, C.advisedAt)
    const initialResp = get(row, C.initialResp)
    const arrivedAt   = get(row, C.arrivedAt)
    const nwrTs       = get(row, C.nwr)
    const minutesDelay = parseInt(get(row, C.delay), 10) || undefined

    const incident: Incident = {
      id:               get(row, C.ccil) || String(r),
      ccil:             get(row, C.ccil) || undefined,
      category,
      severity,
      title,
      location:         get(row, C.location),
      area:             get(row, C.area)    || undefined,
      line:             get(row, C.line)    || undefined,
      incidentStart:    extractHHMM(startTs) || undefined,
      description:      '',
      events:           events.length > 0 ? events : undefined,
      cancelled:        parseInt(get(row, C.cancelled),     10) || undefined,
      partCancelled:    parseInt(get(row, C.partCancelled), 10) || undefined,
      trainsDelayed:    parseInt(get(row, C.trains),        10) || undefined,
      minutesDelay,
      faultNo:          get(row, C.faultNo) || undefined,
      btpRef:           get(row, C.btpRef)  || undefined,
      tdaRef:           get(row, C.tdaRef)  || undefined,
      ftsDivCount:      parseInt(get(row, C.ftsdiv),     10) || undefined,
      hasFiles:         get(row, C.hasFiles).toLowerCase() === 'yes',
      eventCount:       parseInt(get(row, C.eventCount), 10) || undefined,
      incidentTypeLabel: typeLabel || undefined,
      isHighlight:      severity === 'CRITICAL' || severity === 'HIGH' || (minutesDelay ?? 0) >= 60,
      isContinuation:   false,
      displayGroup,
      advisedTime:      extractHHMM(advisedAt)   || undefined,
      initialRespTime:  extractHHMM(initialResp) || undefined,
      arrivedAtTime:    extractHHMM(arrivedAt)   || undefined,
      nwrTime:          extractHHMM(nwrTs)       || undefined,
      minsToAdvised:    dtDiffMins(startTs, advisedAt),
      minsToResponse:   dtDiffMins(startTs, initialResp),
      minsToArrival:    dtDiffMins(startTs, arrivedAt),
      incidentDuration: dtDiffMins(startTs, nwrTs),
    }

    const periodDate = periodDateFor(startTs)
    if (!periodMap[periodDate]) {
      periodOrder.push(periodDate)
      periodMap[periodDate] = []
    }
    periodMap[periodDate].push(incident)
  }

  const results: PeriodSlice[] = []
  for (let i = 0; i < periodOrder.length; i++) {
    const date = periodOrder[i]
    results.push({ date, period: periodString(date), incidents: periodMap[date] })
  }
  results.sort(function(a, b) { return a.date.localeCompare(b.date) })
  return results
}

// ─── LogState factory ─────────────────────────────────────────────────────────

/**
 * Wraps a PeriodSlice in a minimal LogState for upsertReportData().
 * Roster, weather, and look-ahead fields are left at empty defaults since
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

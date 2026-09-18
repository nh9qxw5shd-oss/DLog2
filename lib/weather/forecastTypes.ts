// ─── NR Route 7 Day Forecast — shared vocabulary ─────────────────────────────
//
// This file is the contract between the three EMCC systems that consume the
// Network Rail / MetDesk "East Midlands Route 7 Day Forecast" PDF:
//
//   DLog2               parses the PDF and writes weather_forecasts /
//                       weather_forecast_days (see migration 014)
//   0815 (09:00 call)   reads the latest forecast for the agenda weather table
//   Messaging-Assistant reads the latest forecast for the 05:30 message
//
// Keep the copies in the three repos identical (lib/weather/forecastTypes.ts,
// src/lib/weather/forecastTypes.ts). No runtime dependencies.

export type HazardLevel = 'GREEN' | 'AWARE' | 'ADVERSE' | 'EXTREME'
export type RiskLevel   = Exclude<HazardLevel, 'GREEN'>
export type Confidence  = 'High' | 'Medium' | 'Low'

export const HAZARD_RANK: Record<HazardLevel, number> = {
  GREEN: 0, AWARE: 1, ADVERSE: 2, EXTREME: 3,
}

export const HAZARD_LABEL: Record<HazardLevel, string> = {
  GREEN: 'Normal', AWARE: 'Aware', ADVERSE: 'Adverse', EXTREME: 'Extreme',
}

export function worseHazard(a: HazardLevel, b: HazardLevel): HazardLevel {
  return HAZARD_RANK[a] >= HAZARD_RANK[b] ? a : b
}

/** The word the forecast prints inside a coloured cell → hazard level. */
export function hazardFromWord(word: string | null | undefined): HazardLevel | null {
  if (!word) return null
  const w = word.trim().toLowerCase()
  if (w === 'normal' || w === 'green' || w === 'none')   return 'GREEN'
  if (w === 'aware'   || w === 'yellow')                 return 'AWARE'
  if (w === 'adverse' || w === 'alert' || w === 'amber') return 'ADVERSE'
  if (w === 'extreme' || w === 'red')                    return 'EXTREME'
  return null
}

// ─── Forecast areas (the four sections of the 7 day forecast) ────────────────

export type ForecastAreaKey = 'lincolnshire' | 'em_north' | 'em_south' | 'london_luton'

export const FORECAST_AREAS: ReadonlyArray<{
  key: ForecastAreaKey
  /** Heading exactly as the PDF prints it (minus the "(East Midlands)" suffix). */
  pdfName: string
  /** Long label for documents and messages. */
  label: string
  /** Short label for dense tables. */
  short: string
}> = [
  { key: 'lincolnshire', pdfName: 'Lincolnshire',    label: 'Lincolnshire',         short: 'Lincs'    },
  { key: 'em_north',     pdfName: 'East Mids North', label: 'East Midlands North',  short: 'EM North' },
  { key: 'em_south',     pdfName: 'East Mids South', label: 'East Midlands South',  short: 'EM South' },
  { key: 'london_luton', pdfName: 'London - Luton',  label: 'London - Luton',       short: 'Ldn-Luton' },
]

export const FORECAST_AREA_KEYS: ForecastAreaKey[] = FORECAST_AREAS.map(a => a.key)

export function forecastAreaMeta(key: string) {
  for (let i = 0; i < FORECAST_AREAS.length; i++) {
    if (FORECAST_AREAS[i].key === key) return FORECAST_AREAS[i]
  }
  return null
}

/** Map a "Summary Hazards - <name> (<route>)" heading onto a stable area key. */
export function areaKeyFromName(name: string): ForecastAreaKey | string {
  const n = name.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
  if (/lincoln/.test(n))                                   return 'lincolnshire'
  if (/(east\s*mids?|east\s*midlands|em)\s*north/.test(n)) return 'em_north'
  if (/(east\s*mids?|east\s*midlands|em)\s*south/.test(n)) return 'em_south'
  if (/london|luton/.test(n))                              return 'london_luton'
  return n.replace(/\s+/g, '_') || 'unknown'
}

// ─── Forecast risks (columns of the hazard table) ────────────────────────────

/** Canonical risk names. Matches the vocabulary already used by DLog2 / 0815. */
export const FORECAST_RISKS = [
  'Wind',
  'Heavy Rain',
  'Convective Rainfall',
  'Snow',
  'Frost',
  'Min Temp',
  'Max Temp',
  'Temp Range',
  'Ice Day',
  'Lightning',
] as const
export type ForecastRisk = typeof FORECAST_RISKS[number]

export const FORECAST_DAYS = 7

// ─── Parsed document shape ───────────────────────────────────────────────────

export interface HazardCell {
  /** GREEN when the cell is green with no level word; null when unreadable. */
  level: HazardLevel | null
  confidence: Confidence | null
  /** Raw words found in the cell, space-joined, for audit / display. */
  text: string
  /** Fill colour of the cell as printed, when a fill was found. */
  rgb: [number, number, number] | null
}

export interface TempCell {
  value: number | null
  level: HazardLevel | null
  rgb: [number, number, number] | null
}

export interface IceDayCell {
  value: boolean | null
  confidence: Confidence | null
  level: HazardLevel | null
  text: string
}

export interface ForecastDay {
  dayIndex: number          // 0 = first row of the table (the "today" of the forecast)
  date: string              // YYYY-MM-DD
  dayName: string           // as printed, e.g. "Friday"
  hazards: {
    wind: HazardCell
    heavyRain: HazardCell
    convectiveRain: HazardCell
    snow: HazardCell
    frost: HazardCell
    tempRange: HazardCell
    lightning: HazardCell
  }
  temps: {
    minMorning: TempCell    // Min Temp Morn (06-11)
    max: TempCell           // Max Temp (06-18)
    minNight: TempCell      // Min Temp (18-06)
  }
  iceDay: IceDayCell
  /** Non-GREEN risks only, keyed by canonical risk name — the shape the apps already use. */
  risks: Partial<Record<ForecastRisk, RiskLevel>>
  /** Worst level across every cell of the row. */
  overallLevel: HazardLevel
  /** Any column the parser did not recognise, keyed by its header label. */
  extra: Record<string, string>
}

export interface ForecastArea {
  key: ForecastAreaKey | string
  name: string              // as printed, e.g. "East Mids North"
  route: string | null      // the bracketed suffix, e.g. "East Midlands"
  days: ForecastDay[]
}

export interface ForecastSummary {
  key: string               // 'summary24h' | 'summary2to7' | slug of the heading
  heading: string
  text: string
}

export interface ForecastDocument {
  title: string
  route: string | null
  issuedAt: string | null       // ISO 8601 with offset, e.g. 2026-09-18T02:54:29+01:00
  issuedAtText: string | null   // exactly as printed
  issuedBy: string | null
  validFrom: string | null      // ISO 8601 with offset
  validTo: string | null
  validFromDate: string | null  // YYYY-MM-DD, the date of the first forecast row
  forecasterPhone: string | null
  summaries: ForecastSummary[]
  summary24h: string | null
  summary2to7: string | null
  areas: ForecastArea[]
  pageCount: number
  warnings: string[]
}

// ─── Derivations shared by every consumer ────────────────────────────────────

export function dayOverallLevel(risks: Partial<Record<string, RiskLevel>>): HazardLevel {
  let max: HazardLevel = 'GREEN'
  const keys = Object.keys(risks)
  for (let i = 0; i < keys.length; i++) {
    const lvl = risks[keys[i]]
    if (lvl && HAZARD_RANK[lvl] > HAZARD_RANK[max]) max = lvl
  }
  return max
}

/** "AWARE Max Temp, Lightning" style text; "Normal" when there is nothing to say. */
export function describeRisks(risks: Partial<Record<string, RiskLevel>>): string {
  const byLevel: Record<RiskLevel, string[]> = { EXTREME: [], ADVERSE: [], AWARE: [] }
  const keys = Object.keys(risks)
  for (let i = 0; i < keys.length; i++) {
    const lvl = risks[keys[i]]
    if (lvl) byLevel[lvl].push(keys[i])
  }
  const parts: string[] = []
  const order: RiskLevel[] = ['EXTREME', 'ADVERSE', 'AWARE']
  for (let i = 0; i < order.length; i++) {
    if (byLevel[order[i]].length) parts.push(HAZARD_LABEL[order[i]].toUpperCase() + ' ' + byLevel[order[i]].join(', '))
  }
  return parts.length ? parts.join('; ') : 'Normal'
}

export function addDaysIso(iso: string, days: number): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10))
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function weekdayName(iso: string): string {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10))
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

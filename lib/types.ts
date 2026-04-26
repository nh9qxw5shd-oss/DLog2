// ─── Weather / 5 Day Look Ahead ───────────────────────────────────────────────

export type HazardLevel = 'GREEN' | 'AWARE' | 'ADVERSE' | 'EXTREME'
export type RiskLevel   = Exclude<HazardLevel, 'GREEN'>

export const WEATHER_RISK_OPTIONS = [
  'Wind',
  'Heavy Rain',
  'Convective Rainfall',
  'Lightning',
  'Snow',
  'Frost',
  'Min Temp',
  'Max Temp',
  'Temp Range',
  'Ice Day',
] as const
export type WeatherRisk = typeof WEATHER_RISK_OPTIONS[number]

export interface DayWeather {
  risks: Partial<Record<WeatherRisk, RiskLevel>>
}

export interface FiveDayWeather {
  eastMidlands: DayWeather[]   // exactly 5 entries
  londonNorth:  DayWeather[]   // exactly 5 entries
}

export interface LookAheadNotes {
  risks: string[]              // exactly 5 entries, default 'Nil'
  toc:   string[]
  foc:   string[]
}

const HAZARD_RANK: Record<HazardLevel, number> = {
  GREEN: 0, AWARE: 1, ADVERSE: 2, EXTREME: 3,
}

export function deriveWeatherLevel(day: DayWeather): HazardLevel {
  let max: HazardLevel = 'GREEN'
  for (const lvl of Object.values(day.risks)) {
    if (lvl && HAZARD_RANK[lvl] > HAZARD_RANK[max]) max = lvl
  }
  return max
}

export function deriveDaysFromDate(isoDate: string): string[] {
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  if (!isoDate) return ['Day 1','Day 2','Day 3','Day 4','Day 5']
  try {
    const [y, m, d] = isoDate.split('-').map(Number)
    return Array.from({ length: 5 }, (_, i) => {
      const dt = new Date(y, m - 1, d + i)
      return DAYS[dt.getDay()]
    })
  } catch {
    return ['Day 1','Day 2','Day 3','Day 4','Day 5']
  }
}

// The 5 Day Look Ahead is forward-looking from the moment the report is
// compiled, not from the log's reporting period. Always starts at "today".
// NB: calls Date() — only invoke on the client (guard with useEffect in SSR).
export function deriveUpcomingDays(): string[] {
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const today = new Date()
  return Array.from({ length: 5 }, (_, i) => {
    const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    return DAYS[dt.getDay()]
  })
}

export function makeEmptyFiveDayWeather(): FiveDayWeather {
  const day = (): DayWeather => ({ risks: {} })
  return {
    eastMidlands: Array.from({ length: 5 }, day),
    londonNorth:  Array.from({ length: 5 }, day),
  }
}

export function makeEmptyLookAheadNotes(): LookAheadNotes {
  return {
    risks: Array.from({ length: 5 }, () => 'Nil'),
    toc:   Array.from({ length: 5 }, () => 'Nil'),
    foc:   Array.from({ length: 5 }, () => 'Nil'),
  }
}

// ─── Seasonal rows ────────────────────────────────────────────────────────────

export type SeasonMode = 'Standard' | 'Summer' | 'Autumn'

export type SteamFireRiskLevel = 'GREEN' | 'AMBER' | 'RED' | 'BLACK'

export type AdhesionLevel =
  | 'GOOD_1_2'
  | 'DAMP_3'
  | 'MODERATE_4_5'
  | 'POOR_5_8'
  | 'VERY_POOR_9_10'

export const ADHESION_LEVEL_OPTIONS: Array<{ value: AdhesionLevel; label: string }> = [
  { value: 'GOOD_1_2',        label: 'Good (1-2)'      },
  { value: 'DAMP_3',          label: 'Damp (3)'         },
  { value: 'MODERATE_4_5',    label: 'Moderate (4-5)'   },
  { value: 'POOR_5_8',        label: 'Poor (5-8)'       },
  { value: 'VERY_POOR_9_10',  label: 'Very Poor (9-10)' },
]

export function makeEmptySeasonalData() {
  return {
    seasonMode:       'Standard' as SeasonMode,
    steamFireRisk:    Array.from({ length: 5 }, (): SteamFireRiskLevel => 'GREEN'),
    eastMidsAdhesion: Array.from({ length: 5 }, (): AdhesionLevel => 'GOOD_1_2'),
    lincolnAdhesion:  Array.from({ length: 5 }, (): AdhesionLevel => 'GOOD_1_2'),
  }
}

// ─── Incident Types ───────────────────────────────────────────────────────────

export type IncidentCategory =
  | 'FATALITY'
  | 'PERSON_STRUCK'
  | 'SPAD'
  | 'TPWS'
  | 'IRREGULAR_WORKING'
  | 'BRIDGE_STRIKE'
  | 'NEAR_MISS'
  | 'LEVEL_CROSSING'
  | 'FIRE'
  | 'CRIME'
  | 'INFRASTRUCTURE'
  | 'TRACTION_FAILURE'
  | 'TRAIN_FAULT'
  | 'DERAILMENT'
  | 'POSSESSION'
  | 'STATION_OVERRUN'
  | 'PASSENGER_INJURY'
  | 'HABD_WILD'
  | 'STRANDED_TRAIN'
  | 'WEATHER'
  | 'GENERAL'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export interface Incident {
  id: string
  ccil?: string
  trustRef?: string
  faultNo?: string
  category: IncidentCategory
  severity: Severity
  title: string
  location: string
  area?: string
  line?: string
  incidentStart?: string
  description: string
  events?: IncidentEvent[]
  cancelled?: number
  partCancelled?: number
  trainsDelayed?: number
  minutesDelay?: number
  btpRef?: string
  actionCode?: string
  isHighlight: boolean
  rawText?: string
  isContinuation?: boolean  // true when this CCIL appeared in a prior report
  delayDelta?: number       // additional delay since previous occurrence (continuations only)

  // ── Extended capture for Insight analytics platform ───────────────────────
  incidentTypeCode?:  string    // CCIL numeric prefix e.g. "05C", "07b"
  incidentTypeLabel?: string    // Label without the code e.g. "Track Circuit Failure"
  possessionRef?:     string
  thirdPartyRef?:     string
  advisedTime?:       string    // HH:MM
  initialRespTime?:   string    // HH:MM
  arrivedAtTime?:     string    // HH:MM
  nwrTime?:           string    // HH:MM — Normal Working Resumed
  minsToAdvised?:     number
  minsToResponse?:    number
  minsToArrival?:     number
  incidentDuration?:  number    // mins from incident_start to NWR
  trainId?:           string
  trainCompany?:      string
  trainOrigin?:       string
  trainDestination?:  string
  unitNumbers?:       string[]
  tdaRef?:            string    // Trust Delay Attribution ref
  trmcCode?:          string    // TRMC responsibility code
  ftsDivCount?:       number
  eventCount?:        number    // number of log events (complexity proxy)
  hasFiles?:          boolean
  responderInitials?: string[]  // parsed from action_code field
}

export interface IncidentEvent {
  date: string
  time: string
  company: string
  description: string
}

// ─── Roster — EMCC specific roles ────────────────────────────────────────────

export interface ShiftSlot {
  role: string
  name: string
  start: string  // HH:MM
  end: string    // HH:MM
}

export interface RosterData {
  dayShift: ShiftSlot[]
  nightShift: ShiftSlot[]
}

// ─── Full Log State ───────────────────────────────────────────────────────────

export interface LogState {
  date: string               // YYYY-MM-DD
  period: string
  controlCentre: string
  createdBy?: string
  roster: RosterData
  incidents: Incident[]
  rawLogText?: string        // verbatim CCIL text for appendix
  fiveDayWeather: FiveDayWeather
  lookAheadNotes: LookAheadNotes
  seasonMode: SeasonMode
  steamFireRisk: SteamFireRiskLevel[]    // 5 entries
  eastMidsAdhesion: AdhesionLevel[]      // 5 entries
  lincolnAdhesion: AdhesionLevel[]       // 5 entries
  status: 'empty' | 'parsed' | 'reviewed' | 'generated'
}

// ─── Category Config ──────────────────────────────────────────────────────────

export const CATEGORY_CONFIG: Record<IncidentCategory, {
  label: string
  shortLabel: string
  color: string
  priority: number
  showInSummary: boolean
}> = {
  FATALITY:          { label: 'Fatality / Person Struck',  shortLabel: 'FATAL',   color: '#E74C3C', priority: 1,  showInSummary: true  },
  PERSON_STRUCK:     { label: 'Person Struck by Train',    shortLabel: 'PST',     color: '#E74C3C', priority: 2,  showInSummary: true  },
  SPAD:              { label: 'Signal Passed at Danger',   shortLabel: 'SPAD',    color: '#E05206', priority: 3,  showInSummary: true  },
  TPWS:              { label: 'TPWS Activation',           shortLabel: 'TPWS',    color: '#E05206', priority: 4,  showInSummary: true  },
  IRREGULAR_WORKING: { label: 'Irregular Working',         shortLabel: 'IRR',     color: '#F39C12', priority: 5,  showInSummary: true  },
  BRIDGE_STRIKE:     { label: 'Bridge Strike',             shortLabel: 'BSTR',    color: '#F39C12', priority: 6,  showInSummary: true  },
  NEAR_MISS:         { label: 'Near Miss',                 shortLabel: 'NM',      color: '#F39C12', priority: 7,  showInSummary: true  },
  HABD_WILD:         { label: 'HABD / WILD Activation',   shortLabel: 'HABD',    color: '#F39C12', priority: 8,  showInSummary: true  },
  CRIME:             { label: 'Railway Crime / Trespass',  shortLabel: 'CRIME',   color: '#9B59B6', priority: 9,  showInSummary: true  },
  LEVEL_CROSSING:    { label: 'Level Crossing',            shortLabel: 'LC',      color: '#E05206', priority: 10, showInSummary: true  },
  FIRE:              { label: 'Fire',                      shortLabel: 'FIRE',    color: '#E74C3C', priority: 11, showInSummary: true  },
  PASSENGER_INJURY:  { label: 'Passenger / Public Injury', shortLabel: 'PAX INJ', color: '#E05206', priority: 12, showInSummary: true  },
  DERAILMENT:        { label: 'Derailment / Collision',    shortLabel: 'DERL',    color: '#E74C3C', priority: 13, showInSummary: true  },
  INFRASTRUCTURE:    { label: 'Infrastructure Failure',    shortLabel: 'INFRA',   color: '#4A6FA5', priority: 14, showInSummary: false },
  TRACTION_FAILURE:  { label: 'OHL / Traction Current Failure', shortLabel: 'OLE',  color: '#4A6FA5', priority: 15, showInSummary: false },
  TRAIN_FAULT:       { label: 'Train Fault / Failure',     shortLabel: 'TFLT',    color: '#6B7FA5', priority: 16, showInSummary: false },
  POSSESSION:        { label: 'Possession Issue',          shortLabel: 'POSS',    color: '#4A6FA5', priority: 17, showInSummary: false },
  STATION_OVERRUN:   { label: 'Station Overrun',           shortLabel: 'OVRUN',   color: '#7A8BA8', priority: 18, showInSummary: false },
  STRANDED_TRAIN:    { label: 'Stranded Train',            shortLabel: 'STRAND',  color: '#7A8BA8', priority: 19, showInSummary: false },
  WEATHER:           { label: 'Weather Event',             shortLabel: 'WX',      color: '#4A6FA5', priority: 20, showInSummary: false },
  GENERAL:           { label: 'General / Other',           shortLabel: 'GEN',     color: '#4A6FA5', priority: 21, showInSummary: false },
}

// ─── Default EMCC Roster ──────────────────────────────────────────────────────

export const DEFAULT_ROSTER: RosterData = {
  dayShift: [
    { role: 'SNDM', name: '', start: '06:00', end: '18:00' },
    { role: 'RCM',  name: '', start: '06:00', end: '18:00' },
    { role: 'IC',   name: '', start: '06:00', end: '18:00' },
    { role: 'IC2',  name: '', start: '06:00', end: '18:00' },
    { role: 'TRC',  name: '', start: '06:00', end: '18:00' },
    { role: 'WH TRC', name: '', start: '06:00', end: '18:00' },
    { role: 'ISC',  name: '', start: '06:00', end: '18:00' },
    { role: 'TSE',  name: '', start: '06:00', end: '18:00' },
  ],
  nightShift: [
    { role: 'SNDM', name: '', start: '18:00', end: '06:00' },
    { role: 'RCM',  name: '', start: '18:00', end: '06:00' },
    { role: 'IC',   name: '', start: '18:00', end: '06:00' },
    { role: 'IC2',  name: '', start: '18:00', end: '06:00' },
    { role: 'TRC',  name: '', start: '18:00', end: '06:00' },
    { role: 'WH TRC', name: '', start: '18:00', end: '06:00' },
    { role: 'ISC',  name: '', start: '18:00', end: '06:00' },
    { role: 'TSE',  name: '', start: '18:00', end: '06:00' },
  ],
}

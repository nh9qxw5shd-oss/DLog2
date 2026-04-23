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

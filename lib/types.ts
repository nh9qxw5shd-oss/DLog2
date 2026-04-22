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
  isHighlight: boolean  // flag for summary section
  rawText?: string
}

export interface IncidentEvent {
  date: string
  time: string
  company: string
  description: string
}

// ─── Roster Types ─────────────────────────────────────────────────────────────

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

// ─── Performance Types ────────────────────────────────────────────────────────

export interface PerformanceData {
  timeTo3?: number
  cancellations?: number
  ppm?: number
  freightArrivalT15?: number
}

// ─── Full Log State ───────────────────────────────────────────────────────────

export interface LogState {
  date: string               // YYYY-MM-DD
  period: string             // e.g. "21 Apr 2026 06:00 TO 22 Apr 2026 06:00"
  controlCentre: string
  createdBy?: string
  roster: RosterData
  performance: PerformanceData
  incidents: Incident[]
  rawLogText?: string        // verbatim CCIL text for appendix
  status: 'empty' | 'parsed' | 'reviewed' | 'generated'
}

// ─── Category Config ─────────────────────────────────────────────────────────

export const CATEGORY_CONFIG: Record<IncidentCategory, {
  label: string
  shortLabel: string
  color: string
  bgColor: string
  priority: number
  showInSummary: boolean
}> = {
  FATALITY:          { label: 'Fatality',               shortLabel: 'FATAL',    color: '#E74C3C', bgColor: 'rgba(231,76,60,0.15)',   priority: 1,  showInSummary: true  },
  PERSON_STRUCK:     { label: 'Person Struck by Train',  shortLabel: 'PST',      color: '#E74C3C', bgColor: 'rgba(231,76,60,0.15)',   priority: 2,  showInSummary: true  },
  SPAD:              { label: 'Signal Passed at Danger', shortLabel: 'SPAD',     color: '#E05206', bgColor: 'rgba(224,82,6,0.15)',    priority: 3,  showInSummary: true  },
  TPWS:              { label: 'TPWS Activation',         shortLabel: 'TPWS',     color: '#E05206', bgColor: 'rgba(224,82,6,0.15)',    priority: 4,  showInSummary: true  },
  IRREGULAR_WORKING: { label: 'Irregular Working',       shortLabel: 'IRR',      color: '#F39C12', bgColor: 'rgba(243,156,18,0.12)', priority: 5,  showInSummary: true  },
  BRIDGE_STRIKE:     { label: 'Bridge Strike',           shortLabel: 'BSTR',     color: '#F39C12', bgColor: 'rgba(243,156,18,0.12)', priority: 6,  showInSummary: true  },
  NEAR_MISS:         { label: 'Near Miss',               shortLabel: 'NM',       color: '#F39C12', bgColor: 'rgba(243,156,18,0.12)', priority: 7,  showInSummary: true  },
  HABD_WILD:         { label: 'HABD / WILD Activation',  shortLabel: 'HABD',     color: '#F39C12', bgColor: 'rgba(243,156,18,0.12)', priority: 8,  showInSummary: true  },
  CRIME:             { label: 'Railway Crime',           shortLabel: 'CRIME',    color: '#9B59B6', bgColor: 'rgba(155,89,182,0.15)', priority: 9,  showInSummary: true  },
  LEVEL_CROSSING:    { label: 'Level Crossing',          shortLabel: 'LC',       color: '#E05206', bgColor: 'rgba(224,82,6,0.12)',   priority: 10, showInSummary: true  },
  FIRE:              { label: 'Fire',                    shortLabel: 'FIRE',     color: '#E74C3C', bgColor: 'rgba(231,76,60,0.12)',  priority: 11, showInSummary: true  },
  INFRASTRUCTURE:    { label: 'Infrastructure Failure',  shortLabel: 'INFRA',    color: '#4A6FA5', bgColor: 'rgba(74,111,165,0.15)', priority: 12, showInSummary: false },
  TRACTION_FAILURE:  { label: 'Traction Failure',        shortLabel: 'TRACT',    color: '#4A6FA5', bgColor: 'rgba(74,111,165,0.15)', priority: 13, showInSummary: false },
  DERAILMENT:        { label: 'Derailment / Collision',  shortLabel: 'DERL',     color: '#E74C3C', bgColor: 'rgba(231,76,60,0.15)',  priority: 14, showInSummary: true  },
  POSSESSION:        { label: 'Possession Issue',        shortLabel: 'POSS',     color: '#4A6FA5', bgColor: 'rgba(74,111,165,0.12)', priority: 15, showInSummary: false },
  STATION_OVERRUN:   { label: 'Station Overrun',         shortLabel: 'OVRUN',    color: '#7A8BA8', bgColor: 'rgba(122,139,168,0.12)',priority: 16, showInSummary: false },
  PASSENGER_INJURY:  { label: 'Passenger Injury',        shortLabel: 'PAX INJ',  color: '#E05206', bgColor: 'rgba(224,82,6,0.12)',   priority: 17, showInSummary: true  },
  STRANDED_TRAIN:    { label: 'Stranded Train',          shortLabel: 'STRAND',   color: '#7A8BA8', bgColor: 'rgba(122,139,168,0.12)',priority: 18, showInSummary: false },
  WEATHER:           { label: 'Weather Event',           shortLabel: 'WX',       color: '#4A6FA5', bgColor: 'rgba(74,111,165,0.12)', priority: 19, showInSummary: false },
  GENERAL:           { label: 'General',                 shortLabel: 'GEN',      color: '#4A6FA5', bgColor: 'rgba(74,111,165,0.12)', priority: 20, showInSummary: false },
}

export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

export const DEFAULT_ROSTER: RosterData = {
  dayShift: [
    { role: 'SSM (Shift Signalling Manager)', name: '', start: '06:00', end: '18:00' },
    { role: 'EMCC Controller', name: '', start: '06:00', end: '18:00' },
    { role: 'EMCC Controller', name: '', start: '06:00', end: '18:00' },
    { role: 'LOM (Local Operations Manager)', name: '', start: '07:00', end: '19:00' },
    { role: 'MOM (Mobile Operations Manager)', name: '', start: '06:00', end: '18:00' },
  ],
  nightShift: [
    { role: 'SSM (Shift Signalling Manager)', name: '', start: '18:00', end: '06:00' },
    { role: 'EMCC Controller', name: '', start: '18:00', end: '06:00' },
    { role: 'EMCC Controller', name: '', start: '18:00', end: '06:00' },
    { role: 'LOM (Local Operations Manager)', name: '', start: '19:00', end: '07:00' },
    { role: 'MOM (Mobile Operations Manager)', name: '', start: '18:00', end: '06:00' },
  ],
}

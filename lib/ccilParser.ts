import { Incident, IncidentCategory, IncidentEvent, Severity } from './types'

// ─── Category pattern matching ────────────────────────────────────────────────
// Order matters — more specific patterns first

const CATEGORY_PATTERNS: Array<[RegExp, IncidentCategory]> = [
  [/fatalit|person struck|struck by.*train|PST\b|fatally injured/i,               'FATALITY'],
  [/signal passed at danger|SPAD\b|passed.*signal.*danger|passed.*at.*red\b/i,    'SPAD'],
  [/\bTPWS\b|train protection warning system/i,                                    'TPWS'],
  [/bridge strike/i,                                                               'BRIDGE_STRIKE'],
  [/near[- ]miss/i,                                                                'NEAR_MISS'],
  [/irregular working|attempted dispatch against|signaller.*inadvertently/i,       'IRREGULAR_WORKING'],
  [/\b(HABD|hot axle box detector)\b/i,                                            'HABD_WILD'],
  [/\b(WILD|wheel impact load detector)\b/i,                                       'HABD_WILD'],
  [/derail|divided train|runaway/i,                                                'DERAILMENT'],
  [/station overrun|overran\b.*station|overrun\b.*platform/i,                      'STATION_OVERRUN'],
  [/lineside fire|fire.*lineside|fire.*track|fire.*sleeper|fire.*vegetation/i,     'FIRE'],
  [/trespass|theft|robbery|graffiti|vandal/i,                                      'CRIME'],
  [/level crossing|AHB\b|MCG\b|AOCL\b|AHBC\b|crossing.*misuse|crossing.*failure/i,'LEVEL_CROSSING'],
  [/verbal assault|assault on staff|staff.*assault|crew.*assault|attack on staff/i,   'PASSENGER_INJURY'],
  [/passenger.*injur|injur.*passenger|public.*injur|person.*fell.*track/i,             'PASSENGER_INJURY'],
  [/assault.*passenger|passenger.*assault/i,                                           'PASSENGER_INJURY'],
  [/door fault|door failure|unit fault|unit defect|on.?train fault|train.*defect|defective.*unit|bogie.*fault|unit.*failure|AWS brake demand/i, 'TRAIN_FAULT'],
  [/traction failure|VCB not closing|OHL.*loss|power.*loss|loss.*traction.*power/i,    'TRACTION_FAILURE'],
  [/\bOLE\b|overhead line.*damage|dewirement|pantograph/i,                         'INFRASTRUCTURE'],
  [/track circuit.*fail|axle counter.*fail|points failure|signalling failure|signal.*fault|loss of signalling/i, 'INFRASTRUCTURE'],
  [/PICOP|T3-D\b|signalling disconnection/i,                                       'POSSESSION'],
  [/stranded.*train|train.*stranded/i,                                             'STRANDED_TRAIN'],
  [/weather|flood|snow|ice|high wind|storm damage/i,                               'WEATHER'],
  [/tree.*railway|tree.*line|vegetation.*line|coping stone|lineside.*obstruction/i,'INFRASTRUCTURE'],
]

const SEVERITY_RULES: Array<[IncidentCategory[], Severity]> = [
  [['FATALITY', 'PERSON_STRUCK', 'DERAILMENT'],                         'CRITICAL'],
  [['SPAD', 'FIRE', 'BRIDGE_STRIKE'],                                   'HIGH'],
  [['TPWS', 'NEAR_MISS', 'IRREGULAR_WORKING', 'HABD_WILD'],            'MEDIUM'],
  [['CRIME', 'LEVEL_CROSSING', 'PASSENGER_INJURY', 'TRACTION_FAILURE'], 'MEDIUM'],
  [['INFRASTRUCTURE', 'POSSESSION', 'TRAIN_FAULT'],                     'LOW'],
  [['STATION_OVERRUN'],                                                  'MEDIUM'],
  [['STRANDED_TRAIN', 'WEATHER', 'GENERAL'],                            'INFO'],
]

// ─── CCIL label → category (Tier 1 — exact match on the system's own type label) ──
// These are the 145 official incident type labels from the CCIL Incident Types settings page.
// The CCIL type field in exports contains: "<code> <label>", e.g. "07b Level Crossing Deliberate Misuse".
// classifyByTypeLabel strips the code and looks up the label directly.

export const CCIL_LABEL_MAP: Array<[string, IncidentCategory]> = [
  // Safety critical
  ['Signals Passed At Danger (Category A)',                              'SPAD'],
  ['Signals Passed At Danger (Category A) (Weather Related)',            'SPAD'],
  ['TPWS Activation',                                                    'TPWS'],
  ['Near Miss',                                                          'NEAR_MISS'],
  ['Concern For Welfare',                                                'GENERAL'],
  ['Train Struck an Object',                                             'NEAR_MISS'],
  ['Road Vehicle Incursion (non Level Crossing).',                       'NEAR_MISS'],
  ['Fatality',                                                           'FATALITY'],
  ['Person Struck By Train',                                             'PERSON_STRUCK'],
  // Bridge
  ['Bridge Strike',                                                      'BRIDGE_STRIKE'],
  ['Bridge/structural defects or incidents (ex. bridge strikes)',        'BRIDGE_STRIKE'],
  // Irregular working / dispatch
  ['Irregular Working : Network Rail Infrastructure',                    'IRREGULAR_WORKING'],
  ['Irregular Working : Network Rail Infrastructure Projects',           'IRREGULAR_WORKING'],
  ['Irregular Working : Network Rail Operations',                        'IRREGULAR_WORKING'],
  ['Irregular Working : TOC',                                            'IRREGULAR_WORKING'],
  ['Dispatch Incidents',                                                 'IRREGULAR_WORKING'],
  ['Incorrect Door Release',                                             'IRREGULAR_WORKING'],
  ['Group Standard GE/RT3350',                                           'IRREGULAR_WORKING'],
  ['Group Standard GE/RT8250',                                           'IRREGULAR_WORKING'],
  ['Missed Power Changeover',                                            'IRREGULAR_WORKING'],
  ['Speeding',                                                           'IRREGULAR_WORKING'],
  // HABD/WILD
  ['Wheelchex / WILD activation and Confirmed Hot Axle Boxes',           'HABD_WILD'],
  // Derailment / collision
  ['Derailment',                                                         'DERAILMENT'],
  ['Divided Train',                                                      'DERAILMENT'],
  ['Train or Vehicle Runaway',                                           'DERAILMENT'],
  ['Collision',                                                          'DERAILMENT'],
  // Level crossing
  ['Level Crossing Deliberate Misuse',                                   'LEVEL_CROSSING'],
  ['Level Crossing Incident',                                            'LEVEL_CROSSING'],
  ['Level Crossing Failure',                                             'LEVEL_CROSSING'],
  ['Level Crossing Failure - Telephones',                                'LEVEL_CROSSING'],
  // Fire
  ['Fires',                                                              'FIRE'],
  ['Lineside Fire',                                                      'FIRE'],
  // Crime / security
  ['Railway Crime',                                                      'CRIME'],
  ['Trespass',                                                           'CRIME'],
  ['Criminal Damage / Vandalism',                                        'CRIME'],
  ['Graffiti',                                                           'CRIME'],
  ['Security Issues',                                                    'CRIME'],
  ['Cable Crime',                                                        'CRIME'],
  ['Exclusion Zone',                                                     'CRIME'],
  ['Unsecured Access Gate',                                              'CRIME'],
  // Passenger / staff injuries
  ['Passenger / Public Injuries / Assaults',                             'PASSENGER_INJURY'],
  ['Staff / Contractor Injuries / Assaults',                             'PASSENGER_INJURY'],
  ['Passenger Illness',                                                  'PASSENGER_INJURY'],
  // Station overrun
  ['Station Overrun',                                                    'STATION_OVERRUN'],
  ['Station Overrun (Weather Related)',                                   'STATION_OVERRUN'],
  // Possession
  ['Possession Monitoring',                                              'POSSESSION'],
  ['Possession Overrun',                                                 'POSSESSION'],
  ['Significant Possession Problem',                                     'POSSESSION'],
  ['Isolations',                                                         'POSSESSION'],
  // Infrastructure
  ['Axle Counter Failure',                                               'INFRASTRUCTURE'],
  ['Broken Rail / Track defect',                                         'INFRASTRUCTURE'],
  ['Track Circuit Failure',                                              'INFRASTRUCTURE'],
  ['Track Circuit Failure (Leaf Fall)',                                   'INFRASTRUCTURE'],
  ['Points Failure',                                                     'INFRASTRUCTURE'],
  ['Signalling Incident',                                                'INFRASTRUCTURE'],
  ['Signals / Signalling system failure',                                'INFRASTRUCTURE'],
  ['Signal Obscured by Foliage',                                         'INFRASTRUCTURE'],
  ['Signal Obscured by Light',                                           'INFRASTRUCTURE'],
  ['OHL Dewirement',                                                     'INFRASTRUCTURE'],
  ['Power Failure',                                                      'INFRASTRUCTURE'],
  ['Earthworks',                                                         'INFRASTRUCTURE'],
  ['Geometry failure',                                                   'INFRASTRUCTURE'],
  ['GSM-R',                                                              'INFRASTRUCTURE'],
  ['Lineside Fencing and Foliage',                                       'INFRASTRUCTURE'],
  ['Station Infrastructure',                                             'INFRASTRUCTURE'],
  ['D.O.O. Station Equipment',                                           'INFRASTRUCTURE'],
  ['Emergency Speed Restrictions',                                       'INFRASTRUCTURE'],
  ['Temporary Speed Restriction (TSR)',                                   'INFRASTRUCTURE'],
  ['Speed Restriction Issues',                                           'INFRASTRUCTURE'],
  ['Object/plastic on OHL',                                              'INFRASTRUCTURE'],
  ['RETB',                                                               'INFRASTRUCTURE'],
  ['Tree or Branch on the Line',                                         'INFRASTRUCTURE'],
  ['Rough Ride Report by MOP via Control',                               'INFRASTRUCTURE'],
  ['ADD Operation',                                                      'INFRASTRUCTURE'],
  ['Reportable Rail Head Conditions',                                    'INFRASTRUCTURE'],
  ['Train Stop & Examine',                                               'INFRASTRUCTURE'],
  ['Outstation Alarm',                                                   'INFRASTRUCTURE'],
  ['Line Blockage Issues',                                               'INFRASTRUCTURE'],
  ['IT/Telecoms issues',                                                 'INFRASTRUCTURE'],
  ['Outage NR/3rd Party',                                                'INFRASTRUCTURE'],
  ['Stopping Incidents',                                                 'INFRASTRUCTURE'],
  // Traction failure
  ['Traction Current Problem',                                           'TRACTION_FAILURE'],
  ['Traction Failure non-Passenger',                                     'TRACTION_FAILURE'],
  ['Traction Failure Passenger',                                         'TRACTION_FAILURE'],
  ['Circuit Breaker Tripping',                                           'TRACTION_FAILURE'],
  ['Emergency Switch Off',                                               'TRACTION_FAILURE'],
  // Train fault
  ['On Train Defect - non group standard',                               'TRAIN_FAULT'],
  ['On Train Defect - RB TW5',                                           'TRAIN_FAULT'],
  ['Train Failure on Depot',                                             'TRAIN_FAULT'],
  ['Train Door Incidents',                                               'TRAIN_FAULT'],
  ['AWS Brake Demand',                                                   'TRAIN_FAULT'],
  ['Unsolicited Brake Application',                                      'TRAIN_FAULT'],
  ['ETCS incident',                                                      'TRAIN_FAULT'],
  ['Coaches locked out of use',                                          'TRAIN_FAULT'],
  ['De-registered Vehicles / Locomotives and Overload rejections',       'TRAIN_FAULT'],
  // Weather
  ['Flooding',                                                           'WEATHER'],
  ['Heat Speeds',                                                        'WEATHER'],
  ['Rainfall – Landslip Risk',                                      'WEATHER'],
  ['Convective Rainfall Alert Tool (CAT Tool)',                           'WEATHER'],
  ['Weather Related Proactive Measures',                                 'WEATHER'],
  ['Weather Related Problems - Any Other',                               'WEATHER'],
  ['Freight Adhesion Issues',                                            'WEATHER'],
  // General / admin
  ['Actions Taken to Improve Performance',                               'GENERAL'],
  ['Alternative Transport Issues including RTA',                         'GENERAL'],
  ['Animals on the line',                                                'GENERAL'],
  ['Air Traffic Incidents',                                              'GENERAL'],
  ['Building Entry',                                                     'GENERAL'],
  ['Call for Aid',                                                       'GENERAL'],
  ['Catering Issues',                                                    'GENERAL'],
  ['Dangerous Goods Incident',                                           'GENERAL'],
  ['Depot Operating Issues',                                             'GENERAL'],
  ['Disturbance to/of a projected site/species',                         'GENERAL'],
  ['Egress Activation',                                                  'GENERAL'],
  ['Fleet Performance',                                                  'GENERAL'],
  ['Flytipping',                                                         'GENERAL'],
  ['Freight Trains over Length',                                         'GENERAL'],
  ['I.T. Problem',                                                       'GENERAL'],
  ['Item dropped on track',                                              'GENERAL'],
  ['Major Incident Command Decision Log',                                'GENERAL'],
  ['Management of Early Running Train',                                  'GENERAL'],
  ['Miscellaneous',                                                      'GENERAL'],
  ['On Train Cleaning',                                                  'GENERAL'],
  ['Other (environment)',                                                 'GENERAL'],
  ['Passenger Loadings',                                                 'GENERAL'],
  ['Passenger Matters General',                                          'GENERAL'],
  ['Passenger on ECS',                                                   'GENERAL'],
  ['Passenger Special Needs',                                            'GENERAL'],
  ['Passcomm Activation',                                                'GENERAL'],
  ['Planning Errors',                                                    'GENERAL'],
  ['Real Time Performance Figures',                                      'GENERAL'],
  ['Rolling Stock Traction Hire',                                        'GENERAL'],
  ['Shift Change',                                                       'GENERAL'],
  ['Special Event (e.g. Football Incident)',                             'GENERAL'],
  ['Spills and leaks',                                                   'GENERAL'],
  ['Spread of an invasive non-native species',                           'GENERAL'],
  ['Staff Illness',                                                      'GENERAL'],
  ['Staff Issues',                                                       'GENERAL'],
  ['Staff on ECS',                                                       'GENERAL'],
  ['Station Incident',                                                   'GENERAL'],
  ['Statutory nuisance (noise, dust or smoke, light, odour, unsightly conditions)', 'GENERAL'],
  ['Timetable / Diagram / Schedule / Notice / Simplifier Error',         'GENERAL'],
  ['Train Crew Hire',                                                    'GENERAL'],
  ['Train Crew Incident',                                                'GENERAL'],
  ['Train Regulation Issues',                                            'GENERAL'],
  ['Train Service Alterations - Delay',                                  'GENERAL'],
]

/** Normalise a label for case-insensitive, dash-tolerant lookup */
export function normalizeForLookup(s: string): string {
  return s
    .replace(/[–—]/g, '-')   // en/em dash → ASCII hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const LABEL_CATEGORY_LOOKUP: Map<string, IncidentCategory> = new Map(
  CCIL_LABEL_MAP.map(([label, cat]) => [normalizeForLookup(label), cat])
)

/** Strip the leading numeric/alpha type code and look up the label text */
function classifyByTypeLabel(typeField: string): IncidentCategory | null {
  const cleaned = typeField.replace(/\*\*/g, '').replace(/\*/g, '').trim()
  const withoutCode = cleaned.replace(/^[0-9A-Z]+[a-z]?\s+/i, '').trim()
  if (!withoutCode) return null
  return LABEL_CATEGORY_LOOKUP.get(normalizeForLookup(withoutCode)) ?? null
}

// ─── Skip filters — administrative log types ──────────────────────────────────

const SKIP_TITLE_PATTERNS = [
  /daily.*operations.*log/i,
  /daily.*fleet.*log/i,
  /fleet.*log/i,
  /\bTRC\b.*log/i,            // TRC daily logs
  /WH TRC/i,
  /West Hampstead TRC/i,
  /WHTRC/i,
  /Eastern Region.*log/i,      // Regional TRC logs
  /actions.*taken.*improve.*performance/i,
  /supervisors.*log/i,
  /suoervisors.*log/i,         // Common CCIL typo variant
  /operations.*supervisors/i,
  /cancellations.*log/i,
  /scratch.*pad/i,
  /maintenance.*control.*scratch/i,
  /\bMAFU\b/i,
  /SOM Failure/i,
  /possession.*monitoring/i,
  /week \d+ possession/i,
  /item \d+ - possession/i,
  /^0{2}\s+No Incident Type/i, // Catch-all blank type entries used as log headers
]

// ─── Incident header regex ────────────────────────────────────────────────────
// Matches mammoth's markdown table output exactly:
// | Title | **Location:** | **Incident 3173890 ** | 05/12/2025 15:00 |

const INCIDENT_HEADER = /^\|\s*(.+?)\s*\|\s*\*\*Location:\*\*\s*\|\s*\*\*Incident\s+(\d+)\s*\*\*\s*\|\s*([\d\/]+ [\d:]+)\s*\|$/i

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMd(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')   // strip any HTML tags e.g. <B>, <b>
    .replace(/\*\*/g, '')       // markdown bold
    .replace(/\*/g, '')         // markdown italic/monitoring prefix
    .replace(/_/g, '')          // markdown underscore
    .replace(/#+\s*$/, '')      // trailing # characters (CCIL open-item markers)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a markdown table row into trimmed cell values */
function cellValues(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)   // drop leading/trailing empty splits
    .map(c => stripMd(c.trim()))
}


// ─── CCIL numeric type-code → category ────────────────────────────────────────
// Row 3 of each incident block contains a type like "18 Fires" or "07b Level Crossing..."
// The numeric prefix is CCIL's own classification — more reliable than title text matching.

const TYPE_CODE_MAP: Array<[RegExp, IncidentCategory]> = [
  // ── Core safety codes (single/double digit) ────────────────────────────────
  [/^0?1[abc]?\s/i,   'SPAD'],             // 01 SPAD
  [/^0?2\s/i,         'TPWS'],             // 02 TPWS
  [/^0?3\s/i,         'NEAR_MISS'],        // 03 Near miss
  [/^0?4\s/i,         'BRIDGE_STRIKE'],    // 04 Bridge strike
  [/^0?5[ABCDE]\s/i,  'INFRASTRUCTURE'],  // 05A-05E infra failures (points, TC, signals)
  [/^0?6\s/i,         'IRREGULAR_WORKING'],// 06 Irregular working
  [/^0?7[abc]?\s/i,   'LEVEL_CROSSING'],  // 07 Level crossing
  [/^0?8\s/i,         'HABD_WILD'],        // 08 HABD
  [/^0?9\s/i,         'HABD_WILD'],        // 09 WILD
  [/^10\s/i,          'DERAILMENT'],       // 10 Derailment
  [/^11[01]?\s/i,     'DERAILMENT'],       // 11/110 Tree on line → treat as infra but highlight
  [/^12\s/i,          'FATALITY'],         // 12 Fatality
  [/^13\s/i,          'PERSON_STRUCK'],    // 13 Person struck
  [/^14\s/i,          'PASSENGER_INJURY'], // 14 Passenger/public injury or assault
  [/^155\s/i,         'IRREGULAR_WORKING'],// 155 Dispatch incidents — must precede the 15x wildcard
  [/^15[0-9A]?\s/i,   'CRIME'],           // 15/15A trespass/crime
  [/^16\s/i,          'CRIME'],            // 16 Crime
  [/^17[A-Z]?\s/i,    'WEATHER'],         // 17 Weather (including 17A)
  [/^18\s/i,          'FIRE'],             // 18 Fires
  [/^19\s/i,          'INFRASTRUCTURE'],   // 19 Signalling failures
  [/^20\s/i,          'INFRASTRUCTURE'],   // 20 Track
  [/^21\s/i,          'INFRASTRUCTURE'],   // 21 OLE
  [/^22[abc]?\s/i,    'POSSESSION'],       // 22 Possession monitoring
  [/^23[A-Z]?\s/i,    'TRACTION_FAILURE'], // 23A Traction failure
  [/^3\d\s/i,        'INFRASTRUCTURE'],   // 30s = infra
  // ── 50s: train/depot operational codes ────────────────────────────────────
  [/^52\s/i,          'LEVEL_CROSSING'],   // 52 Level crossing failure
  [/^53\s/i,          'GENERAL'],          // 53 Depot operating issues
  [/^54\s/i,          'TRAIN_FAULT'],      // 54 On-train defect
  [/^55\s/i,          'TRAIN_FAULT'],      // 55 Train failure on depot
  [/^58\s/i,          'INFRASTRUCTURE'],   // 58 Signal obscured
  [/^59\s/i,          'GENERAL'],          // 59 Staff issues
  // ── 60s–80s: operational/admin ─────────────────────────────────────────────
  [/^64\s/i,          'INFRASTRUCTURE'],   // 64 Station infrastructure
  [/^70\s/i,          'CRIME'],            // 70 Security issues
  [/^71\s/i,          'TRAIN_FAULT'],       // 71 On-train defect (RB)
  [/^73\s/i,          'GENERAL'],          // 73 Passenger matters
  [/^78\s/i,          'GENERAL'],          // 78 Actions to improve performance
  [/^87\s/i,          'PERSON_STRUCK'],    // 87 Person struck by train
  // ── F-codes: welfare / misc ────────────────────────────────────────────────
  [/^F0?\d\s/i,      'GENERAL'],
]

function classifyByTypeCode(typeField: string): IncidentCategory | null {
  const cleaned = typeField.replace(/\*\*/g, '').replace(/\*/g, '').trim()
  for (const [pat, cat] of TYPE_CODE_MAP) {
    if (pat.test(cleaned)) return cat as IncidentCategory
  }
  return null
}

// ─── Timing helpers ───────────────────────────────────────────────────────────

/** "1500" or "15:00" → minutes since midnight, or null on failure. */
function timeToMinutes(t: string | undefined): number | null {
  if (!t) return null
  const m = t.replace(/[^\d:]/g, '')
  if (!m) return null
  const colon = m.indexOf(':')
  let hh: number, mm: number
  if (colon >= 0) {
    hh = parseInt(m.slice(0, colon), 10)
    mm = parseInt(m.slice(colon + 1), 10)
  } else if (m.length === 4) {
    hh = parseInt(m.slice(0, 2), 10)
    mm = parseInt(m.slice(2, 4), 10)
  } else {
    return null
  }
  if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

/** Minutes between two HH:MM / HHMM strings, with overnight rollover. */
function diffMinutes(start: string | undefined, end: string | undefined): number | null {
  const s = timeToMinutes(start)
  const e = timeToMinutes(end)
  if (s === null || e === null) return null
  let d = e - s
  if (d < 0) d += 24 * 60
  return d > 24 * 60 ? null : Math.max(0, d)
}

/** Normalise "1500" → "15:00". Returns empty string when unparseable. */
function fmtHHMM(raw: string | undefined): string {
  if (!raw) return ''
  const cleaned = raw.replace(/[^\d:]/g, '')
  if (!cleaned) return ''
  if (cleaned.includes(':')) return cleaned.slice(0, 5)
  if (cleaned.length === 4) return `${cleaned.slice(0, 2)}:${cleaned.slice(2, 4)}`
  return ''
}

// ─── Block parser ─────────────────────────────────────────────────────────────

function parseIncidentBlock(
  lines: string[],
  title: string,
  ccil: string,
  isoDate: string
): Incident {
  let location = ''
  let incidentType = ''
  let faultNo = ''
  let area = ''
  let action = ''
  let btpRef = ''
  let incidentStart = ''
  let cancelled = 0
  let partCancelled = 0
  let trainsDelayed = 0
  let minutesDelay = 0
  let trustRef = ''
  const events: IncidentEvent[] = []
  let inEvents = false
  let eventHeaderSeen = false

  // ── Extended capture fields ────────────────────────────────────────────────
  let equipment      = ''   // equipment / asset identifier for infrastructure incidents
  let routeLine      = ''   // railway line direction e.g. "Down Fast"
  let possessionRef  = ''
  let thirdPartyRef  = ''
  let advisedTime    = ''
  let initialResp    = ''
  let arrivedAt      = ''
  let nwrTime        = ''
  let ftsDivCount    = 0
  let tdaRef         = ''
  let trmcCode       = ''
  let hasFiles       = false
  let trainId        = ''
  let trainCompany   = ''
  let trainOrigin    = ''
  let trainDestination = ''
  const unitNumbers: string[] = []
  let typeRowSeen    = false
  let inTrainBlock   = false
  let trainHeaderSeen = false

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue
    if (line === '| --- | --- | --- | --- |') continue

    const cells = line.startsWith('|') ? cellValues(line) : []

    // Location row (usually near top): prefer non-label cell with meaningful text.
    if (!location && cells.length > 0) {
      const candidates = cells
        .map(c => c.trim())
        .filter(Boolean)
        .filter(c => !/^(Location|Line|Fault Number|Area|Action|BTP Ref|Incident Start|Updated|Advised|Date|Time|Company|Description|TDA|TRMC|Can|Pt Can|Trains|Mins|FTS|Files)\s*:?\s*$/i.test(c))
        .filter(c => !/^\d{1,3}[A-Z]?\s/.test(c)) // exclude type-code style values e.g. "18 Fires"
        .filter(c => !/^Incident\s+\d+$/i.test(c))

      if (candidates.length > 0) {
        const topCandidate = candidates[0]
        if (!/:\s*$/.test(topCandidate)) {
          location = topCandidate
            .replace(/\s*-?\s*\[[A-Z]{2,4}\]/g, '')
            .replace(/ - $/, '')
            .trim()
        }
      }
    }

    // Type + fault row: | **07b Level Crossing...** | **Line: ** | **Fault Number:** | 1141433 |
    if (cells.length > 0 && line.includes('Fault Number')) {
      const cells = cellValues(line)
      incidentType = cells[0] || ''
      faultNo = cells[3] || ''
      typeRowSeen = true
      continue
    }

    // Line direction + possession ref row (immediately follows the type/fault row):
    // |  | Down Fast | **Possession Ref:** |  |
    if (typeRowSeen && !routeLine && cells.length >= 2 && line.toLowerCase().includes('possession ref')) {
      const candidate = cells[1]?.trim() || ''
      if (candidate && !/^possession ref/i.test(candidate)) routeLine = candidate
      possessionRef = cells[3] || ''
      continue
    }

    // Equipment / asset row: | **Equipment:** | Track Circuit 55A-B | **Fault Code:** | ... |
    if (!equipment && cells.length > 0 && /equipment|asset\b/i.test(line)) {
      const valCell = cells.find(c => c && !/^(equipment|asset)/i.test(c) && !/^fault\s*code/i.test(c))
      if (valCell) equipment = valCell.trim()
      continue
    }

    // Area / Action / BTP: | **Area: ** | **Action: ** MB | **BTP Ref:** | 392 |
    if (cells.length > 0 && line.includes('Area:') && line.includes('Action:')) {
      area = cells[0].replace(/^Area:\s*/i, '').trim()
      action = cells[1].replace(/^Action:\s*/i, '').trim()
      const btpM = cells[3]?.match(/^(\d+)/)
      btpRef = btpM ? btpM[1] : ''
      continue
    }

    // Incident Start header row — values are on the next line
    // | Incident Start | Advised | Paged | Initial Resp | Arrived At | Trains Susp | OTM | NWR | Booked In Order |
    if (line.includes('Incident Start') && line.includes('Advised')) {
      const nextLine = lines[i + 1]?.trim() || ''
      if (nextLine.startsWith('|')) {
        const cells = cellValues(nextLine)
        incidentStart = cells[0] || ''
        advisedTime   = cells[1] || ''
        initialResp   = cells[3] || ''
        arrivedAt     = cells[4] || ''
        nwrTime       = cells[7] || ''
      }
      continue
    }

    // Stats header row → read values from next line
    if (line.includes('**TDA**') && line.includes('**Can**')) {
      const nextLine = lines[i + 1]?.trim() || ''
      if (nextLine.startsWith('|') && !nextLine.includes('**')) {
        const cells = cellValues(nextLine)
        // | TDA | TRMC | Can | Pt Can | blank | Trains | Mins | FTS/DIV | blank | Files |
        tdaRef        = cells[0] && cells[0] !== 'None' ? cells[0] : ''
        trustRef      = cells[1] || ''
        trmcCode      = cells[1] || ''
        cancelled     = parseInt(cells[2]) || 0
        partCancelled = parseInt(cells[3]) || 0
        trainsDelayed = parseInt(cells[5]) || 0
        minutesDelay  = parseInt(cells[6]) || 0
        ftsDivCount   = parseInt(cells[7]) || 0
        hasFiles      = /^yes/i.test(cells[9] || '')
      }
      continue
    }

    // Events section
    if (line === '**EVENTS**') {
      inEvents = true
      inTrainBlock = false
      eventHeaderSeen = false
      continue
    }

    // Train section
    if (line === '**TRAIN**') {
      inTrainBlock = true
      inEvents = false
      trainHeaderSeen = false
      continue
    }

    if (inTrainBlock) {
      if (line.includes('**T. ID**') && line.includes('**Date**')) {
        trainHeaderSeen = true
        continue
      }
      if (trainHeaderSeen && line.startsWith('|') && !line.includes('**')) {
        // | T.ID | Date | Time | Origin | Destination | Co | Driver | Guard |
        if (cells.length >= 6 && /^[0-9A-Z]{4,6}$/i.test(cells[0]) && !trainId) {
          trainId          = cells[0]
          trainOrigin      = cells[3] || ''
          trainDestination = cells[4] || ''
          trainCompany     = cells[5] || ''
        }
        continue
      }
      if (line.toLowerCase().includes('vehicle (unit)')) {
        // | **Vehicle (Unit):** |  | 66548  68012 |
        const allCells = cellValues(line)
        const numCell = allCells.find(c => /\d/.test(c) && !/vehicle/i.test(c))
        if (numCell) {
          numCell.split(/\s+/).map(s => s.trim()).filter(Boolean).forEach(u => unitNumbers.push(u))
        }
        continue
      }
    }

    if (inEvents) {
      if (line.includes('**Date**') && line.includes('**Description**')) {
        eventHeaderSeen = true
        continue
      }
      if (!eventHeaderSeen) continue

      if (line.startsWith('|')) {
        const cells = cellValues(line)
        // | DD/MM | HH:MM | CO | Description text |
        if (cells.length >= 4 && /^\d{2}\/\d{2}$/.test(cells[0]) && cells[3]) {
          events.push({
            date: cells[0],
            time: cells[1],
            company: cells[2],
            description: cells[3],
          })
        }
      }
    }
  }

  // ── Classification ─────────────────────────────────────────────────────────
  // Tier 1: exact CCIL label lookup (the type field contains the system's own label text)
  // Tier 2: CCIL numeric type code prefix
  // Tier 3: regex pattern matching on full search text
  const searchText = `${title} ${incidentType} ${location} ${events[0]?.description || ''}`
  let category: IncidentCategory =
    classifyByTypeLabel(incidentType) ??
    classifyByTypeCode(incidentType) ??
    'GENERAL'
  if (category === 'GENERAL') {
    for (const [pat, cat] of CATEGORY_PATTERNS) {
      if (pat.test(searchText)) { category = cat; break }
    }
  }

  // ── Title-based overrides: correct common CCIL miscoding ──────────────────
  // Assaults/accidents miscoded as PERSON_STRUCK (type codes 13/87) → PASSENGER_INJURY
  if (category === 'PERSON_STRUCK' &&
      /verbal assault|assault on staff|staff.*assault|anti.?social|harassment|accident.*train|accident.*platform|slip|trip|fell/i.test(searchText) &&
      !/struck.*train|by.*train/i.test(title)) {
    category = 'PASSENGER_INJURY'
  }
  // Mechanical/door faults miscoded as DERAILMENT (type code 10) → TRAIN_FAULT
  if (category === 'DERAILMENT' &&
      /door fault|door failure|unit.*fault|unit.*defect|train.*defect|on.?board|mechanical|bogie/i.test(title) &&
      !/derail|divided|runaway/i.test(title)) {
    category = 'TRAIN_FAULT'
  }
  // Near miss incidents miscoded as HABD (type code 08) → NEAR_MISS
  if (category === 'HABD_WILD' && /near.?miss/i.test(title)) {
    category = 'NEAR_MISS'
  }

  let severity: Severity = 'LOW'
  for (const [cats, sev] of SEVERITY_RULES) {
    if (cats.includes(category)) { severity = sev; break }
  }
  const SEV_ORDER: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  const escalate = (current: Severity, target: Severity): Severity =>
    SEV_ORDER.indexOf(target) > SEV_ORDER.indexOf(current) ? target : current
  if (minutesDelay > 2000)      severity = escalate(severity, 'CRITICAL')
  else if (minutesDelay > 1000) severity = escalate(severity, 'HIGH')
  else if (minutesDelay > 500)  severity = escalate(severity, 'MEDIUM')

  // ── Best description ───────────────────────────────────────────────────────
  const nrEvent = events.find(e => e.company === 'NR' && e.description.length > 50)
  const description = (nrEvent || events[0])?.description?.replace(/\s+/g, ' ').trim() || ''

  // ── Highlight flag — assigned in parseCCILText after all incidents are known ──
  const isHighlight = false

  // ── Derive type code / label from the CCIL type field ─────────────────────
  // e.g. "07b Level Crossing Deliberate Misuse" → code "07b", label "Level Crossing Deliberate Misuse"
  const typeMatch = incidentType.match(/^([0-9A-Z]+[a-z]?)\s+(.+)$/i)
  const incidentTypeCode  = typeMatch ? typeMatch[1].trim() : incidentType.split(/\s+/)[0] || ''
  const incidentTypeLabel = typeMatch ? typeMatch[2].trim() : ''

  // ── Responder initials — split action field on whitespace, keep 2–4 uppercase letters ──
  const responderInitials = action
    .split(/\s+/)
    .map(s => s.toUpperCase().trim())
    .filter(s => /^[A-Z]{2,4}$/.test(s))

  // ── Normalise incidentStart to HH:MM ──────────────────────────────────────
  const startHHMM = fmtHHMM(incidentStart) || isoDate.slice(11, 16)

  return {
    id: `ccil-${ccil}`,
    ccil,
    trustRef: trustRef || undefined,
    faultNo: faultNo || undefined,
    category,
    severity,
    title: stripMd(title),
    location: location || 'Unknown',
    area: area || undefined,
    line: routeLine || undefined,
    incidentStart: startHHMM,
    description,
    events,
    cancelled,
    partCancelled,
    trainsDelayed,
    minutesDelay,
    btpRef: btpRef || undefined,
    actionCode: action || undefined,
    isHighlight,
    rawText: lines.join('\n').slice(0, 1000),

    // ── Extended Insight fields ──────────────────────────────────────────────
    incidentTypeCode:  incidentTypeCode  || undefined,
    incidentTypeLabel: incidentTypeLabel || undefined,
    possessionRef:     possessionRef     || undefined,
    thirdPartyRef:     thirdPartyRef     || undefined,
    advisedTime:       fmtHHMM(advisedTime)  || undefined,
    initialRespTime:   fmtHHMM(initialResp)  || undefined,
    arrivedAtTime:     fmtHHMM(arrivedAt)    || undefined,
    nwrTime:           fmtHHMM(nwrTime)      || undefined,
    minsToAdvised:     diffMinutes(incidentStart, advisedTime)  ?? undefined,
    minsToResponse:    diffMinutes(incidentStart, initialResp)  ?? undefined,
    minsToArrival:     diffMinutes(incidentStart, arrivedAt)    ?? undefined,
    incidentDuration:  diffMinutes(incidentStart, nwrTime)      ?? undefined,
    trainId:           trainId           || undefined,
    trainCompany:      trainCompany      || undefined,
    trainOrigin:       trainOrigin       || undefined,
    trainDestination:  trainDestination  || undefined,
    unitNumbers:       unitNumbers.length ? unitNumbers : undefined,
    tdaRef:            tdaRef            || undefined,
    trmcCode:          trmcCode          || undefined,
    ftsDivCount:       ftsDivCount       || undefined,
    eventCount:        events.length,
    hasFiles:          hasFiles || undefined,
    responderInitials: responderInitials.length ? responderInitials : undefined,
    equipment:         equipment || undefined,
  }
}

// ─── Built-in category key set — used to distinguish custom group keys ────────

const BUILT_IN_CATS = new Set<string>([
  'FATALITY','PERSON_STRUCK','SPAD','TPWS','IRREGULAR_WORKING','NEAR_MISS','CRIME',
  'BRIDGE_STRIKE','HABD_WILD','LEVEL_CROSSING','FIRE','PASSENGER_INJURY','DERAILMENT',
  'INFRASTRUCTURE','TRACTION_FAILURE','TRAIN_FAULT','POSSESSION','STATION_OVERRUN',
  'STRANDED_TRAIN','WEATHER','GENERAL',
])

// ─── Main export ──────────────────────────────────────────────────────────────

/** @param labelOverrides - normalized CCIL label → group key from user settings */
/** @param groupSeverities - group key → user-configured Severity (overrides SEVERITY_RULES) */
export function parseCCILText(
  rawText: string,
  labelOverrides: Record<string, string> = {},
  groupSeverities: Record<string, Severity> = {}
): Incident[] {
  const lines = rawText.split('\n')
  const incidents: Incident[] = []

  // Locate all incident headers
  const headers: Array<{ lineIdx: number; title: string; ccil: string; isoDate: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(INCIDENT_HEADER)
    if (!m) continue
    const [, rawTitle, ccil, dateStr] = m
    const [datePart, timePart] = dateStr.split(' ')
    const [dd, mm, yyyy] = datePart.split('/')
    headers.push({
      lineIdx: i,
      title: stripMd(rawTitle),
      ccil,
      isoDate: `${yyyy}-${mm}-${dd}T${timePart}`,
    })
  }

  for (let h = 0; h < headers.length; h++) {
    const { lineIdx, title, ccil, isoDate } = headers[h]
    const endIdx = h + 1 < headers.length ? headers[h + 1].lineIdx : lines.length
    const blockLines = lines.slice(lineIdx, endIdx)

    if (SKIP_TITLE_PATTERNS.some(p => p.test(title))) continue

    const incident = parseIncidentBlock(blockLines, title, ccil, isoDate)

    // Apply user label overrides (from settings page)
    if (incident.incidentTypeLabel) {
      const groupKey = labelOverrides[normalizeForLookup(incident.incidentTypeLabel)]
      if (groupKey) {
        if (BUILT_IN_CATS.has(groupKey)) {
          incident.category = groupKey as IncidentCategory
          // Recompute base severity for the new category
          let newSev: Severity = 'INFO'
          for (const [cats, sev] of SEVERITY_RULES) {
            if ((cats as string[]).includes(groupKey)) { newSev = sev; break }
          }
          incident.severity = newSev
        } else {
          // Custom group: set displayGroup and move category to GENERAL so the
          // incident doesn't remain in whichever built-in section it was parsed into
          incident.displayGroup = groupKey
          incident.category = 'GENERAL'
        }
      }
    }

    // Apply user-configured severity (overrides SEVERITY_RULES), then re-apply
    // delay escalation on top so high-impact incidents are never under-reported.
    const effectiveGroupKey = incident.displayGroup ?? incident.category
    const userSev = groupSeverities[effectiveGroupKey]
    if (userSev !== undefined) {
      const SEV_ORDER: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
      const escalate = (cur: Severity, tgt: Severity): Severity =>
        SEV_ORDER.indexOf(tgt) > SEV_ORDER.indexOf(cur) ? tgt : cur
      let sev = userSev
      const delay = incident.minutesDelay || 0
      if (delay > 2000)      sev = escalate(sev, 'CRITICAL')
      else if (delay > 1000) sev = escalate(sev, 'HIGH')
      else if (delay > 500)  sev = escalate(sev, 'MEDIUM')
      incident.severity = sev
    }

    // Any recorded delay floors severity at LOW — INFO is for zero-disruption entries only
    if ((incident.minutesDelay || 0) > 0 && incident.severity === 'INFO') {
      incident.severity = 'LOW'
    }

    // Drop pure noise: GENERAL/INFO with no disruption data and <=1 event
    // These are administrative entries that slipped through the title filter
    const isNoise = incident.category === 'GENERAL'
      && incident.severity === 'INFO'
      && (incident.minutesDelay || 0) === 0
      && (incident.cancelled || 0) === 0
      && (incident.events?.length || 0) <= 1
    if (isNoise) continue

    incidents.push(incident)
  }

  const sevOrder: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
  incidents.sort((a, b) => {
    const d = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
    return d !== 0 ? d : (b.minutesDelay || 0) - (a.minutesDelay || 0)
  })

  // ── Auto-highlight ─────────────────────────────────────────────────────────
  // Always highlight CRITICAL/HIGH (safety-critical regardless of delay).
  // Additionally highlight up to 5 highest-delay incidents (>100 min).
  const highlighted = new Set<string>()
  incidents
    .filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH')
    .forEach(i => highlighted.add(i.id))
  incidents
    .filter(i => (i.minutesDelay || 0) > 100 && !highlighted.has(i.id))
    .sort((a, b) => (b.minutesDelay || 0) - (a.minutesDelay || 0))
    .slice(0, 5)
    .forEach(i => highlighted.add(i.id))
  incidents.forEach(i => { i.isHighlight = highlighted.has(i.id) })

  return incidents
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export function extractPeriod(text: string): { period: string; date: string } {
  const m = text.match(/(\d{1,2}\s+\w{3,9}\s+\d{4}\s+\d{2}:\d{2})\s+TO\s+(\d{1,2}\s+\w{3,9}\s+\d{4}\s+\d{2}:\d{2})/)
  if (m) {
    const period = `${m[1]} TO ${m[2]}`
    const dm = m[1].match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
    if (dm) {
      const months: Record<string, string> = {
        January:'01', February:'02', March:'03', April:'04', May:'05', June:'06',
        July:'07', August:'08', September:'09', October:'10', November:'11', December:'12',
        Jan:'01', Feb:'02', Mar:'03', Apr:'04', Jun:'06',
        Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
      }
      return {
        period,
        date: `${dm[3]}-${months[dm[2]] || '01'}-${dm[1].padStart(2, '0')}`,
      }
    }
  }
  return { period: 'Unknown Period', date: new Date().toISOString().split('T')[0] }
}

export function extractCreatedBy(text: string): string {
  const m = text.match(/Created by:\s*([^\n|]+?)(?:\s+of\s+Network Rail|\s*\||\n|$)/i)
  return m ? m[1].trim() : ''
}

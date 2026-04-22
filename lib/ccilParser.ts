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
  [/passenger.*injur|injur.*passenger|public.*injur|person.*fell.*track/i,         'PASSENGER_INJURY'],
  [/assault.*passenger|passenger.*assault/i,                                       'PASSENGER_INJURY'],
  [/traction failure|unit.*failure|VCB not closing|AWS brake demand|bogie.*fault/i,'TRACTION_FAILURE'],
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
  [['INFRASTRUCTURE', 'POSSESSION', 'STATION_OVERRUN'],                 'LOW'],
  [['STRANDED_TRAIN', 'WEATHER', 'GENERAL'],                            'INFO'],
]

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

const INCIDENT_HEADER = /^\| (.+?) \| \*\*Location:\*\* \| \*\*Incident \*\*(\d+) \*\* \*\* \| ([\d\/]+ [\d:]+) \|$/

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
  [/^15[0-9A]?\s/i,   'CRIME'],           // 15/15A trespass/crime; 155 dispatch incidents → IRREGULAR
  [/^155\s/i,         'IRREGULAR_WORKING'],// 155 Dispatch incidents (override 15x match)
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
  [/^5[45]\s/i,       'TRACTION_FAILURE'], // 54 On-train defect, 55 Train failure on depot
  [/^58\s/i,          'INFRASTRUCTURE'],   // 58 Signal obscured
  [/^59\s/i,          'GENERAL'],          // 59 Staff issues
  // ── 60s–80s: operational/admin ─────────────────────────────────────────────
  [/^64\s/i,          'INFRASTRUCTURE'],   // 64 Station infrastructure
  [/^70\s/i,          'CRIME'],            // 70 Security issues
  [/^71\s/i,          'TRACTION_FAILURE'], // 71 On-train defect (RB)
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

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue
    if (line === '| --- | --- | --- | --- |') continue

    // Location row (i=2): |  | Location Name |  |  |
    if (i === 2 && line.startsWith('|')) {
      const cells = cellValues(line)
      location = cells[1] || cells[0] || ''
      location = location.replace(/\s*-?\s*\[[A-Z]{2,4}\]/g, '').replace(/ - $/, '').trim()
      continue
    }

    // Type + fault row (i=3): | **07b Level Crossing...** | **Line: ** | **Fault Number:** | 1141433 |
    if (i === 3 && line.startsWith('|')) {
      const cells = cellValues(line)
      incidentType = cells[0] || ''
      faultNo = cells[3] || ''
      continue
    }

    // Area / Action / BTP (i=5): | **Area: ** | **Action: ** MB | **BTP Ref:** | 392 |
    if (i === 5 && line.startsWith('|')) {
      const cells = cellValues(line)
      area = cells[0].replace(/^Area:\s*/i, '').trim()
      action = cells[1].replace(/^Action:\s*/i, '').trim()
      const btpM = cells[3]?.match(/^(\d+)/)
      btpRef = btpM ? btpM[1] : ''
      continue
    }

    // Incident Start header row
    if (line.includes('Incident Start') && line.includes('Advised')) {
      const nextLine = lines[i + 1]?.trim() || ''
      if (nextLine.startsWith('|')) {
        const cells = cellValues(nextLine)
        incidentStart = cells[0] || ''
      }
      continue
    }

    // Stats header row → read values from next line
    if (line.includes('**TDA**') && line.includes('**Can**')) {
      const nextLine = lines[i + 1]?.trim() || ''
      if (nextLine.startsWith('|') && !nextLine.includes('**')) {
        const cells = cellValues(nextLine)
        // | TDA | TRMC | Can | Pt Can | blank | Trains | Mins | FTS | blank | Files |
        trustRef    = cells[1] || ''
        cancelled    = parseInt(cells[2]) || 0
        partCancelled = parseInt(cells[3]) || 0
        trainsDelayed = parseInt(cells[5]) || 0
        minutesDelay  = parseInt(cells[6]) || 0
      }
      continue
    }

    // Events section
    if (line === '**EVENTS**') {
      inEvents = true
      eventHeaderSeen = false
      continue
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
  // 1. CCIL numeric type code (authoritative — directly from the system)
  // 2. Pattern match on title + type label + location + first event
  const searchText = `${title} ${incidentType} ${location} ${events[0]?.description || ''}`
  let category: IncidentCategory = classifyByTypeCode(incidentType) || 'GENERAL'
  if (category === 'GENERAL') {
    for (const [pat, cat] of CATEGORY_PATTERNS) {
      if (pat.test(searchText)) { category = cat; break }
    }
  }

  let severity: Severity = 'LOW'
  for (const [cats, sev] of SEVERITY_RULES) {
    if (cats.includes(category)) { severity = sev; break }
  }
  if (severity === 'LOW' && minutesDelay > 2000) severity = 'HIGH'
  else if (severity === 'LOW' && minutesDelay > 500) severity = 'MEDIUM'

  // ── Best description ───────────────────────────────────────────────────────
  const nrEvent = events.find(e => e.company === 'NR' && e.description.length > 50)
  const description = (nrEvent || events[0])?.description?.replace(/\s+/g, ' ').trim() || title

  // ── Highlight flag ─────────────────────────────────────────────────────────
  const highlightCats: IncidentCategory[] = [
    'FATALITY', 'PERSON_STRUCK', 'SPAD', 'FIRE', 'BRIDGE_STRIKE',
    'NEAR_MISS', 'IRREGULAR_WORKING', 'CRIME', 'HABD_WILD',
    'DERAILMENT', 'LEVEL_CROSSING', 'PASSENGER_INJURY',
  ]
  const isHighlight = highlightCats.includes(category) || minutesDelay > 1000 || cancelled > 10

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
    line: '',
    incidentStart: incidentStart
      ? `${incidentStart.slice(0, 2)}:${incidentStart.slice(2, 4)}`
      : isoDate.slice(11, 16),
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
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseCCILText(rawText: string): Incident[] {
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

import type { HazardLevel, DayWeather, FiveDayWeather } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const HAZARD_RANK: Record<HazardLevel, number> = {
  GREEN: 0, AWARE: 1, ADVERSE: 2, EXTREME: 3,
}

const ALERT_RE = /^(aware|adverse|extreme)$/i

const DAY_MAP: Record<string, string> = {
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
  sun: 'Sunday',   mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
}

// Canonical column names as they appear in the Summary Hazards table headers.
// Matching uses the first distinctive word of each name.
const COLUMN_LABELS: Array<{ key: string; label: string }> = [
  { key: 'wind',       label: 'Wind'               },
  { key: 'heavy',      label: 'Heavy Rain'          },
  { key: 'convective', label: 'Conv. Rainfall'      },
  { key: 'lightning',  label: 'Lightning'           },
  { key: 'snow',       label: 'Snow'                },
  { key: 'frost',      label: 'Frost'               },
  { key: 'max',        label: 'Max Temp'            },
  { key: 'min',        label: 'Min Temp'            },
  { key: 'temp',       label: 'Temp Range'          },
  { key: 'ice',        label: 'Ice Day'             },
]

// ─── Internal text item type ──────────────────────────────────────────────────

interface TItem {
  str: string
  x:   number
  y:   number
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractItems(file: File): Promise<TItem[]> {
  const pdfjsLib = await import('pdfjs-dist')

  // Use CDN worker to avoid bundling the large worker script
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
  const all: TItem[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page     = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content  = await page.getTextContent()

    for (const item of content.items as any[]) {
      if (!item.str?.trim()) continue
      const [, , , , tx, ty] = item.transform
      all.push({
        str: item.str.trim(),
        x:   Math.round(tx),
        y:   Math.round(viewport.height - ty), // flip to top-down
      })
    }
  }
  return all
}

// ─── Row grouping ─────────────────────────────────────────────────────────────

function groupRows(items: TItem[], tol = 4): TItem[][] {
  if (!items.length) return []
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: TItem[][] = []
  let cur: TItem[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = cur[cur.length - 1]
    if (Math.abs(sorted[i].y - prev.y) <= tol) {
      cur.push(sorted[i])
    } else {
      rows.push(cur)
      cur = [sorted[i]]
    }
  }
  rows.push(cur)
  return rows
}

const rtext = (row: TItem[]) => row.map(i => i.str).join(' ')

// ─── Table section parser ─────────────────────────────────────────────────────

function parseSection(allRows: TItem[][], startIdx: number): DayWeather[] {
  const results: DayWeather[] = []
  const DAY_START_RE = /^(mon|tue|wed|thu|fri|sat|sun)/i

  // ── Step 1: find the "Hazard / Conf" sub-header row inside this section.
  //    It has at least 5 occurrences of the word "Hazard" (one per column).
  let hazardRow: TItem[] = []
  let hazardRowIdx = -1

  for (let i = startIdx; i < Math.min(startIdx + 12, allRows.length); i++) {
    const hCount = allRows[i].filter(it => /^hazard$/i.test(it.str)).length
    if (hCount >= 5) { hazardRow = allRows[i]; hazardRowIdx = i; break }
  }

  // ── Step 2: build a mapping from hazard x-position → column label.
  //    The column-name header row is the first row in [startIdx, hazardRowIdx)
  //    that contains "Wind" (the leftmost column name).
  const colXmap: Array<{ x: number; label: string }> = []

  if (hazardRowIdx > startIdx) {
    let colNameRow: TItem[] = []
    for (let i = startIdx; i < hazardRowIdx; i++) {
      if (/wind/i.test(rtext(allRows[i]))) { colNameRow = allRows[i]; break }
    }

    if (colNameRow.length) {
      // Sort column name items by x; match each to a COLUMN_LABELS entry
      const nameItems = [...colNameRow].sort((a, b) => a.x - b.x)
      const matched: Array<{ x: number; label: string }> = []

      for (const item of nameItems) {
        const lower = item.str.toLowerCase()
        const col = COLUMN_LABELS.find(c => lower.startsWith(c.key))
        if (col && !matched.find(m => m.label === col.label)) {
          matched.push({ x: item.x, label: col.label })
        }
      }

      // The hazard sub-columns appear in the same left-to-right order.
      // Pair each matched column name with its corresponding "Hazard" x.
      const hazardXs = hazardRow
        .filter(it => /^hazard$/i.test(it.str))
        .map(it => it.x)
        .sort((a, b) => a - b)

      matched.sort((a, b) => a.x - b.x).forEach((col, idx) => {
        if (idx < hazardXs.length) {
          colXmap.push({ x: hazardXs[idx], label: col.label })
        }
      })
    }
  }

  // ── Step 3: parse each day row.
  for (let i = startIdx; i < allRows.length && results.length < 5; i++) {
    const row   = allRows[i]
    const first = row[0]?.str ?? ''
    if (!DAY_START_RE.test(first)) continue

    const dayKey = first.slice(0, 3).toLowerCase()
    const dayFull = DAY_MAP[dayKey] ?? first

    const alerts = row.filter(it => ALERT_RE.test(it.str))

    if (alerts.length === 0) {
      results.push({ day: dayFull, level: 'GREEN', triggers: [] })
      continue
    }

    let topLevel: HazardLevel = 'GREEN'
    const triggerSet = new Set<string>()

    for (const alert of alerts) {
      const lvl = alert.str.toUpperCase() as HazardLevel
      if (HAZARD_RANK[lvl] > HAZARD_RANK[topLevel]) topLevel = lvl

      if (colXmap.length) {
        // Find the column whose hazard x-position is nearest this alert's x.
        let nearest = colXmap[0]
        let minDist = Math.abs(alert.x - nearest.x)
        for (const col of colXmap) {
          const d = Math.abs(alert.x - col.x)
          if (d < minDist) { minDist = d; nearest = col }
        }
        triggerSet.add(nearest.label)
      }
    }

    results.push({ day: dayFull, level: topLevel, triggers: Array.from(triggerSet) })
  }

  return results
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseWeatherPDF(file: File): Promise<FiveDayWeather> {
  const items = await extractItems(file)
  const rows  = groupRows(items)

  // Locate the two relevant summary table headers (case-insensitive).
  const emIdx = rows.findIndex(r =>
    /east\s+midlands/i.test(rtext(r)) && /lne|em/i.test(rtext(r))
  )
  const lnIdx = rows.findIndex(r =>
    /london\s+north/i.test(rtext(r)) && /lne|em/i.test(rtext(r))
  )

  const eastMidlands = emIdx >= 0 ? parseSection(rows, emIdx + 1) : []
  const londonNorth  = lnIdx >= 0 ? parseSection(rows, lnIdx + 1) : []

  // Pull the "Issued on … by …" footer line if present.
  const issuedRow = rows.find(r => /issued\s+on/i.test(rtext(r)))
  const issuedBy  = issuedRow ? rtext(issuedRow).replace(/^.*?issued\s+on\s+/i, '') : undefined

  return { eastMidlands, londonNorth, issuedBy }
}

// ─── Derive day names from a log date when no PDF is available ────────────────

export function deriveDaysFromDate(isoDate: string): string[] {
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
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

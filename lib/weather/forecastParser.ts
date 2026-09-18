// ─── NR Route 7 Day Forecast — parser ────────────────────────────────────────
//
// Turns the page models of a MetDesk "East Midlands Route 7 Day Forecast" PDF
// into a ForecastDocument. Pure: no DOM, no pdfjs, no Date.now(). Layout facts
// it relies on (all verified against the 18-09-2026 issue):
//
//   • Header lines "Issued on …", "Valid for …", the forecaster phone line.
//   • Two narrative blocks under "Forecast - 24 hours (…)" and
//     "Forecast - 2 to 7 Days (…)" headings.
//   • One "Summary Hazards - <Area> (<Route>)" table per area, each with a
//     blue title band, a blue header row (one fill per column) and one row per
//     day. Columns are found from the header fills, not hard-coded x values,
//     so a re-ordered or added column is tolerated.
//   • A hazard cell = coloured block (level) + word (confidence). The level word
//     is only printed when the cell is not normal. Temperature cells are
//     coloured with no word. Ice Day prints Yes/No + confidence.
//
// Anything that does not match produces a warning rather than an exception,
// so the operator sees what was and was not read and can correct it.

import type { PageModel, PageText, PageFill } from './pageModel'
import {
  type ForecastDocument, type ForecastArea, type ForecastDay, type ForecastSummary,
  type HazardCell, type TempCell, type IceDayCell, type HazardLevel, type RiskLevel,
  type Confidence, type ForecastRisk,
  areaKeyFromName, hazardFromWord, dayOverallLevel, worseHazard, addDaysIso, weekdayName,
} from './forecastTypes'

// ─── Colour → level ───────────────────────────────────────────────────────────

/** Header / title band colour of the tables (MetDesk blue). */
function isHeaderBlue(rgb: [number, number, number]): boolean {
  const [r, g, b] = rgb
  return r < 60 && g > 90 && g < 170 && b > 150
}

export function levelFromRgb(rgb: [number, number, number] | null): HazardLevel | null {
  if (!rgb) return null
  const [r, g, b] = rgb
  if (g >= 140 && r <= 130 && b <= 130) return 'GREEN'                  // 51,204,51
  if (r >= 200 && g >= 200 && b <= 110) return 'AWARE'                  // 255,255,0
  if (r >= 200 && g >= 90 && g < 200 && b <= 110) return 'ADVERSE'      // amber / orange
  if (r >= 170 && g < 90 && b < 90) return 'EXTREME'                    // red
  if (r >= 120 && g < 80 && b >= 120) return 'EXTREME'                  // purple variants some products use
  return null
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }

function tzOffset(label: string | null): string {
  const l = (label || '').toUpperCase()
  if (l === 'BST' || l === 'IST' || l === 'CET' || l === 'WEST') return '+01:00'
  if (l === 'CEST') return '+02:00'
  return '+00:00' // GMT / UTC / unknown
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

interface Line { y: number; texts: PageText[]; str: string; page: number }

/** Group a page's text runs into visual lines (same baseline ± 2pt), left→right. */
function linesOf(page: PageModel): Line[] {
  const sorted = page.texts.slice().sort((a, b) => a.yc - b.yc || a.x0 - b.x0)
  const lines: Line[] = []
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - t.yc) <= 2.5) { last.texts.push(t) }
    else lines.push({ y: t.yc, texts: [t], str: '', page: page.index })
  }
  for (let i = 0; i < lines.length; i++) {
    lines[i].texts.sort((a, b) => a.x0 - b.x0)
    lines[i].str = lines[i].texts.map(t => t.str).join(' ').replace(/\s+/g, ' ').trim()
  }
  return lines
}

// ─── Header ───────────────────────────────────────────────────────────────────

function parseHeader(lines: Line[], doc: ForecastDocument): void {
  let biggest: PageText | null = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    for (let t = 0; t < l.texts.length; t++) {
      if (!biggest || l.texts[t].height > biggest.height) biggest = l.texts[t]
    }
    const s = l.str

    const issued = /Issued on\s+(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([A-Z]{2,5})?\s*(?:by\s+(.+))?$/i.exec(s)
    if (issued && !doc.issuedAt) {
      doc.issuedAtText = s.replace(/^Issued on\s+/i, '')
      const [, d, m, y, hh, mm, ss, tz, by] = issued
      doc.issuedAt = `${y}-${pad2(+m)}-${pad2(+d)}T${pad2(+hh)}:${mm}:${ss || '00'}${tzOffset(tz || null)}`
      doc.issuedBy = by ? by.trim() : null
      continue
    }

    const valid = /Valid for\s+(\d{1,2}):(\d{2})\s+(?:[A-Za-z]+\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+to\s+(\d{1,2}):(\d{2})\s+(?:[A-Za-z]+\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i.exec(s)
    if (valid && !doc.validFrom) {
      const [, h1, m1, d1, mon1, y1, h2, m2, d2, mon2, y2] = valid
      const mi1 = MONTHS.indexOf(mon1.toLowerCase()), mi2 = MONTHS.indexOf(mon2.toLowerCase())
      if (mi1 >= 0 && mi2 >= 0) {
        const off = tzOffset(/BST/i.test(doc.issuedAtText || '') ? 'BST' : (doc.issuedAtText ? 'GMT' : 'BST'))
        doc.validFromDate = `${y1}-${pad2(mi1 + 1)}-${pad2(+d1)}`
        doc.validFrom = `${doc.validFromDate}T${pad2(+h1)}:${m1}:00${off}`
        doc.validTo = `${y2}-${pad2(mi2 + 1)}-${pad2(+d2)}T${pad2(+h2)}:${m2}:00${off}`
      }
      continue
    }

    const phone = /Forecaster on\s+([\d ]{6,})/i.exec(s)
    if (phone && !doc.forecasterPhone) doc.forecasterPhone = phone[1].trim()
  }
  if (biggest) {
    doc.title = biggest.str
    const r = /^(.*?)\s+Route\b/i.exec(biggest.str)
    doc.route = r ? r[1].trim() : null
  }
  if (!doc.validFromDate && doc.issuedAt) doc.validFromDate = doc.issuedAt.slice(0, 10)
}

// ─── Narrative summaries ──────────────────────────────────────────────────────

const SUMMARY_HEADING = /^Forecast\s*[-–]\s*(.+?)\s*(?:\((.*)\))?\s*$/i
const TABLE_HEADING   = /^Summary Hazards\s*[-–]\s*(.+?)\s*(?:\(([^)]*)\))?\s*$/i

function parseSummaries(lines: Line[], doc: ForecastDocument): void {
  const out: ForecastSummary[] = []
  let current: ForecastSummary | null = null
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].str
    if (TABLE_HEADING.test(s)) { current = null; continue }
    const h = SUMMARY_HEADING.exec(s)
    if (h) {
      const label = h[1].trim()
      let key = slug(label)
      if (/^24\s*hours?/i.test(label)) key = 'summary24h'
      else if (/2\s*(?:to|-|–)\s*7/i.test(label)) key = 'summary2to7'
      current = { key, heading: s, text: '' }
      out.push(current)
      continue
    }
    if (current) {
      // Stop at anything that looks like a new header block (e.g. the phone line repeated).
      if (/^For further information/i.test(s) || /^Issued on/i.test(s) || /^Valid for/i.test(s)) { current = null; continue }
      current.text = (current.text ? current.text + ' ' : '') + s
    }
  }
  doc.summaries = out
  for (let i = 0; i < out.length; i++) {
    if (out[i].key === 'summary24h')  doc.summary24h  = out[i].text || null
    if (out[i].key === 'summary2to7') doc.summary2to7 = out[i].text || null
  }
}

// ─── Hazard tables ────────────────────────────────────────────────────────────

interface Band { x0: number; x1: number; label: string; key: ColumnKey | null }

type ColumnKey =
  | 'day' | 'wind' | 'heavyRain' | 'convectiveRain' | 'snow' | 'frost'
  | 'minMorning' | 'max' | 'minNight' | 'tempRange' | 'iceDay' | 'lightning'

function columnKeyFor(label: string): ColumnKey | null {
  const l = label.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^day\b/.test(l)) return 'day'
  if (/wind/.test(l)) return 'wind'
  if (/heavy rain|rain accum|rainfall accum/.test(l)) return 'heavyRain'
  if (/convective/.test(l)) return 'convectiveRain'
  if (/snow/.test(l)) return 'snow'
  if (/frost/.test(l)) return 'frost'
  if (/min temp/.test(l) && /morn|06-11|am/.test(label.toLowerCase())) return 'minMorning'
  if (/max temp/.test(l)) return 'max'
  if (/min temp/.test(l)) return 'minNight'
  if (/temp range|range/.test(l)) return 'tempRange'
  if (/ice/.test(l)) return 'iceDay'
  if (/lightning/.test(l)) return 'lightning'
  return null
}

function within(x: number, b: Band): boolean { return x >= b.x0 - 0.5 && x <= b.x1 + 0.5 }

function emptyCell(): HazardCell { return { level: null, confidence: null, text: '', rgb: null } }
function emptyTemp(): TempCell { return { value: null, level: null, rgb: null } }

interface CellRaw { texts: string[]; fill: PageFill | null }

function readCell(texts: PageText[], fills: PageFill[], band: Band, y0: number, y1: number): CellRaw {
  const words: string[] = []
  const sortedTexts = texts.slice().sort((a, b) => a.x0 - b.x0)
  for (let i = 0; i < sortedTexts.length; i++) {
    const t = sortedTexts[i]
    const xc = (t.x0 + t.x1) / 2
    if (t.yc >= y0 && t.yc <= y1 && within(xc, band)) words.push(t.str)
  }
  let fill: PageFill | null = null
  for (let i = 0; i < fills.length; i++) {
    const f = fills[i]
    const yc = (f.y0 + f.y1) / 2, xc = (f.x0 + f.x1) / 2
    if (yc >= y0 && yc <= y1 && within(xc, band) && !isHeaderBlue(f.rgb)) {
      // Prefer the largest coloured block in the cell.
      if (!fill || (f.x1 - f.x0) * (f.y1 - f.y0) > (fill.x1 - fill.x0) * (fill.y1 - fill.y0)) fill = f
    }
  }
  return { texts: words, fill }
}

function confidenceOf(words: string[]): Confidence | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase()
    if (w === 'high') return 'High'
    if (w === 'medium' || w === 'med') return 'Medium'
    if (w === 'low') return 'Low'
  }
  return null
}

function hazardCell(raw: CellRaw, ctx: string, warnings: string[]): HazardCell {
  const rgb = raw.fill ? raw.fill.rgb : null
  const fromColour = levelFromRgb(rgb)
  let fromWord: HazardLevel | null = null
  for (let i = 0; i < raw.texts.length; i++) {
    const lvl = hazardFromWord(raw.texts[i])
    if (lvl) fromWord = fromWord ? worseHazard(fromWord, lvl) : lvl
  }
  let level: HazardLevel | null = fromWord ?? fromColour
  if (fromWord && fromColour && fromWord !== fromColour) {
    warnings.push(`${ctx}: cell reads "${raw.texts.join(' ')}" but is coloured ${fromColour}; using the word.`)
  }
  if (!level && rgb) warnings.push(`${ctx}: unrecognised cell colour rgb(${rgb.join(',')}).`)
  if (!level && !rgb && raw.texts.length === 0) level = null
  return { level, confidence: confidenceOf(raw.texts), text: raw.texts.join(' '), rgb }
}

function tempCell(raw: CellRaw, ctx: string, warnings: string[]): TempCell {
  let value: number | null = null
  for (let i = 0; i < raw.texts.length; i++) {
    const n = Number(raw.texts[i].replace(/[^0-9.\-]/g, ''))
    if (raw.texts[i].trim() !== '' && !isNaN(n) && /\d/.test(raw.texts[i])) { value = n; break }
  }
  const rgb = raw.fill ? raw.fill.rgb : null
  let level = levelFromRgb(rgb)
  for (let i = 0; i < raw.texts.length; i++) {
    const lvl = hazardFromWord(raw.texts[i])
    if (lvl) level = lvl
  }
  if (value === null) warnings.push(`${ctx}: no temperature value found (cell text "${raw.texts.join(' ')}").`)
  if (!level && rgb) warnings.push(`${ctx}: unrecognised temperature cell colour rgb(${rgb.join(',')}).`)
  return { value, level, rgb }
}

function iceCell(raw: CellRaw): IceDayCell {
  let value: boolean | null = null
  for (let i = 0; i < raw.texts.length; i++) {
    const w = raw.texts[i].toLowerCase()
    if (w === 'yes' || w === 'y') value = true
    if (w === 'no' || w === 'n') value = false
  }
  const rgb = raw.fill ? raw.fill.rgb : null
  let level = levelFromRgb(rgb)
  for (let i = 0; i < raw.texts.length; i++) {
    const lvl = hazardFromWord(raw.texts[i])
    if (lvl) level = lvl
  }
  if (value === true && (!level || level === 'GREEN')) level = 'AWARE'
  return { value, confidence: confidenceOf(raw.texts), level, text: raw.texts.join(' ') }
}

function riskOf(cell: { level: HazardLevel | null }): RiskLevel | null {
  return cell.level && cell.level !== 'GREEN' ? cell.level : null
}

/**
 * Parse every "Summary Hazards" table across the pages. Tables never split
 * across a page break in the current product, but each page is scanned
 * independently so a title on one page and rows on the next would simply
 * yield a warning rather than garbage.
 */
function parseTables(pages: PageModel[], doc: ForecastDocument): void {
  const areas: ForecastArea[] = []
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]
    const lines = linesOf(page)
    const titleIdx: number[] = []
    for (let i = 0; i < lines.length; i++) if (TABLE_HEADING.test(lines[i].str)) titleIdx.push(i)

    for (let t = 0; t < titleIdx.length; t++) {
      const titleLine = lines[titleIdx[t]]
      const m = TABLE_HEADING.exec(titleLine.str)!
      const name = m[1].trim()
      const route = m[2] ? m[2].trim() : null
      const key = areaKeyFromName(name)
      const ctxArea = `${name}`
      const yStart = titleLine.y
      const yEnd = t + 1 < titleIdx.length ? lines[titleIdx[t + 1]].y - 2 : page.height

      // Header fills: the first cluster (by y) of ≥ 6 blue fills below the title.
      const blue = page.fills.filter(f => isHeaderBlue(f.rgb) && f.y0 > yStart && f.y0 < yEnd)
      blue.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
      let header: PageFill[] = []
      for (let i = 0; i < blue.length; i++) {
        const cluster = blue.filter(f => Math.abs(f.y0 - blue[i].y0) < 1.5)
        if (cluster.length >= 6) { header = cluster.sort((a, b) => a.x0 - b.x0); break }
      }
      if (!header.length) {
        doc.warnings.push(`${ctxArea}: could not find the table header row; area skipped.`)
        continue
      }
      const headerTop = header[0].y0, headerBottom = header[0].y1
      const bands: Band[] = header.map(f => ({ x0: f.x0, x1: f.x1, label: '', key: null }))
      // Label each band from the header text runs (sorted top→bottom, left→right).
      const headerTexts = page.texts.filter(x => x.yc > headerTop && x.yc < headerBottom)
        .sort((a, b) => a.yc - b.yc || a.x0 - b.x0)
      for (let b = 0; b < bands.length; b++) {
        const parts: string[] = []
        for (let i = 0; i < headerTexts.length; i++) {
          const x = headerTexts[i]
          if (within((x.x0 + x.x1) / 2, bands[b])) parts.push(x.str)
        }
        bands[b].label = parts.join(' ')
        bands[b].key = columnKeyFor(bands[b].label)
      }
      const dayBand = bands.filter(b => b.key === 'day')[0] || bands[0]
      const seenKeys: string[] = []
      for (let b = 0; b < bands.length; b++) {
        const k = bands[b].key
        if (k && k !== 'day') {
          if (seenKeys.indexOf(k) >= 0) { doc.warnings.push(`${ctxArea}: duplicate column "${bands[b].label}".`); bands[b].key = null }
          else seenKeys.push(k)
        }
      }
      const expected: ColumnKey[] = ['wind', 'heavyRain', 'convectiveRain', 'snow', 'frost', 'minMorning', 'max', 'minNight', 'tempRange', 'iceDay', 'lightning']
      for (let i = 0; i < expected.length; i++) {
        if (seenKeys.indexOf(expected[i]) < 0) doc.warnings.push(`${ctxArea}: column "${expected[i]}" not found in the header.`)
      }

      // Data rows: day names in the Day column, below the header.
      const rowTexts = page.texts.filter(x =>
        x.yc > headerBottom && x.yc < yEnd && within((x.x0 + x.x1) / 2, dayBand) &&
        DAY_NAMES.indexOf(x.str.toLowerCase()) >= 0,
      ).sort((a, b) => a.yc - b.yc)

      const rowTextsAll = page.texts.filter(x => x.yc > headerBottom && x.yc < yEnd)
      const rowFills = page.fills.filter(f => f.y0 > headerBottom - 1 && f.y1 < yEnd + 1)

      const days: ForecastDay[] = []
      for (let r = 0; r < rowTexts.length; r++) {
        const dayText = rowTexts[r]
        // Row extent: half-way to the neighbouring rows, capped to a sensible height.
        const prevY = r > 0 ? rowTexts[r - 1].yc : headerBottom
        const nextY = r + 1 < rowTexts.length ? rowTexts[r + 1].yc : dayText.yc + (dayText.yc - prevY)
        const y0 = Math.max(headerBottom, (prevY + dayText.yc) / 2)
        const y1 = Math.min(yEnd, (dayText.yc + nextY) / 2)
        const date = doc.validFromDate ? addDaysIso(doc.validFromDate, r) : ''
        const dayName = dayText.str
        const ctx = `${ctxArea} / ${dayName}`
        if (date && weekdayName(date).toLowerCase() !== dayName.toLowerCase()) {
          doc.warnings.push(`${ctx}: row ${r + 1} is labelled ${dayName} but the forecast's day ${r + 1} is ${weekdayName(date)} (${date}).`)
        }

        const day: ForecastDay = {
          dayIndex: r, date, dayName,
          hazards: {
            wind: emptyCell(), heavyRain: emptyCell(), convectiveRain: emptyCell(),
            snow: emptyCell(), frost: emptyCell(), tempRange: emptyCell(), lightning: emptyCell(),
          },
          temps: { minMorning: emptyTemp(), max: emptyTemp(), minNight: emptyTemp() },
          iceDay: { value: null, confidence: null, level: null, text: '' },
          risks: {}, overallLevel: 'GREEN', extra: {},
        }

        for (let b = 0; b < bands.length; b++) {
          const band = bands[b]
          if (band.key === 'day') continue
          const raw = readCell(rowTextsAll, rowFills, band, y0, y1)
          const cctx = `${ctx} / ${band.label || 'column ' + (b + 1)}`
          switch (band.key) {
            case 'wind':           day.hazards.wind           = hazardCell(raw, cctx, doc.warnings); break
            case 'heavyRain':      day.hazards.heavyRain      = hazardCell(raw, cctx, doc.warnings); break
            case 'convectiveRain': day.hazards.convectiveRain = hazardCell(raw, cctx, doc.warnings); break
            case 'snow':           day.hazards.snow           = hazardCell(raw, cctx, doc.warnings); break
            case 'frost':          day.hazards.frost          = hazardCell(raw, cctx, doc.warnings); break
            case 'tempRange':      day.hazards.tempRange      = hazardCell(raw, cctx, doc.warnings); break
            case 'lightning':      day.hazards.lightning      = hazardCell(raw, cctx, doc.warnings); break
            case 'minMorning':     day.temps.minMorning       = tempCell(raw, cctx, doc.warnings); break
            case 'max':            day.temps.max              = tempCell(raw, cctx, doc.warnings); break
            case 'minNight':       day.temps.minNight         = tempCell(raw, cctx, doc.warnings); break
            case 'iceDay':         day.iceDay                 = iceCell(raw); break
            default: {
              const label = band.label || `column ${b + 1}`
              const lvl = levelFromRgb(raw.fill ? raw.fill.rgb : null)
              day.extra[label] = [raw.texts.join(' '), lvl && lvl !== 'GREEN' ? `(${lvl})` : ''].join(' ').trim()
              break
            }
          }
        }

        // Canonical risk map — only the non-normal cells.
        const risks: Partial<Record<ForecastRisk, RiskLevel>> = {}
        const put = (name: ForecastRisk, lvl: RiskLevel | null) => {
          if (lvl) risks[name] = risks[name] ? worseHazard(risks[name]!, lvl) as RiskLevel : lvl
        }
        put('Wind', riskOf(day.hazards.wind))
        put('Heavy Rain', riskOf(day.hazards.heavyRain))
        put('Convective Rainfall', riskOf(day.hazards.convectiveRain))
        put('Snow', riskOf(day.hazards.snow))
        put('Frost', riskOf(day.hazards.frost))
        put('Min Temp', riskOf(day.temps.minMorning))
        put('Min Temp', riskOf(day.temps.minNight))
        put('Max Temp', riskOf(day.temps.max))
        put('Temp Range', riskOf(day.hazards.tempRange))
        put('Ice Day', riskOf(day.iceDay))
        put('Lightning', riskOf(day.hazards.lightning))
        day.risks = risks
        day.overallLevel = dayOverallLevel(risks)
        days.push(day)
      }

      if (!days.length) doc.warnings.push(`${ctxArea}: header found but no day rows.`)
      areas.push({ key, name, route, days })
    }
  }
  doc.areas = areas
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function parseForecastPages(pages: PageModel[]): ForecastDocument {
  const doc: ForecastDocument = {
    title: '', route: null,
    issuedAt: null, issuedAtText: null, issuedBy: null,
    validFrom: null, validTo: null, validFromDate: null,
    forecasterPhone: null,
    summaries: [], summary24h: null, summary2to7: null,
    areas: [], pageCount: pages.length, warnings: [],
  }
  if (!pages.length) { doc.warnings.push('The PDF has no pages.'); return doc }

  const allLines: Line[] = []
  for (let p = 0; p < pages.length; p++) {
    const ls = linesOf(pages[p])
    for (let i = 0; i < ls.length; i++) allLines.push(ls[i])
  }

  parseHeader(allLines, doc)
  if (!/7\s*day/i.test(doc.title) && !/forecast/i.test(doc.title)) {
    doc.warnings.push(`This does not look like a Route 7 Day Forecast (title "${doc.title || '—'}").`)
  }
  if (!doc.issuedAt) doc.warnings.push('"Issued on" line not found.')
  if (!doc.validFromDate) doc.warnings.push('"Valid for" line not found; day dates could not be derived.')

  parseSummaries(allLines, doc)
  if (!doc.summary24h) doc.warnings.push('24 hour forecast summary not found.')

  parseTables(pages, doc)
  if (!doc.areas.length) doc.warnings.push('No "Summary Hazards" tables found.')
  for (let a = 0; a < doc.areas.length; a++) {
    const n = doc.areas[a].days.length
    if (n !== 7) doc.warnings.push(`${doc.areas[a].name}: expected 7 day rows, found ${n}.`)
  }
  return doc
}

/** Convenience for callers that already have the bytes: extract + parse. */
export async function parseForecastPdf(data: ArrayBuffer | Uint8Array): Promise<ForecastDocument> {
  const { extractPageModels } = await import('./pageModel')
  const pages = await extractPageModels(data)
  return parseForecastPages(pages)
}

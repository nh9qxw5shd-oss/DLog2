'use client'

import {
  LogState, Incident, CATEGORY_CONFIG, ShiftSlot, HazardLevel, DayWeather,
  deriveUpcomingDays, deriveWeatherLevel,
  SteamFireRiskLevel, AdhesionLevel, ADHESION_LEVEL_OPTIONS,
} from './types'
import type { ChartImages } from './chartRenderer'

export type { ChartImages }

type RGB = [number, number, number]

const C: Record<string, RGB> = {
  orange:   [224,  82,   6],
  navy:     [  0,  31,  69],
  blue:     [  0,  51, 102],
  steel:    [ 74, 111, 165],
  red:      [192,  57,  43],
  amber:    [243, 156,  18],
  green:    [ 39, 174,  96],
  white:    [255, 255, 255],
  offWhite: [248, 249, 252],
  lightGray:[220, 225, 232],
  midGray:  [160, 175, 195],
  darkGray: [ 44,  62,  80],
  black:    [ 22,  28,  36],
  pageBg:   [248, 249, 252],
}

const HAZARD_BG: Record<HazardLevel, RGB> = {
  GREEN:   [ 39, 174,  96],
  AWARE:   [241, 196,  15],
  ADVERSE: [230, 126,  34],
  EXTREME: [192,  57,  43],
}
// Text colour on each hazard background
const HAZARD_FG: Record<HazardLevel, RGB> = {
  GREEN:   [  0,  31,  69],
  AWARE:   [  0,  31,  69],
  ADVERSE: [  0,  31,  69],
  EXTREME: [255, 255, 255],
}

const SEV_COLOR: Record<string, RGB> = {
  CRITICAL: C.red,
  HIGH:     C.orange,
  MEDIUM:   C.amber,
  LOW:      C.steel,
  INFO:     C.midGray,
}

// ─── SVG → PNG loader ─────────────────────────────────────────────────────────

async function loadSvgAsImage(url: string): Promise<{ dataUrl: string; aspect: number } | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.warn(`[insignia] fetch failed: ${resp.status} ${url}`)
      return null
    }
    const svgText = await resp.text()

    const svgEl = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement
    let svgW = parseFloat(svgEl.getAttribute('width') ?? '0')
    let svgH = parseFloat(svgEl.getAttribute('height') ?? '0')
    if (!svgW || !svgH) {
      const vb = svgEl.getAttribute('viewBox')?.split(/[\s,]+/)
      if (vb && vb.length >= 4) { svgW = parseFloat(vb[2]); svgH = parseFloat(vb[3]) }
    }
    // Fall back to a square if dimensions are still unknown
    if (!svgW || !svgH || isNaN(svgW) || isNaN(svgH)) { svgW = 100; svgH = 100 }
    const aspect = svgW / svgH

    const scale = 4
    const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))

    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const cw = Math.round(svgW * scale)
        const ch = Math.round(svgH * scale)
        const canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        try {
          canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch)
          URL.revokeObjectURL(blobUrl)
          resolve({ dataUrl: canvas.toDataURL('image/png'), aspect })
        } catch (e) {
          console.warn('[insignia] canvas export failed (tainted?)', e)
          URL.revokeObjectURL(blobUrl)
          resolve(null)
        }
      }
      img.onerror = (e) => {
        console.warn('[insignia] image load failed', e)
        URL.revokeObjectURL(blobUrl)
        resolve(null)
      }
      img.src = blobUrl
    })
  } catch (e) {
    console.warn('[insignia] unexpected error', e)
    return null
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generatePDF(log: LogState, chartImages?: ChartImages): Promise<void> {
  const { jsPDF }   = await import('jspdf')
  const autoTable   = (await import('jspdf-autotable')).default
  const insignia    = await loadSvgAsImage('/route-insignia.svg')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210, H = 297, M = 14
  let y = 0

  // ── Helpers ──────────────────────────────────────────────────────────────

  const sf  = (style: 'normal'|'bold'|'italic' = 'normal', size = 10) => {
    doc.setFont('helvetica', style); doc.setFontSize(size)
  }
  const stc = (rgb: RGB) => doc.setTextColor(...rgb)
  const sfc = (rgb: RGB) => doc.setFillColor(...rgb)
  const sdc = (rgb: RGB) => doc.setDrawColor(...rgb)
  const tx  = (s: string, x: number, yy: number, opts?: any) => doc.text(s, x, yy, opts)
  const rc  = (x: number, yy: number, w: number, h: number, style: 'F'|'S'|'FD' = 'F') => doc.rect(x, yy, w, h, style)
  const ln  = (x1: number, y1: number, x2: number, y2: number) => doc.line(x1, y1, x2, y2)

  // Track lastY from autoTable — jsPDF-autotable sets doc.lastAutoTable
  const getAutoY = () => (doc as any).lastAutoTable?.finalY ?? y

  const newPage = () => {
    doc.addPage()
    drawCompactHeader()
    y = 22
  }

  const checkPage = (need: number) => { if (y + need > H - 18) newPage() }

  // ── Cover header (page 1) ─────────────────────────────────────────────────

  const drawCoverHeader = (): number => {
    sfc(C.navy); rc(0, 0, W, 52)
    sfc(C.orange); rc(0, 52, W, 4)
    // Classification bar
    sfc([160, 45, 25]); rc(0, 56, W, 7)
    sf('bold', 7); stc(C.white)
    tx('OFFICIAL – SENSITIVE  |  NOT FOR GENERAL DISTRIBUTION', W/2, 61, { align: 'center' })
    // Logo wordmark
    sf('bold', 20); stc(C.white); tx('NetworkRail', M, 19)
    sf('normal', 8); stc(C.steel); tx('EAST MIDLANDS CONTROL CENTRE', M, 27)
    // Report title
    sf('bold', 24); stc(C.orange); tx('DAILY', M, 42)
    sf('normal', 24); stc(C.white); tx(' OPERATIONS REPORT', M + 28, 42)
    // Date top-right
    const dateStr = log.date ? formatDisplayDate(log.date) : ''
    sf('bold', 9); stc(C.orange); tx(dateStr, W - M, 19, { align: 'right' })
    sf('normal', 7); stc(C.midGray); tx(log.period || '', W - M, 26, { align: 'right' })
    // Route insignia — centred horizontally, vertically centred in the 52mm navy band
    if (insignia) {
      const imgH = 22
      const imgW = imgH * insignia.aspect
      doc.addImage(insignia.dataUrl, 'PNG', W / 2 - imgW / 2, 5, imgW, imgH)
    }
    return 70
  }

  const drawCompactHeader = () => {
    sfc(C.navy); rc(0, 0, W, 14)
    sfc(C.orange); rc(0, 14, W, 2)
    sf('bold', 8); stc(C.white); tx('EMCC DAILY OPERATIONS REPORT', M, 9)
    sf('normal', 7); stc(C.offWhite)
    tx(log.date ? formatDisplayDate(log.date) : '', W - M, 9, { align: 'right' })
    sf('bold', 6); stc([180, 50, 30]); tx('OFFICIAL – SENSITIVE', W/2, 9, { align: 'center' })
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  const drawFooter = (p: number, total: number) => {
    sfc(C.navy); rc(0, H - 12, W, 12)
    sf('normal', 6.5); stc(C.midGray)
    tx('Network Rail Infrastructure Ltd  |  East Midlands Control Centre', M, H - 5)
    tx(`Page ${p} of ${total}`, W/2, H - 5, { align: 'center' })
    tx(log.createdBy ? `Compiled: ${log.createdBy}` : 'OFFICIAL – SENSITIVE', W - M, H - 5, { align: 'right' })
  }

  // ── Section heading ───────────────────────────────────────────────────────

  const sectionHead = (title: string, sub?: string) => {
    checkPage(16)
    sfc(C.blue); rc(M, y, W - M*2, 9)
    sfc(C.orange); rc(M, y, 3, 9)
    sf('bold', 9); stc(C.white); tx(title, M + 6, y + 6.2)
    if (sub) { sf('normal', 7); stc(C.offWhite); tx(sub, W - M, y + 6.2, { align: 'right' }) }
    y += 14
  }

  // ── 5 Day Look Ahead table ────────────────────────────────────────────────

  const drawFiveDayLookAhead = () => {
    const fw     = log.fiveDayWeather
    const notes  = log.lookAheadNotes
    const tableW = W - M * 2
    const labelW = 50
    const dayW   = (tableW - labelW) / 5

    const days   = deriveUpcomingDays()
    const emDays = fw.eastMidlands
    const lnDays = fw.londonNorth

    const cell = (
      cx: number, cy: number, w: number, h: number,
      bg: RGB, border: RGB = C.lightGray
    ) => {
      sfc(bg); rc(cx, cy, w, h)
      sdc(border); doc.setLineWidth(0.2); rc(cx, cy, w, h, 'S')
    }

    // ── Row 1: header ───────────────────────────────────────────────────────
    const HDR_H = 20
    cell(M, y, labelW, HDR_H, [210, 215, 222])
    sf('bold', 6.5); stc(C.navy)
    tx('East Midlands Route', M + 3, y + 7)
    tx('5 Day Look Ahead', M + 3, y + 13)

    days.forEach((day, i) => {
      const cx = M + labelW + i * dayW
      cell(cx, y, dayW, HDR_H, [225, 230, 237])
      sf('bold', 8); stc(C.navy)
      const label = day.length > 9 ? day.slice(0, 3) : day
      tx(label, cx + dayW / 2, y + 13, { align: 'center' })
    })
    y += HDR_H

    // ── Per-day free-text row (Risks / TOC / FOC) ─────────────────────────
    const textRow = (label: string, values: string[], minH = 12, labelBg: RGB = [232, 236, 241]) => {
      const LINE_H = 3.5  // approx mm per line at 8pt bold

      sf('bold', 8)
      const splitValues = Array.from({ length: 5 }, (_, i) => {
        const val = (values[i] ?? '').trim() || 'Nil'
        return doc.splitTextToSize(val, dayW - 3)
      })
      const maxLines = Math.max(...splitValues.map(l => l.length))
      const rowH = Math.max(minH, maxLines * LINE_H + 5)

      cell(M, y, labelW, rowH, labelBg)
      sf('bold', 7); stc(C.navy)
      const llines = doc.splitTextToSize(label, labelW - 6)
      const labelLineH = 3.0
      const labelStartY = y + rowH / 2 - ((llines.length - 1) * labelLineH) / 2 + 1.5
      tx(llines, M + 3, labelStartY)

      sf('bold', 8); stc(C.darkGray)
      splitValues.forEach((lines, i) => {
        const cx = M + labelW + i * dayW
        cell(cx, y, dayW, rowH, C.offWhite)
        const startY = y + rowH / 2 - ((lines.length - 1) * LINE_H) / 2 + 1.5
        tx(lines, cx + dayW / 2, startY, { align: 'center' })
      })
      y += rowH
    }

    // ── Weather row: per-cell derived level + risk-name triggers ──────────
    const weatherRow = (label: string, weatherDays: DayWeather[], rowH = 26) => {
      cell(M, y, labelW, rowH, [232, 236, 241])
      const llines = doc.splitTextToSize(label, labelW - 6)
      sf('bold', 7); stc(C.navy); tx(llines.slice(0, 3), M + 3, y + 6)

      weatherDays.forEach((wd, i) => {
        const cx    = M + labelW + i * dayW
        const level = deriveWeatherLevel(wd)
        const bg    = HAZARD_BG[level]
        const fg    = HAZARD_FG[level]
        cell(cx, y, dayW, rowH, bg)

        if (level === 'GREEN') { return }

        sf('bold', 8); stc(fg)
        tx(level, cx + dayW / 2, y + 9, { align: 'center' })

        const triggers = Object.keys(wd.risks)
        if (triggers.length) {
          sf('normal', 5.5); stc(fg)
          const tlines = doc.splitTextToSize(triggers.join(', '), dayW - 3)
          tx(tlines.slice(0, 3), cx + dayW / 2, y + 15, { align: 'center' })
        }
      })
      y += rowH
    }

    textRow('Risks', notes.risks)
    weatherRow('Weather\nEast Midlands', emDays)
    weatherRow('Weather\nLondon North', lnDays)
    textRow('TOC Operations\n& Depot start up', notes.toc, 14)
    textRow('FOC Operations', notes.foc)

    // ── Summer: Steam Fire Risk row ──────────────────────────────────────────
    if (log.seasonMode === 'Summer') {
      const STEAM_BG: Record<SteamFireRiskLevel, RGB> = {
        GREEN: [ 39, 174,  96],
        AMBER: [245, 158,  11],
        RED:   [231,  76,  60],
        BLACK: [ 17,  17,  17],
      }
      const STEAM_FG: Record<SteamFireRiskLevel, RGB> = {
        GREEN: [255, 255, 255],
        AMBER: [  0,  31,  69],
        RED:   [255, 255, 255],
        BLACK: [255, 255, 255],
      }
      const STEAM_LABELS: Record<SteamFireRiskLevel, string> = {
        GREEN: 'Green', AMBER: 'Amber', RED: 'Red', BLACK: 'Black',
      }
      const steamH = 14
      cell(M, y, labelW, steamH, [232, 236, 241])
      sf('bold', 7); stc(C.navy)
      tx('Steam Fire Risk', M + 3, y + 9)
      const steamRisk = log.steamFireRisk ?? Array(5).fill('GREEN')
      steamRisk.forEach((level, i) => {
        const cx = M + labelW + i * dayW
        cell(cx, y, dayW, steamH, STEAM_BG[level as SteamFireRiskLevel])
        sf('bold', 8); stc(STEAM_FG[level as SteamFireRiskLevel])
        tx(STEAM_LABELS[level as SteamFireRiskLevel], cx + dayW / 2, y + 9, { align: 'center' })
      })
      y += steamH
    }

    // ── Autumn: Adhesion rows ────────────────────────────────────────────────
    if (log.seasonMode === 'Autumn') {
      const ADHES_BG: Record<AdhesionLevel, RGB> = {
        GOOD_1_2:        [ 26,  86,  49],
        DAMP_3:          [ 39, 174,  96],
        MODERATE_4_5:    [241, 196,  15],
        POOR_5_8:        [231,  76,  60],
        VERY_POOR_9_10:  [ 17,  17,  17],
      }
      const ADHES_FG: Record<AdhesionLevel, RGB> = {
        GOOD_1_2:        [255, 255, 255],
        DAMP_3:          [255, 255, 255],
        MODERATE_4_5:    [  0,  31,  69],
        POOR_5_8:        [255, 255, 255],
        VERY_POOR_9_10:  [255, 255, 255],
      }
      const ADHES_LABEL: Record<AdhesionLevel, string> = Object.fromEntries(
        ADHESION_LEVEL_OPTIONS.map(o => [o.value, o.label])
      ) as Record<AdhesionLevel, string>

      const adhesH = 16
      const drawAdhesionRow = (label: string, levels: AdhesionLevel[]) => {
        cell(M, y, labelW, adhesH, [232, 236, 241])
        sf('bold', 7); stc(C.navy)
        const llines = doc.splitTextToSize(label, labelW - 6)
        tx(llines.slice(0, 2), M + 3, y + 6)
        levels.forEach((level, i) => {
          const cx = M + labelW + i * dayW
          cell(cx, y, dayW, adhesH, ADHES_BG[level])
          const lines = doc.splitTextToSize(ADHES_LABEL[level], dayW - 3)
          sf('bold', 7); stc(ADHES_FG[level])
          tx(lines.slice(0, 2), cx + dayW / 2, y + adhesH / 2 + 1.5, { align: 'center' })
        })
        y += adhesH
      }

      const eastMids = (log.eastMidsAdhesion ?? Array(5).fill('GOOD_1_2')) as AdhesionLevel[]
      const lincoln  = (log.lincolnAdhesion  ?? Array(5).fill('GOOD_1_2')) as AdhesionLevel[]
      drawAdhesionRow('East Mids Adhesion', eastMids)
      drawAdhesionRow('Lincoln Adhesion',   lincoln)
    }

    y += 6
  }

  // ── Roster grid ───────────────────────────────────────────────────────────

  const drawRosterHalf = (slots: ShiftSlot[], label: string, xOff: number): number => {
    const colW = (W - M*2) / 2 - 2
    const sx = M + xOff
    // Shift label
    sfc(C.steel); rc(sx, y, colW, 8)
    sf('bold', 9); stc(C.white); tx(label, sx + colW/2, y + 5.5, { align: 'center' })
    let ry = y + 9
    // Column headers
    sfc(C.lightGray); rc(sx, ry, colW, 7)
    sf('bold', 8); stc(C.darkGray)
    tx('ROLE', sx + 2, ry + 4.9)
    tx('NAME', sx + colW * 0.36, ry + 4.9)
    tx('PERIOD', sx + colW * 0.78, ry + 4.9)
    ry += 8
    slots.forEach((slot, i) => {
      sfc(i % 2 === 0 ? C.white : C.offWhite); rc(sx, ry, colW, 8)
      sf('bold', 8); stc(C.steel); tx(slot.role, sx + 2, ry + 5.3)
      sf('normal', 8); stc(slot.name ? C.black : C.midGray)
      tx(slot.name || '—', sx + colW * 0.36, ry + 5.3)
      sf('normal', 7.5); stc(C.darkGray)
      tx(`${slot.start}–${slot.end}`, sx + colW * 0.78, ry + 5.3)
      ry += 8.5
    })
    return ry
  }

  // ── Safety infographic stats bar ──────────────────────────────────────────

  const drawSafetyStats = (incidents: Incident[]) => {
    const stats = [
      { label: 'Person Struck', count: incidents.filter(i => ['FATALITY','PERSON_STRUCK'].includes(i.category)).length, urgent: true  },
      { label: 'SPADs',         count: incidents.filter(i => i.category === 'SPAD').length,              urgent: true  },
      { label: 'TPWS',          count: incidents.filter(i => i.category === 'TPWS').length,              urgent: false },
      { label: 'Near Misses',   count: incidents.filter(i => i.category === 'NEAR_MISS').length,        urgent: false },
      { label: 'Bridge Strikes',count: incidents.filter(i => i.category === 'BRIDGE_STRIKE').length,    urgent: true  },
      { label: 'Fires',         count: incidents.filter(i => i.category === 'FIRE').length,              urgent: true  },
      { label: 'Crime/Trespass',count: incidents.filter(i => i.category === 'CRIME').length,            urgent: false },
      { label: 'Irr. Working',  count: incidents.filter(i => i.category === 'IRREGULAR_WORKING').length,urgent: false },
    ]
    const boxW = (W - M*2) / stats.length
    stats.forEach((s, i) => {
      const bx = M + i * boxW
      const hasHit = s.count > 0
      const bg: RGB = hasHit ? (s.urgent ? C.red : C.navy) : C.offWhite
      sfc(bg); rc(bx, y, boxW - 1, 20)
      sf('bold', 16); stc(hasHit ? C.white : C.lightGray)
      tx(String(s.count), bx + (boxW-1)/2, y + 13, { align: 'center' })
      sf('normal', 5.5); stc(hasHit ? C.white : C.darkGray)
      tx(s.label.toUpperCase(), bx + (boxW-1)/2, y + 18.5, { align: 'center' })
    })
    y += 24
  }

  // ── Disruption summary bar ────────────────────────────────────────────────

  const drawDisruptionSummary = (incidents: Incident[]) => {
    const totalMins = incidents.reduce((s, i) => s + (i.minutesDelay || 0), 0)
    const totalCan  = incidents.reduce((s, i) => s + (i.cancelled    || 0), 0)
    const totalPCan = incidents.reduce((s, i) => s + (i.partCancelled|| 0), 0)
    const topInc    = [...incidents].sort((a,b) => (b.minutesDelay||0) - (a.minutesDelay||0))[0]

    const boxes = [
      { label: 'Total Delay',      value: `${totalMins.toLocaleString()} min`, color: C.amber  },
      { label: 'Cancellations',    value: String(totalCan),                    color: C.red    },
      { label: 'Part Cancelled',   value: String(totalPCan),                   color: C.orange },
      { label: 'Worst Incident',   value: topInc ? `${topInc.minutesDelay?.toLocaleString()} min` : '—', color: C.steel },
    ]
    const bw = (W - M*2) / boxes.length
    boxes.forEach((b, i) => {
      const bx = M + i * bw
      sfc(C.offWhite); rc(bx, y, bw - 2, 18)
      sfc(b.color); rc(bx, y, bw - 2, 2)
      sf('bold', 11); stc(b.color)
      tx(b.value, bx + (bw-2)/2, y + 12, { align: 'center' })
      sf('normal', 6); stc(C.midGray)
      tx(b.label.toUpperCase(), bx + (bw-2)/2, y + 17, { align: 'center' })
    })
    y += 22
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD DOCUMENT
  // ─────────────────────────────────────────────────────────────────────────

  y = drawCoverHeader()

  // ── 0. Roster ─────────────────────────────────────────────────────────────
  sectionHead('SHIFT ROSTER', log.period)
  const rosterStartY = y
  const dayEnd   = drawRosterHalf(log.roster.dayShift,   'DAY SHIFT',   0)
  y = rosterStartY
  const nightEnd = drawRosterHalf(log.roster.nightShift, 'NIGHT SHIFT', (W - M*2)/2 + 2)
  y = Math.max(dayEnd, nightEnd) + 8

  // ── 1. 5 Day Look Ahead (page 2) ──────────────────────────────────────────
  newPage()
  sectionHead('5 DAY LOOK AHEAD', log.date ? formatDisplayDate(log.date) : undefined)
  drawFiveDayLookAhead()

  // ── 2. Safety infographic (page 3+) ───────────────────────────────────────
  newPage()
  sectionHead('SAFETY & INCIDENT SUMMARY', `${log.incidents.length} incidents · ${log.incidents.filter(i => i.isHighlight).length} highlighted`)
  drawSafetyStats(log.incidents)

  // ── 3. Disruption summary ─────────────────────────────────────────────────
  checkPage(28)
  sectionHead('DISRUPTION SUMMARY')
  drawDisruptionSummary(log.incidents)

  // ── 4. Highlighted incidents (cards) ──────────────────────────────────────
  const highlights = log.incidents.filter(i => i.isHighlight)
  if (highlights.length > 0) {
    checkPage(20)
    sectionHead('SIGNIFICANT INCIDENTS', `${highlights.length} flagged`)

    for (const inc of highlights) {
      checkPage(34)
      const cat      = CATEGORY_CONFIG[inc.category]
      const sevColor = SEV_COLOR[inc.severity] || C.midGray
      const cardH    = 30

      // Card background
      sfc(C.offWhite); rc(M, y, W - M*2, cardH)
      // Severity left bar
      sfc(sevColor); rc(M, y, 3, cardH)
      // Category badge
      sfc(C.navy); rc(W - M - 22, y + 2, 20, 6.5)
      sf('bold', 6); stc(C.orange)
      tx(cat.shortLabel, W - M - 12, y + 6.8, { align: 'center' })

      // CCIL ref + time
      sf('bold', 7.3); stc(C.darkGray)
      tx(inc.ccil ? `CCIL ${inc.ccil}` : '', M + 5, y + 6.5)
      sf('normal', 7.2); stc(C.darkGray)
      const locStr = [inc.incidentStart, inc.location].filter(Boolean).join('  ·  ')
      tx(locStr, M + 26, y + 6.5)

      // Title
      sf('bold', 10.5); stc(C.blue)
      const titleLines = doc.splitTextToSize(inc.title, W - M*2 - 32)
      tx(titleLines.slice(0, 2), M + 5, y + 14.5)

      // Description snippet
      if (inc.description) {
        const desc = inc.description.length > 170 ? inc.description.slice(0, 170) + '…' : inc.description
        sf('normal', 7.4); stc(C.darkGray)
        const dl = doc.splitTextToSize(desc, W - M*2 - 10)
        tx(dl.slice(0, 2), M + 5, y + 22.5)
      }

      // Disruption figures right side
      if ((inc.minutesDelay || 0) > 0 || (inc.cancelled || 0) > 0) {
        sf('bold', 10); stc(sevColor)
        if (inc.minutesDelay) tx(`${inc.minutesDelay.toLocaleString()} min`, W - M - 4, y + 13.5, { align: 'right' })
        sf('normal', 7.2); stc(C.darkGray)
        if (inc.cancelled)     tx(`Can: ${inc.cancelled}`, W - M - 4, y + 20, { align: 'right' })
        if (inc.partCancelled) tx(`Part-can: ${inc.partCancelled}`, W - M - 4, y + 25, { align: 'right' })
      }

      y += cardH + 2.5
    }
  }

  // ── 5. Incident tables by category ────────────────────────────────────────

  const tableSections: Array<{ label: string; filter: (i: Incident) => boolean }> = [
    { label: 'SIGNALS PASSED AT DANGER (SPADs)',        filter: i => i.category === 'SPAD'              },
    { label: 'TPWS ACTIVATIONS',                        filter: i => i.category === 'TPWS'              },
    { label: 'BRIDGE STRIKES',                          filter: i => i.category === 'BRIDGE_STRIKE'     },
    { label: 'NEAR MISSES',                             filter: i => i.category === 'NEAR_MISS'         },
    { label: 'IRREGULAR WORKING',                       filter: i => i.category === 'IRREGULAR_WORKING' },
    { label: 'LEVEL CROSSING INCIDENTS',                filter: i => i.category === 'LEVEL_CROSSING'    },
    { label: 'FIRES & LINESIDE INCIDENTS',              filter: i => i.category === 'FIRE'              },
    { label: 'RAILWAY CRIME & TRESPASS',                filter: i => i.category === 'CRIME'             },
    { label: 'HABD / WILD ACTIVATIONS',                 filter: i => i.category === 'HABD_WILD'         },
    { label: 'PASSENGER & PUBLIC INJURIES / ASSAULTS',  filter: i => i.category === 'PASSENGER_INJURY'  },
    { label: 'PERSON STRUCK BY TRAIN / FATALITIES',     filter: i => ['FATALITY','PERSON_STRUCK'].includes(i.category) },
    { label: 'DERAILMENTS & COLLISIONS',                filter: i => i.category === 'DERAILMENT'        },
    { label: 'INFRASTRUCTURE FAILURES',                 filter: i => i.category === 'INFRASTRUCTURE'    },
    { label: 'OHL / TRACTION CURRENT FAILURES',         filter: i => i.category === 'TRACTION_FAILURE'  },
    { label: 'TRAIN FAULTS & FAILURES',                 filter: i => i.category === 'TRAIN_FAULT'       },
    { label: 'POSSESSION ISSUES',                       filter: i => i.category === 'POSSESSION'        },
  ]

  for (const sec of tableSections) {
    const items = log.incidents.filter(sec.filter)
    if (items.length === 0) continue

    checkPage(22)
    sectionHead(sec.label, `${items.length} incident${items.length !== 1 ? 's' : ''}`)

    const tableBody = items.map(i => [
      i.ccil || '—',
      i.location || '—',
      i.incidentStart || '—',
      i.title.length > 65 ? i.title.slice(0, 65) + '…' : i.title,
      (i.minutesDelay || 0) > 0 ? i.minutesDelay!.toLocaleString() : '—',
      (i.cancelled    || 0) > 0 ? String(i.cancelled) : '—',
      i.severity,
    ])

    autoTable(doc, {
      startY: y,
      head:   [['CCIL', 'Location', 'Time', 'Incident', 'Delay (min)', 'Cancelled', 'Sev']],
      body:   tableBody,
      margin: { left: M, right: M },
      theme:  'grid',
      headStyles:         { fillColor: C.blue, textColor: C.white, fontSize: 7, fontStyle: 'bold', cellPadding: 2.5 },
      bodyStyles:         { fontSize: 6.5, textColor: C.darkGray, cellPadding: 2 },
      alternateRowStyles: { fillColor: C.offWhite },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 30 },
        2: { cellWidth: 14 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' as const },
        5: { cellWidth: 18, halign: 'right' as const },
        6: { cellWidth: 13 },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 6) {
          data.cell.styles.textColor = SEV_COLOR[data.cell.raw as string] || C.midGray
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })

    y = getAutoY() + 8
  }

  // ── 6. Disruption impact ranked table ─────────────────────────────────────

  const byDelay = [...log.incidents]
    .filter(i => (i.minutesDelay || 0) > 0)
    .sort((a, b) => (b.minutesDelay || 0) - (a.minutesDelay || 0))
    .slice(0, 20)

  if (byDelay.length > 0) {
    checkPage(22)
    sectionHead('DISRUPTION IMPACT — TOP INCIDENTS BY DELAY')

    const totalMins = byDelay.reduce((s, i) => s + (i.minutesDelay || 0), 0)
    const totalCan  = byDelay.reduce((s, i) => s + (i.cancelled    || 0), 0)

    autoTable(doc, {
      startY: y,
      head: [['#', 'CCIL', 'Category', 'Location / Incident', 'Delay (min)', 'Cancelled', 'Part Can']],
      body: byDelay.map((i, idx) => [
        `#${idx + 1}`,
        i.ccil || '—',
        CATEGORY_CONFIG[i.category].shortLabel,
        `${i.location}  —  ${i.title.slice(0, 48)}`,
        i.minutesDelay?.toLocaleString() || '—',
        i.cancelled    || '—',
        i.partCancelled|| '—',
      ]),
      foot: [['', '', '', 'TOTAL', totalMins.toLocaleString(), totalCan, '']],
      margin: { left: M, right: M },
      theme:  'grid',
      headStyles: { fillColor: C.blue,  textColor: C.white,  fontSize: 7,   fontStyle: 'bold' },
      footStyles: { fillColor: C.navy,  textColor: C.orange, fontSize: 7.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 6.5, textColor: C.darkGray, cellPadding: 2 },
      alternateRowStyles: { fillColor: C.offWhite },
      columnStyles: {
        0: { cellWidth: 9  },
        1: { cellWidth: 18 },
        2: { cellWidth: 16 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18, halign: 'right' as const },
        5: { cellWidth: 18, halign: 'right' as const },
        6: { cellWidth: 15, halign: 'right' as const },
      },
    })

    y = getAutoY() + 8
  }

  // ── 7. Historical Trends (embedded chart images from Supabase) ───────────
  if (chartImages) {
    newPage()
    sectionHead(
      'HISTORICAL TRENDS — EMCC INCIDENT DATA',
      `${chartImages.reportCount} report${chartImages.reportCount !== 1 ? 's' : ''} in database`
    )

    const chartW = W - M * 2

    // Chart 1: dual-line trend — canvas 1400×420
    const trendH = chartW * (420 / 1400)
    doc.addImage(chartImages.delayTrend, 'PNG', M, y, chartW, trendH)
    y += trendH + 6

    // Chart 2: category horizontal bar — canvas 1400×460
    checkPage(68)
    const catH = chartW * (460 / 1400)
    doc.addImage(chartImages.categoryBreakdown, 'PNG', M, y, chartW, catH)
    y += catH + 6

    // Chart 3: top locations bar — canvas 1400×460
    checkPage(68)
    const locH = chartW * (460 / 1400)
    doc.addImage(chartImages.topLocations, 'PNG', M, y, chartW, locH)
    y += locH + 8

    // ── Page 2: Safety & Operational Analysis ─────────────────────────────
    newPage()
    sectionHead('SAFETY & OPERATIONAL ANALYSIS', 'Timing patterns · Efficiency · Safety-critical evolution')

    // Chart 4: time of day — canvas 1400×400
    const timeH = chartW * (400 / 1400)
    doc.addImage(chartImages.timeOfDay, 'PNG', M, y, chartW, timeH)
    y += timeH + 6

    // Chart 5: average delay per incident — canvas 1400×400
    checkPage(timeH + 10)
    doc.addImage(chartImages.avgDelayTrend, 'PNG', M, y, chartW, timeH)
    y += timeH + 6

    // Chart 6: safety-critical stacked bar — canvas 1400×460
    checkPage(catH + 10)
    doc.addImage(chartImages.safetyCategoryTrend, 'PNG', M, y, chartW, catH)
    y += catH + 8
  }

  // ── 8. Appendix: compact detail + chronology ──────────────────────────────
  if (log.incidents.length > 0) {
    newPage()
    sectionHead('APPENDIX — CCIL INCIDENT DETAIL LOG', 'Compact detail table + chronological event timeline')

    sf('normal', 7); stc(C.black)
    tx('Core incident details', M, y)
    y += 2

    const appendixIncidents = [...log.incidents].sort((a, b) => {
      const ta = (a.incidentStart || '99:99')
      const tb = (b.incidentStart || '99:99')
      return ta.localeCompare(tb)
    })

    autoTable(doc, {
      startY: y + 3,
      head: [['CCIL', 'Start', 'Category', 'Sev', 'Location', 'Incident', 'Delay', 'Can', 'PtCan']],
      body: appendixIncidents.map((inc) => [
        inc.ccil || '—',
        inc.incidentStart || '—',
        CATEGORY_CONFIG[inc.category].shortLabel,
        inc.severity,
        inc.location || '—',
        inc.title.length > 70 ? `${inc.title.slice(0, 70)}…` : inc.title,
        (inc.minutesDelay || 0) > 0 ? String(inc.minutesDelay) : '0',
        String(inc.cancelled || 0),
        String(inc.partCancelled || 0),
      ]),
      margin: { left: M, right: M, top: 22 },
      theme: 'grid',
      headStyles: { fillColor: C.blue, textColor: C.white, fontSize: 7, fontStyle: 'bold', cellPadding: 1.8 },
      bodyStyles: { textColor: C.black, fontSize: 6.4, cellPadding: 1.6, lineColor: C.lightGray, lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [245, 247, 250] as RGB },
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 12 },
        2: { cellWidth: 15 },
        3: { cellWidth: 10 },
        4: { cellWidth: 28 },
        5: { cellWidth: 'auto' },
        6: { cellWidth: 12, halign: 'right' as const },
        7: { cellWidth: 10, halign: 'right' as const },
        8: { cellWidth: 12, halign: 'right' as const },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 3) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = SEV_COLOR[data.cell.raw as string] || C.black
        }
      },
      didDrawPage: () => { drawCompactHeader() },
    })
    y = getAutoY() + 8

    checkPage(18)
    sf('normal', 7); stc(C.black)
    tx('Chronological event log', M, y)
    y += 2

    const eventRows = appendixIncidents.flatMap((inc) => {
      if (!inc.events || inc.events.length === 0) {
        return [[
          '',
          inc.incidentStart || '—',
          inc.ccil || '—',
          'NR',
          inc.title,
        ]]
      }

      return [...inc.events]
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
        .map((ev) => [
          ev.date || '',
          ev.time || '',
          inc.ccil || '—',
          ev.company || '—',
          ev.description || inc.title,
        ])
    })
      .sort((a, b) => `${a[0]} ${a[1]}`.localeCompare(`${b[0]} ${b[1]}`))

    autoTable(doc, {
      startY: y + 3,
      head: [['Date', 'Time', 'CCIL', 'Co', 'Event / Entry']],
      body: eventRows.map((r) => [r[0], r[1], r[2], r[3], String(r[4]).slice(0, 220)]),
      margin: { left: M, right: M, top: 22 },
      theme: 'grid',
      headStyles: { fillColor: C.blue, textColor: C.white, fontSize: 7, fontStyle: 'bold', cellPadding: 1.8 },
      bodyStyles: { textColor: C.black, fontSize: 6.2, cellPadding: 1.5, lineColor: C.lightGray, lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [247, 248, 251] as RGB },
      columnStyles: {
        0: { cellWidth: 16 },
        1: { cellWidth: 12 },
        2: { cellWidth: 16 },
        3: { cellWidth: 12 },
        4: { cellWidth: 'auto' },
      },
      didDrawPage: () => { drawCompactHeader() },
    })
    y = getAutoY() + 6
  } else if (log.rawLogText) {
    newPage()
    sectionHead('APPENDIX — FULL CCIL LOG (VERBATIM)', 'Unedited export text')

    sf('normal', 7); stc(C.black)
    const rawLines = log.rawLogText.split('\n').filter(line => line.trim())
    tx('No parsed incidents were available, so the raw CCIL export is shown below.', M, y)
    y += 6

    autoTable(doc, {
      startY: y,
      head: [['Raw CCIL export lines']],
      body: rawLines.map((line) => [line.replace(/\r/g, '').slice(0, 300)]),
      margin: { left: M, right: M, top: 22 },
      theme: 'grid',
      headStyles: { fillColor: C.blue, textColor: C.white, fontSize: 7, fontStyle: 'bold', cellPadding: 1.8 },
      bodyStyles: { textColor: C.black, fontSize: 6, cellPadding: 1.5, lineColor: C.lightGray, lineWidth: 0.1 },
      alternateRowStyles: { fillColor: [247, 248, 251] as RGB },
      columnStyles: { 0: { cellWidth: 'auto' } },
      didDrawPage: () => { drawCompactHeader() },
    })
    y = getAutoY() + 6
  }

  // ── Add footers to all pages ──────────────────────────────────────────────

  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    drawFooter(p, total)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  const dateStr = log.date ? log.date.replace(/-/g, '') : 'unknown'
  doc.save(`EMCC_Daily_Report_${dateStr}.pdf`)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatDisplayDate(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-')
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  try {
    const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd))
    return `${days[d.getDay()]} ${parseInt(dd)} ${months[parseInt(mm)]} ${yyyy}`
  } catch {
    return iso
  }
}

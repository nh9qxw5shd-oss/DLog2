'use client'

import {
  LogState, Incident, CATEGORY_CONFIG, ShiftSlot, HazardLevel, DayWeather,
  deriveUpcomingDays, deriveUpcomingDates, deriveWeatherLevel,
  normaliseLookAheadWeather, padTo7, LOOK_AHEAD_DAYS, FORECAST_AREAS,
  SteamFireRiskLevel, AdhesionLevel, ADHESION_LEVEL_OPTIONS,
} from './types'
import { describeIssue } from './weather/applyForecast'
import type { ChartImages } from './chartRenderer'
import type { CategorySettings } from './categorySettings'
import type { EsrSnapshotResponse, EsrRow, EsrFieldChange } from './esr/types'
import { describeChanges } from './esr/diff'
import type { OouRegister, OouItem, OouSection } from './outOfUse'
import { OOU_SECTION_SPECS, OOU_RAGS, OOU_RAG_SPECS, OOU_UNRATED, ragCounts, fmtSince, daysSince, fmtStamp as fmtOouStamp } from './outOfUse'

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

// ─── SVG → PNG loader ─────────────────────────────────────────────────────────────

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

    const scale = 2
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

// ─── Main export ────────────────────────────────────────────────────────────────

export async function generatePDF(
  log: LogState,
  chartImages?: ChartImages,
  categorySettings?: CategorySettings,
  esr?: EsrSnapshotResponse | null,
  options: { testMode?: boolean; outOfUse?: (OouRegister & { error?: string }) | null } = {},
): Promise<void> {
  const testMode    = !!options.testMode
  const outOfUse    = options.outOfUse ?? null
  const { jsPDF }   = await import('jspdf')
  const autoTable   = (await import('jspdf-autotable')).default
  const insignia    = await loadSvgAsImage('/route-insignia.svg')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const W = 210, H = 297, M = 14
  let y = 0

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  // ── Cover header (page 1) ───────────────────────────────────────────────────

  const drawCoverHeader = (): number => {
    sfc(C.navy); rc(0, 0, W, 52)
    sfc(C.orange); rc(0, 52, W, 4)
    // Classification bar — in Test Mode it becomes the TEST warning so a
    // trial build can never pass for a real log.
    if (testMode) {
      sfc(C.amber); rc(0, 56, W, 7)
      sf('bold', 7); stc(C.navy)
      tx('TEST MODE  |  NOTHING SAVED TO DATABASE  |  NOT A LIVE LOG — DO NOT DISTRIBUTE', W/2, 61, { align: 'center' })
    } else {
      sfc([160, 45, 25]); rc(0, 56, W, 7)
      sf('bold', 7); stc(C.white)
      tx('OFFICIAL – SENSITIVE  |  NOT FOR GENERAL DISTRIBUTION', W/2, 61, { align: 'center' })
    }
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
    if (testMode) { sf('bold', 6); stc(C.amber); tx('TEST MODE — NOT SAVED — NOT A LIVE LOG', W/2, 9, { align: 'center' }) }
    else { sf('bold', 6); stc([180, 50, 30]); tx('OFFICIAL – SENSITIVE', W/2, 9, { align: 'center' }) }
  }

  // Large translucent diagonal "TEST" across every page (drawn last, in the
  // footer pass, so it sits over the content without hiding it).
  const drawTestWatermark = () => {
    const anyDoc = doc as any
    const hasGState = typeof anyDoc.setGState === 'function' && typeof anyDoc.GState === 'function'
    if (hasGState) anyDoc.setGState(new anyDoc.GState({ opacity: 0.10 }))
    sf('bold', 110); stc(C.red)
    tx('TEST', W / 2, H / 2 + 20, { align: 'center', angle: 35 })
    if (hasGState) anyDoc.setGState(new anyDoc.GState({ opacity: 1 }))
  }

  // ── Footer ─────────────────────────────────────────────────────────────────

  const drawFooter = (p: number, total: number) => {
    sfc(C.navy); rc(0, H - 12, W, 12)
    sf('normal', 6.5); stc(C.midGray)
    tx('Network Rail Infrastructure Ltd  |  East Midlands Control Centre', M, H - 5)
    tx(`Page ${p} of ${total}`, W/2, H - 5, { align: 'center' })
    tx(log.createdBy ? `Compiled: ${log.createdBy}` : 'OFFICIAL – SENSITIVE', W - M, H - 5, { align: 'right' })
  }

  // ── Section heading ─────────────────────────────────────────────────────────

  const sectionHead = (title: string, sub?: string) => {
    checkPage(16)
    sfc(C.blue); rc(M, y, W - M*2, 9)
    sfc(C.orange); rc(M, y, 3, 9)
    sf('bold', 9); stc(C.white); tx(title, M + 6, y + 6.2)
    if (sub) { sf('normal', 7); stc(C.offWhite); tx(sub, W - M, y + 6.2, { align: 'right' }) }
    y += 14
  }

  // ── 7 Day Look Ahead table ────────────────────────────────────────────────

  const drawLookAhead = () => {
    const grid   = normaliseLookAheadWeather(log.lookAheadWeather)
    const notes  = {
      risks: padTo7(log.lookAheadNotes?.risks),
      toc:   padTo7(log.lookAheadNotes?.toc),
      foc:   padTo7(log.lookAheadNotes?.foc),
    }
    const tableW = W - M * 2
    const labelW = 38
    const dayW   = (tableW - labelW) / LOOK_AHEAD_DAYS
    const fc     = log.forecast ?? null

    const days   = deriveUpcomingDays()
    const dates  = deriveUpcomingDates()

    const cell = (
      cx: number, cy: number, w: number, h: number,
      bg: RGB, border: RGB = C.lightGray
    ) => {
      sfc(bg); rc(cx, cy, w, h)
      sdc(border); doc.setLineWidth(0.2); rc(cx, cy, w, h, 'S')
    }

    // ── Forecast provenance + narrative ──────────────────────────────────
    if (fc) {
      sf('normal', 7); stc(C.midGray)
      const prov = [fc.title, describeIssue(fc), fc.validFromDate ? `valid from ${fc.validFromDate}` : ''].filter(Boolean).join(' · ')
      tx(prov, M, y + 3)
      y += 6
      const para = (heading: string, text: string | null) => {
        if (!text) return
        sf('bold', 7.5); stc(C.navy); tx(heading, M, y + 3); y += 4.5
        sf('normal', 7.5); stc(C.darkGray)
        const lines = doc.splitTextToSize(text, tableW)
        tx(lines, M, y + 3)
        y += lines.length * 3.3 + 3
      }
      para('Forecast – 24 hours (weather and hazard summary)', fc.summary24h)
      para('Forecast – 2 to 7 days (weather and hazard summary)', fc.summary2to7)
      y += 1
    } else {
      sf('italic', 7); stc(C.midGray)
      tx('No Route 7 Day Forecast PDF was loaded for this log — weather cells were entered by hand.', M, y + 3)
      y += 6
    }

    // ── Row 1: header ─────────────────────────────────────────────────────
    const HDR_H = 16
    cell(M, y, labelW, HDR_H, [210, 215, 222])
    sf('bold', 6); stc(C.navy)
    tx('East Midlands Route', M + 2, y + 6)
    tx('7 Day Look Ahead', M + 2, y + 11)

    days.forEach((day, i) => {
      const cx = M + labelW + i * dayW
      cell(cx, y, dayW, HDR_H, [225, 230, 237])
      sf('bold', 7.5); stc(C.navy)
      tx(day.slice(0, 3), cx + dayW / 2, y + 7, { align: 'center' })
      sf('normal', 6); stc(C.steel)
      const d = dates[i] ? `${dates[i].slice(8, 10)}/${dates[i].slice(5, 7)}` : ''
      tx(d, cx + dayW / 2, y + 12, { align: 'center' })
    })
    y += HDR_H

    const labelBox = (label: string, rowH: number, bg: RGB = [232, 236, 241]) => {
      cell(M, y, labelW, rowH, bg)
      sf('bold', 6.5); stc(C.navy)
      const llines = doc.splitTextToSize(label, labelW - 4)
      const labelLineH = 2.8
      const labelStartY = y + rowH / 2 - ((llines.length - 1) * labelLineH) / 2 + 1.2
      tx(llines.slice(0, 3), M + 2, labelStartY)
    }

    // ── Per-day free-text row (Risks / TOC / FOC) ─────────────────────────────
    const textRow = (label: string, values: string[], minH = 11) => {
      const LINE_H = 3.0  // approx mm per line at 7pt bold

      sf('bold', 7)
      const splitValues = Array.from({ length: LOOK_AHEAD_DAYS }, (_, i) => {
        const val = (values[i] ?? '').trim() || 'Nil'
        return doc.splitTextToSize(val, dayW - 2)
      })
      const maxLines = Math.max(...splitValues.map(l => l.length))
      const rowH = Math.max(minH, maxLines * LINE_H + 4)

      labelBox(label, rowH)

      sf('bold', 7); stc(C.darkGray)
      splitValues.forEach((lines, i) => {
        const cx = M + labelW + i * dayW
        cell(cx, y, dayW, rowH, C.offWhite)
        const startY = y + rowH / 2 - ((lines.length - 1) * LINE_H) / 2 + 1.2
        tx(lines, cx + dayW / 2, startY, { align: 'center' })
      })
      y += rowH
    }

    // ── Weather row: derived level + risk-name triggers + temperatures ────
    const fmtT = (n: number | null | undefined) => (n === null || n === undefined || isNaN(n)) ? '–' : String(Math.round(n * 10) / 10)
    const weatherRow = (label: string, weatherDays: DayWeather[], rowH = 20) => {
      labelBox(label, rowH)

      weatherDays.forEach((wd, i) => {
        const cx    = M + labelW + i * dayW
        const level = deriveWeatherLevel(wd)
        const bg    = HAZARD_BG[level]
        const fg    = HAZARD_FG[level]
        cell(cx, y, dayW, rowH, bg)

        if (level !== 'GREEN') {
          sf('bold', 7); stc(fg)
          tx(level, cx + dayW / 2, y + 5, { align: 'center' })
          const triggers = Object.keys(wd.risks)
          if (triggers.length) {
            sf('normal', 5); stc(fg)
            const tlines = doc.splitTextToSize(triggers.join(', '), dayW - 2)
            tx(tlines.slice(0, 2), cx + dayW / 2, y + 9, { align: 'center' })
          }
        } else if (wd.temps) {
          sf('normal', 6); stc(fg)
          tx('Normal', cx + dayW / 2, y + 6, { align: 'center' })
        }
        if (wd.temps) {
          sf('bold', 6); stc(fg)
          tx(`${fmtT(wd.temps.max)}° / ${fmtT(wd.temps.minNight)}°`, cx + dayW / 2, y + rowH - 4.5, { align: 'center' })
          sf('normal', 4.5); stc(fg)
          tx(`morn ${fmtT(wd.temps.minMorning)}°`, cx + dayW / 2, y + rowH - 1.5, { align: 'center' })
        }
      })
      y += rowH
    }

    textRow('Risks', notes.risks)
    FORECAST_AREAS.forEach(area => weatherRow(`Weather\n${area.label}`, grid[area.key]))
    textRow('TOC Operations & Depot start up', notes.toc, 12)
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
      const steamH = 12
      labelBox('Steam Fire Risk', steamH)
      const steamRisk = padTo7(log.steamFireRisk as string[] | undefined, 'GREEN')
      steamRisk.forEach((level, i) => {
        const cx = M + labelW + i * dayW
        cell(cx, y, dayW, steamH, STEAM_BG[level as SteamFireRiskLevel])
        sf('bold', 7); stc(STEAM_FG[level as SteamFireRiskLevel])
        tx(STEAM_LABELS[level as SteamFireRiskLevel], cx + dayW / 2, y + 7.5, { align: 'center' })
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

      const adhesH = 14
      const drawAdhesionRow = (label: string, levels: AdhesionLevel[]) => {
        labelBox(label, adhesH)
        levels.forEach((level, i) => {
          const cx = M + labelW + i * dayW
          cell(cx, y, dayW, adhesH, ADHES_BG[level])
          const lines = doc.splitTextToSize(ADHES_LABEL[level], dayW - 2)
          sf('bold', 6); stc(ADHES_FG[level])
          tx(lines.slice(0, 2), cx + dayW / 2, y + adhesH / 2 + 1.2, { align: 'center' })
        })
        y += adhesH
      }

      const eastMids = padTo7(log.eastMidsAdhesion as string[] | undefined, 'GOOD_1_2') as AdhesionLevel[]
      const lincoln  = padTo7(log.lincolnAdhesion  as string[] | undefined, 'GOOD_1_2') as AdhesionLevel[]
      drawAdhesionRow('East Mids Adhesion', eastMids)
      drawAdhesionRow('Lincoln Adhesion',   lincoln)
    }

    y += 6
  }

  // ── Roster grid ─────────────────────────────────────────────────────────────

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
    const first = incidents.filter(i => !i.isContinuation)
    const stats = [
      { label: 'Person Struck', count: first.filter(i => ['FATALITY','PERSON_STRUCK'].includes(i.category)).length, urgent: true  },
      { label: 'SPADs',         count: first.filter(i => i.category === 'SPAD').length,              urgent: true  },
      { label: 'TPWS',          count: first.filter(i => i.category === 'TPWS').length,              urgent: false },
      { label: 'Near Misses',   count: first.filter(i => i.category === 'NEAR_MISS').length,        urgent: false },
      { label: 'Crime/Trespass',count: first.filter(i => i.category === 'CRIME').length,            urgent: false },
      { label: 'Irr. Working',  count: first.filter(i => i.category === 'IRREGULAR_WORKING').length,urgent: false },
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
    const routeInc  = incidents.filter(i => !i.isOffRoute)
    const totalMins = routeInc.reduce((s, i) =>
      s + (i.isContinuation ? (i.delayDelta ?? 0) : (i.minutesDelay || 0)), 0)
    const totalCan  = routeInc.reduce((s, i) => s + (i.cancelled    || 0), 0)
    const totalPCan = routeInc.reduce((s, i) => s + (i.partCancelled|| 0), 0)
    const topInc    = [...routeInc].sort((a,b) => (b.minutesDelay||0) - (a.minutesDelay||0))[0]
    const offRouteCount = incidents.filter(i => i.isOffRoute).length

    const boxes = [
      { label: 'Route Delay',      value: `${totalMins.toLocaleString()} min`, color: C.amber  },
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
    if (offRouteCount > 0) {
      sf('normal', 6.5); stc(C.midGray)
      tx(
        `* ${offRouteCount} off-route incident${offRouteCount !== 1 ? 's' : ''} included in log for visibility — excluded from route totals above.`,
        M, y
      )
      y += 5
    }
  }

  // ── Emergency Speed Restrictions (NRSDB snapshot) ─────────────────────────
  // Every currently imposed ESR for the route, with rows highlighted NEW or
  // AMENDED against the previous snapshot and a separate table of anything
  // REMOVED since then. Data comes from /api/esr/snapshot at build time.

  const ESR_NEW_BG:     RGB = [214, 240, 224]
  const ESR_AMEND_BG:   RGB = [253, 236, 200]
  const ESR_REMOVED_BG: RGB = [244, 226, 224]

  const fmtEsrDate = (iso: string | null, raw: string | null): string => {
    if (iso) {
      const d = new Date(iso)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('en-GB', {
          timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).replace(',', '')
      }
    }
    return raw ? (raw.length > 16 ? raw.slice(0, 16) : raw) : '—'
  }
  const fmtSnapshotStamp = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('en-GB', {
      timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).replace(',', '')
  }
  const esrSpeedCell = (r: EsrRow): string => {
    const spd = r.speedValue ? `${r.speedValue}${r.speedUnit ? ` ${r.speedUnit}` : ''}` : '—'
    return r.linespeed ? `${spd}\n(line ${r.linespeed})` : spd
  }
  const esrLocationCell = (r: EsrRow): string => {
    const parts = [r.location, r.linesText ? `Lines: ${r.linesText}` : null].filter(Boolean) as string[]
    return parts.join('\n') || '—'
  }
  const esrRefCell = (r: EsrRow): string => {
    const extras = [r.ccilNumber ? `CCIL ${r.ccilNumber}` : null, r.fmsNumber ? `FMS ${r.fmsNumber}` : null]
      .filter(Boolean) as string[]
    return extras.length ? `${r.refnum}\n${extras.join(' · ')}` : r.refnum
  }

  const esrTableStyles = {
    margin: { left: M, right: M, top: 22 },
    theme: 'grid' as const,
    headStyles: { fillColor: C.blue, textColor: C.white, fontSize: 6.5, fontStyle: 'bold' as const, cellPadding: 1.8 },
    bodyStyles: { fontSize: 6, textColor: C.darkGray, cellPadding: 1.5, lineColor: C.lightGray, lineWidth: 0.1, valign: 'top' as const },
    alternateRowStyles: { fillColor: [247, 248, 251] as RGB },
    didDrawPage: () => { drawCompactHeader() },
  }

  const drawEsrSection = () => {
    if (!esr) return
    if (!esr.ok) {
      if (esr.reason === 'not_configured') return
      newPage()
      sectionHead('EMERGENCY SPEED RESTRICTIONS', 'NRSDB')
      const skipped = esr.reason === 'skipped'
      sfc(skipped ? [253, 244, 220] : [253, 236, 236]); rc(M, y, W - M*2, 14)
      sfc(skipped ? C.amber : C.red); rc(M, y, 3, 14)
      sf('bold', 8); stc(skipped ? [140, 80, 10] : C.red)
      tx(skipped ? 'ESR DATA NOT PROVIDED AT BUILD' : 'ESR DATA UNAVAILABLE FOR THIS LOG', M + 6, y + 5.5)
      sf('normal', 7); stc(C.darkGray)
      tx(doc.splitTextToSize(esr.message, W - M*2 - 10).slice(0, 1), M + 6, y + 10.5)
      y += 20
      return
    }

    const c = esr.counts
    newPage()
    sectionHead(
      `EMERGENCY SPEED RESTRICTIONS — ${esr.routeCode} ROUTE`,
      `${c.active} imposed · ${c.new} new · ${c.amended} amended · ${c.removed} removed`,
    )

    // Provenance line + legend
    sf('normal', 7); stc(C.darkGray)
    const stored = esr.source === 'stored'
    const asAt = stored
      ? `Imposed ESRs from the stored NRSDB snapshot captured ${fmtSnapshotStamp(esr.capturedAt)}.`
      : esr.source === 'pasted'
      ? `Imposed ESRs as at ${fmtSnapshotStamp(esr.capturedAt)} (NRSDB feed supplied by the operator at build).`
      : `Imposed ESRs as at ${fmtSnapshotStamp(esr.capturedAt)} (NRSDB).`
    const vs = esr.baselineDate
      ? `Changes are against the previous snapshot of ${fmtSnapshotStamp(esr.baselineCapturedAt) || formatDisplayDate(esr.baselineDate)}.`
      : 'No previous snapshot — first capture, so no change status is available. Highlighting starts from the next log.'
    const provLines = doc.splitTextToSize(`${asAt}  ${vs}`, W - M * 2).slice(0, 2)
    tx(provLines, M, y)
    y += 3.6 * provLines.length + 1
    if (stored) {
      const ageH = (Date.now() - new Date(esr.capturedAt).getTime()) / 36e5
      const stale = Number.isFinite(ageH) && ageH > 20
      sf(stale ? 'bold' : 'italic', 6.5); stc(stale ? C.red : [140, 80, 10])
      const age = Number.isFinite(ageH) ? (ageH < 1 ? `${Math.round(ageH * 60)} min` : `${Math.round(ageH)} h`) : '?'
      const note = (stale ? `STALE — snapshot is ${age} old. ` : `Snapshot is ${age} old. `) +
        `Live pull from the server was not possible${esr.liveError ? ` (${esr.liveError})` : ''}.`
      const noteLines = doc.splitTextToSize(note, W - M * 2).slice(0, 2)
      tx(noteLines, M, y)
      y += 3.6 * noteLines.length + 1
    }
    if (esr.dryRun) {
      sf('italic', 6.5); stc([140, 80, 10])
      tx('Test Mode — snapshot not stored; the stored baseline is unchanged.', M, y)
      y += 4.5
    } else if (!esr.persisted && !stored) {
      sf('italic', 6.5); stc(C.red)
      tx(`Snapshot not stored${esr.persistError ? `: ${esr.persistError.slice(0, 140)}` : ' (Supabase not configured)'} — the next log cannot compare against today.`, M, y)
      y += 4.5
    }
    const legend: Array<[string, RGB]> = [['NEW since last snapshot', ESR_NEW_BG], ['AMENDED since last snapshot', ESR_AMEND_BG]]
    let lx = M
    for (const [label, bg] of legend) {
      sfc(bg); sdc(C.lightGray); doc.setLineWidth(0.2); rc(lx, y - 2.6, 5, 3.2, 'FD')
      sf('normal', 6.5); stc(C.darkGray); tx(label, lx + 6.5, y)
      lx += 6.5 + doc.getTextWidth(label) + 8
    }
    y += 4

    // ── Active table ──────────────────────────────────────────────────────
    type RowMeta = { kind: 'row'; status: 'NEW' | 'AMENDED' | 'UNCHANGED' } | { kind: 'changes' }
    const body: any[][] = []
    const meta: RowMeta[] = []
    for (const entry of esr.active) {
      const r = entry.row
      body.push([
        esrRefCell(r),
        r.duName || '—',
        r.elrCode || '—',
        esrLocationCell(r),
        esrSpeedCell(r),
        r.reason || '—',
        fmtEsrDate(r.whenImposed, r.whenImposedRaw),
        entry.status === 'UNCHANGED' ? '' : entry.status,
      ])
      meta.push({ kind: 'row', status: entry.status })
      if (entry.status === 'AMENDED' && entry.changes?.length) {
        body.push([{ content: `Amended: ${describeChanges(entry.changes as EsrFieldChange[])}`, colSpan: 8 }])
        meta.push({ kind: 'changes' })
      }
    }

    autoTable(doc, {
      ...esrTableStyles,
      startY: y,
      head: [['Ref', 'DU', 'ELR', 'Location / Lines', 'ESR speed', 'Reason', 'Imposed', 'Status']],
      body,
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 17 },
        2: { cellWidth: 11 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 18 },
        5: { cellWidth: 38 },
        6: { cellWidth: 18 },
        7: { cellWidth: 15, halign: 'center' as const },
      },
      didParseCell: (data: any) => {
        if (data.section !== 'body') return
        const m = meta[data.row.index]
        if (!m) return
        if (m.kind === 'changes') {
          data.cell.styles.fillColor = ESR_AMEND_BG
          data.cell.styles.fontStyle = 'italic'
          data.cell.styles.textColor = [140, 80, 10]
          data.cell.styles.fontSize = 5.8
          return
        }
        if (m.status === 'NEW') {
          data.cell.styles.fillColor = ESR_NEW_BG
          if (data.column.index === 7) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = [20, 110, 60] }
        } else if (m.status === 'AMENDED') {
          data.cell.styles.fillColor = ESR_AMEND_BG
          if (data.column.index === 7) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = [140, 80, 10] }
        }
        if (data.column.index === 0) data.cell.styles.fontStyle = 'bold'
      },
    })
    y = getAutoY() + 8

    // ── Removed since baseline ─────────────────────────────────────────────
    checkPage(24)
    const removedTitle = esr.baselineDate
      ? `REMOVED SINCE ${formatDisplayDate(esr.baselineDate).toUpperCase()}`
      : 'REMOVED SINCE LAST SNAPSHOT'
    sfc(C.lightGray); rc(M, y, W - M*2, 7)
    sfc(C.red); rc(M, y, 3, 7)
    sf('bold', 7.5); stc(C.navy); tx(removedTitle, M + 6, y + 4.9)
    sf('normal', 6.5); stc(C.darkGray)
    tx(`${esr.removed.length} restriction${esr.removed.length !== 1 ? 's' : ''}`, W - M - 2, y + 4.9, { align: 'right' })
    y += 10

    if (!esr.baselineDate) {
      sf('italic', 7); stc(C.midGray)
      tx('No previous snapshot to compare against.', M + 2, y)
      y += 6
    } else if (esr.removed.length === 0) {
      sf('italic', 7); stc(C.midGray)
      tx('None — every restriction in the previous snapshot is still imposed.', M + 2, y)
      y += 6
    } else {
      autoTable(doc, {
        ...esrTableStyles,
        startY: y,
        head: [['Ref', 'DU', 'ELR', 'Location / Lines', 'Last speed', 'Reason', 'Imposed']],
        body: esr.removed.map(r => [
          esrRefCell(r),
          r.duName || '—',
          r.elrCode || '—',
          esrLocationCell(r),
          esrSpeedCell(r),
          r.reason || '—',
          fmtEsrDate(r.whenImposed, r.whenImposedRaw),
        ]),
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 17 },
          2: { cellWidth: 11 },
          3: { cellWidth: 'auto' },
          4: { cellWidth: 18 },
          5: { cellWidth: 38 },
          6: { cellWidth: 18 },
        },
        didParseCell: (data: any) => {
          if (data.section !== 'body') return
          data.cell.styles.fillColor = ESR_REMOVED_BG
          if (data.column.index === 0) data.cell.styles.fontStyle = 'bold'
        },
      })
      y = getAutoY() + 8
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // BUILD DOCUMENT
  // ─────────────────────────────────────────────────────────────────────

  y = drawCoverHeader()

  // ── 0. Roster ──────────────────────────────────────────────────────────────
  sectionHead('SHIFT ROSTER', log.period)
  const rosterStartY = y
  const dayEnd   = drawRosterHalf(log.roster.dayShift,   'DAY SHIFT',   0)
  y = rosterStartY
  const nightEnd = drawRosterHalf(log.roster.nightShift, 'NIGHT SHIFT', (W - M*2)/2 + 2)
  y = Math.max(dayEnd, nightEnd) + 8

  // ── 1. 7 Day Look Ahead (page 2) ──────────────────────────────────────────
  newPage()
  sectionHead('7 DAY LOOK AHEAD', log.date ? formatDisplayDate(log.date) : undefined)
  drawLookAhead()

  // ── 1b. Emergency Speed Restrictions (own page, when NRSDB is configured) ─
  drawEsrSection()

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
      // Carryover label sits below the badge row, left-aligned so it doesn't
      // clash with the category badge or the delay figure on the right.
      if (inc.isContinuation) {
        sf('bold', 5.5); stc(C.amber)
        tx('CARRIED OVER FROM PRIOR LOG', M + 5, y + 11)
      }

      // Title
      sf('bold', 10.5); stc(C.blue)
      const titleLines = doc.splitTextToSize(inc.title, W - M*2 - 32)
      tx(titleLines.slice(0, 2), M + 5, y + 14.5)

      // Description snippet — prefer narrative text, fall back to incident type label
      const snippetText = (inc.description && inc.description !== inc.title)
        ? inc.description
        : inc.incidentTypeLabel || ''
      if (snippetText) {
        const desc = snippetText.length > 170 ? snippetText.slice(0, 170) + '…' : snippetText
        sf('normal', 7.4); stc(C.darkGray)
        const dl = doc.splitTextToSize(desc, W - M*2 - 10)
        tx(dl.slice(0, 2), M + 5, y + 22.5)
      }

      // Disruption figures right side
      if ((inc.minutesDelay || 0) > 0 || (inc.cancelled || 0) > 0) {
        sf('bold', 10); stc(sevColor)
        if (inc.isContinuation) {
          const delta = inc.delayDelta ?? 0
          if (delta > 0) tx(`+${delta.toLocaleString()} min`, W - M - 4, y + 13.5, { align: 'right' })
          else if (inc.minutesDelay) tx(`${inc.minutesDelay.toLocaleString()} min`, W - M - 4, y + 13.5, { align: 'right' })
        } else if (inc.minutesDelay) {
          tx(`${inc.minutesDelay.toLocaleString()} min`, W - M - 4, y + 13.5, { align: 'right' })
        }
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

    const tableBody = items.map(i => {
      let delayCell = '—'
      if (i.isOffRoute) {
        delayCell = (i.minutesDelay || 0) > 0 ? `${i.minutesDelay!.toLocaleString()} *` : '—'
      } else if (i.isContinuation) {
        const delta = i.delayDelta ?? 0
        delayCell = delta > 0
          ? `+${delta.toLocaleString()} (c/o)`
          : (i.minutesDelay || 0) > 0 ? `${i.minutesDelay!.toLocaleString()} (c/o)` : '— (c/o)'
      } else if ((i.minutesDelay || 0) > 0) {
        delayCell = i.minutesDelay!.toLocaleString()
      }
      let titleCell: string
      if (i.isOffRoute) {
        const base = i.title.length > 50 ? i.title.slice(0, 50) + '…' : i.title
        titleCell = `${base} [Off Route]`
      } else if (i.isContinuation) {
        titleCell = i.title.length > 56 ? i.title.slice(0, 56) + '… [c/o]' : `${i.title} [c/o]`
      } else {
        titleCell = i.title.length > 65 ? i.title.slice(0, 65) + '…' : i.title
      }
      return [
        i.ccil || '—',
        i.location || '—',
        i.incidentStart || '—',
        titleCell,
        delayCell,
        (i.cancelled || 0) > 0 ? String(i.cancelled) : '—',
        i.severity,
      ]
    })

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
        if (data.section === 'body') {
          const inc = items[data.row.index]
          if (inc?.isOffRoute) {
            data.cell.styles.textColor = C.midGray
            data.cell.styles.fontStyle = 'italic'
          }
          if (data.column.index === 6) {
            data.cell.styles.textColor = inc?.isOffRoute ? C.midGray : (SEV_COLOR[data.cell.raw as string] || C.midGray)
            data.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })

    y = getAutoY() + 8
  }

  // ── 5b. Custom group sections ──────────────────────────────────────────────
  // Render one table per custom group key that has incidents, using the
  // displayName from settings when available.
  if (categorySettings) {
    const customKeys = categorySettings.customGroupKeys
    for (const key of customKeys) {
      const items = log.incidents.filter(i => i.displayGroup === key)
      if (items.length === 0) continue
      const cfg = categorySettings.groups[key]
      const label = cfg?.displayName?.toUpperCase() ?? key.replace(/_/g, ' ')
      checkPage(22)
      sectionHead(label, `${items.length} incident${items.length !== 1 ? 's' : ''}`)
      const tableBody = items.map(i => {
        let delayCell = '—'
        if (i.isOffRoute) {
          delayCell = (i.minutesDelay || 0) > 0 ? `${i.minutesDelay!.toLocaleString()} *` : '—'
        } else if (i.isContinuation) {
          const delta = i.delayDelta ?? 0
          delayCell = delta > 0
            ? `+${delta.toLocaleString()} (c/o)`
            : (i.minutesDelay || 0) > 0 ? `${i.minutesDelay!.toLocaleString()} (c/o)` : '— (c/o)'
        } else if ((i.minutesDelay || 0) > 0) {
          delayCell = i.minutesDelay!.toLocaleString()
        }
        let titleCell: string
        if (i.isOffRoute) {
          const base = i.title.length > 50 ? i.title.slice(0, 50) + '…' : i.title
          titleCell = `${base} [Off Route]`
        } else if (i.isContinuation) {
          titleCell = i.title.length > 56 ? i.title.slice(0, 56) + '… [c/o]' : `${i.title} [c/o]`
        } else {
          titleCell = i.title.length > 65 ? i.title.slice(0, 65) + '…' : i.title
        }
        return [
          i.ccil || '—',
          i.location || '—',
          i.incidentStart || '—',
          titleCell,
          delayCell,
          (i.cancelled || 0) > 0 ? String(i.cancelled) : '—',
          i.severity,
        ]
      })
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
          if (data.section === 'body') {
            const inc = items[data.row.index]
            if (inc?.isOffRoute) {
              data.cell.styles.textColor = C.midGray
              data.cell.styles.fontStyle = 'italic'
            }
            if (data.column.index === 6) {
              data.cell.styles.textColor = inc?.isOffRoute ? C.midGray : (SEV_COLOR[data.cell.raw as string] || C.midGray)
              data.cell.styles.fontStyle = 'bold'
            }
          }
        },
      })
      y = getAutoY() + 8
    }
  }

  // ── 6. Disruption impact ranked table ─────────────────────────────────────

  const byDelay = [...log.incidents]
    .filter(i => (i.minutesDelay || 0) > 0)
    .sort((a, b) => (b.minutesDelay || 0) - (a.minutesDelay || 0))
    .slice(0, 20)

  if (byDelay.length > 0) {
    checkPage(22)
    sectionHead('DISRUPTION IMPACT — TOP INCIDENTS BY DELAY')

    const routeByDelay = byDelay.filter(i => !i.isOffRoute)
    const totalMins = routeByDelay.reduce((s, i) => s + (i.minutesDelay || 0), 0)
    const totalCan  = routeByDelay.reduce((s, i) => s + (i.cancelled    || 0), 0)

    autoTable(doc, {
      startY: y,
      head: [['#', 'CCIL', 'Category', 'Location / Incident', 'Delay (min)', 'Cancelled', 'Part Can']],
      body: byDelay.map((i, idx) => [
        `#${idx + 1}`,
        i.ccil || '—',
        CATEGORY_CONFIG[i.category].shortLabel,
        i.isOffRoute
          ? `${i.location}  —  ${i.title.slice(0, 40)} [Off Route]`
          : `${i.location}  —  ${i.title.slice(0, 48)}`,
        i.isOffRoute
          ? `${i.minutesDelay?.toLocaleString() || '—'} *`
          : (i.minutesDelay?.toLocaleString() || '—'),
        i.cancelled    || '—',
        i.partCancelled|| '—',
      ]),
      foot: [['', '', '', 'ROUTE TOTAL', totalMins.toLocaleString(), totalCan, '']],
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
      didParseCell: (data: any) => {
        if (data.section === 'body') {
          const inc = byDelay[data.row.index]
          if (inc?.isOffRoute) {
            data.cell.styles.textColor = C.midGray
            data.cell.styles.fontStyle = 'italic'
          }
        }
      },
    })

    y = getAutoY() + 8
  }

  // ── 7. Historical Trends (embedded chart images from Supabase) ───────────
  if (chartImages) {
    newPage()
    sectionHead(
      'HISTORICAL TRENDS — EMCC INCIDENT DATA',
      `${chartImages.reportCount} report${chartImages.reportCount !== 1 ? 's' : ''} in database · Rolling 30-Day Window`
    )

    const chartW = W - M * 2

    // Chart 1: dual-line trend — canvas 1400×420
    const trendH = chartW * (420 / 1400)
    doc.addImage(chartImages.delayTrend, 'JPEG', M, y, chartW, trendH)
    y += trendH + 6

    // Chart 2: category horizontal bar — canvas 1400×460
    checkPage(68)
    const catH = chartW * (460 / 1400)
    doc.addImage(chartImages.categoryBreakdown, 'JPEG', M, y, chartW, catH)
    y += catH + 6

    // Chart 3: top locations bar — canvas 1400×460
    checkPage(68)
    const locH = chartW * (460 / 1400)
    doc.addImage(chartImages.topLocations, 'JPEG', M, y, chartW, locH)
    y += locH + 8

    // ── Page 2: Safety & Operational Analysis ─────────────────────────────────
    newPage()
    sectionHead('SAFETY & OPERATIONAL ANALYSIS', 'Timing patterns · Efficiency · Safety-critical evolution')

    // Chart 4: time of day — canvas 1400×400
    const timeH = chartW * (400 / 1400)
    doc.addImage(chartImages.timeOfDay, 'JPEG', M, y, chartW, timeH)
    y += timeH + 6

    // Chart 5: average delay per incident — canvas 1400×400
    checkPage(timeH + 10)
    doc.addImage(chartImages.avgDelayTrend, 'JPEG', M, y, chartW, timeH)
    y += timeH + 6

    // Chart 6: safety-critical stacked bar — canvas 1400×460
    checkPage(catH + 10)
    doc.addImage(chartImages.safetyCategoryTrend, 'JPEG', M, y, chartW, catH)
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
      body: appendixIncidents.map((inc) => {
        const titleText = inc.isOffRoute
          ? (inc.title.length > 60 ? `${inc.title.slice(0, 60)}… [OR]` : `${inc.title} [OR]`)
          : (inc.title.length > 70 ? `${inc.title.slice(0, 70)}…` : inc.title)
        return [
          inc.ccil || '—',
          inc.incidentStart || '—',
          CATEGORY_CONFIG[inc.category].shortLabel,
          inc.severity,
          inc.location || '—',
          titleText,
          (inc.minutesDelay || 0) > 0
            ? (inc.isOffRoute ? `${inc.minutesDelay}*` : String(inc.minutesDelay))
            : '0',
          String(inc.cancelled || 0),
          String(inc.partCancelled || 0),
        ]
      }),
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
        if (data.section === 'body') {
          const inc = appendixIncidents[data.row.index]
          if (inc?.isOffRoute) data.cell.styles.textColor = C.midGray
          if (data.column.index === 3) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.textColor = inc?.isOffRoute
              ? C.midGray
              : (SEV_COLOR[data.cell.raw as string] || C.black)
          }
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

  // ── 9. Out of Use Infrastructure Register (always last) ──────────────────
  // A standing register owned by maintenance (edited at /out-of-use), read as
  // it stands at build time. Control add nothing here. Omitted only when there
  // is no database AND nothing in the local fallback — an empty live register
  // still prints, so the reader knows it was checked and is empty.
  if (outOfUse && (outOfUse.source === 'cloud' || outOfUse.items.length > 0)) {
    newPage()
    sectionHead('OUT OF USE INFRASTRUCTURE REGISTER', 'Maintained by maintenance · as at log build')

    sf('normal', 7); stc(C.darkGray)
    const introBits: string[] = []
    introBits.push(outOfUse.items.length === 0
      ? 'The register is empty.'
      : `${outOfUse.items.length} item${outOfUse.items.length === 1 ? '' : 's'} on the register.`)
    if (outOfUse.lastUpdated) introBits.push(`Last change ${fmtOouStamp(outOfUse.lastUpdated)}.`)
    if (outOfUse.source === 'local') introBits.push('Read from this browser only (no database configured).')
    tx(introBits.join('  '), M, y)
    y += 4
    sf('italic', 6.5); stc(C.midGray)
    const oouNote = doc.splitTextToSize('Maintenance keep the assets, issues and repair plans current; ops rate the operational impact (RAG), which sets the order. Control transcribe nothing. Queries on an entry go to the named owner.', W - M*2)
    tx(oouNote, M, y)
    y += 3.2 * oouNote.length + 3

    if (outOfUse.error) {
      sf('italic', 7.5); stc(C.red)
      tx(doc.splitTextToSize(`The register could not be read at build time: ${outOfUse.error}`, W - M*2)[0], M, y)
      y += 8
    }

    const oouTableStyles = {
      margin: { left: M, right: M, top: 22 },
      theme: 'grid' as const,
      headStyles: { fillColor: C.blue, textColor: C.white, fontSize: 6.8, fontStyle: 'bold' as const, cellPadding: 1.6 },
      bodyStyles: { textColor: C.black, fontSize: 6.6, cellPadding: 1.6, lineColor: C.lightGray, lineWidth: 0.1, valign: 'top' as const },
      didDrawPage: () => { drawCompactHeader() },
    }

    // Narrative lines under an asset: label + text for each non-empty field.
    const narrative = (pairs: Array<[string, string]>): string =>
      pairs.filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join('\n')

    const oouSubHead = (title: string, right: string) => {
      checkPage(24)
      sfc(C.offWhite); rc(M, y, W - M*2, 7)
      sdc(C.lightGray); rc(M, y, W - M*2, 7, 'S')
      sf('bold', 7.5); stc(C.navy); tx(title, M + 2, y + 4.8)
      sf('normal', 7); stc(C.midGray)
      tx(right, W - M - 2, y + 4.8, { align: 'right' })
      y += 9
    }

    // ── Infrastructure: one table, ordered by ops RAG (RED → AMBER → unrated → GREEN)
    const drawInfra = () => {
      const spec  = OOU_SECTION_SPECS.INFRA
      const items = outOfUse.items.filter(i => i.section === 'INFRA')   // already sorted by lib
      const counts = ragCounts(items)
      const summary = items.length === 0 ? '0 items'
        : [`${items.length} item${items.length !== 1 ? 's' : ''}`,
           counts.RED ? `${counts.RED} red` : null, counts.AMBER ? `${counts.AMBER} amber` : null,
           counts.GREEN ? `${counts.GREEN} green` : null, counts.UNRATED ? `${counts.UNRATED} not assessed` : null,
          ].filter(Boolean).join(' · ')
      oouSubHead(spec.pdfTitle, summary)

      // RAG legend
      let lx = M + 2
      const legend: Array<[string, RGB]> = [
        ...OOU_RAGS.map(r => [`${OOU_RAG_SPECS[r].label} — ${OOU_RAG_SPECS[r].meaning.replace(' expected', '')}`, OOU_RAG_SPECS[r].rgb] as [string, RGB]),
        ['Not assessed — ops to rate', OOU_UNRATED.rgb],
      ]
      for (const [label, bg] of legend) {
        sfc(bg); rc(lx, y - 2.4, 4, 3, 'F')
        sf('normal', 6.2); stc(C.darkGray); tx(label, lx + 5.2, y)
        lx += 5.2 + doc.getTextWidth(label) + 6
      }
      y += 4

      if (items.length === 0) {
        sf('italic', 7); stc(C.midGray)
        tx('None.', M + 2, y)
        y += 7
        return
      }

      const head = [['RAG', 'Infrastructure Item and Location', 'ELR', 'Issue and Restrictions Imposed', 'OOU Since', 'FMS / CCIL Ref', 'Owner']]
      const body: any[] = []
      const rowRag = new Map<number, OouItem['rag']>()   // main-row index → rag
      const narrativeRows = new Set<number>()
      for (const it of items) {
        const d = daysSince(it.since)
        rowRag.set(body.length, it.rag)
        body.push([
          it.rag ? OOU_RAG_SPECS[it.rag].label.toUpperCase() : 'N/A',
          it.item,
          it.elr || '—',
          it.detail || '—',
          it.since ? `${fmtSince(it.since)}${d !== null ? `\n(${d} d)` : ''}` : '—',
          it.ref || '—',
          it.owner || '—',
        ])
        const note = narrative([
          ['Operational impact (Ops)', it.opsImpact || (it.rag ? '' : 'Not yet assessed by ops.')],
          ['Repair requirements and timescale', it.plan],
        ])
        const stamp = `Updated ${fmtOouStamp(it.updatedAt)}${it.updatedBy ? ` by ${it.updatedBy}` : ''}`
        narrativeRows.add(body.length)
        body.push([{ content: note ? `${note}\n${stamp}` : stamp, colSpan: head[0].length }])
      }

      autoTable(doc, {
        ...oouTableStyles,
        startY: y,
        head,
        body,
        columnStyles: {
          0: { cellWidth: 13, halign: 'center' as const, fontStyle: 'bold' as const },
          1: { cellWidth: 36, fontStyle: 'bold' as const },
          2: { cellWidth: 11 },
          3: { cellWidth: 'auto' as const },
          4: { cellWidth: 17 },
          5: { cellWidth: 20 },
          6: { cellWidth: 19 },
        },
        didParseCell: (data: any) => {
          if (data.section !== 'body') return
          if (narrativeRows.has(data.row.index)) {
            data.cell.styles.fontSize = 6.2
            data.cell.styles.fontStyle = 'normal'
            data.cell.styles.textColor = C.darkGray
            data.cell.styles.fillColor = [247, 248, 251]
            data.cell.styles.cellPadding = { top: 1.2, bottom: 1.6, left: 3, right: 2 }
            data.cell.styles.halign = 'left'
            return
          }
          if (data.column.index === 0) {
            const rag = rowRag.get(data.row.index) ?? null
            const s = rag ? OOU_RAG_SPECS[rag] : OOU_UNRATED
            data.cell.styles.fillColor = s.rgb
            data.cell.styles.textColor = rag === 'AMBER' ? C.navy : C.white
            data.cell.styles.fontSize = rag ? 6.4 : 5.6
            data.cell.styles.valign = 'middle'
          }
        },
      })
      y = getAutoY() + 7
    }

    // ── UPS: unchanged layout
    const drawUps = () => {
      const spec  = OOU_SECTION_SPECS.UPS
      const items = outOfUse.items.filter(i => i.section === 'UPS')
      oouSubHead(spec.pdfTitle, `${items.length} item${items.length !== 1 ? 's' : ''}`)

      if (items.length === 0) {
        sf('italic', 7); stc(C.midGray)
        tx('None.', M + 2, y)
        y += 7
        return
      }

      const head = [['UPS / Site', 'Plan for Rectification', 'Impact on Failure']]
      const body: any[] = []
      const narrativeRows = new Set<number>()
      for (const it of items) {
        body.push([it.item, it.plan || '—', it.impact || '—'])
        const note = narrative([['Owner', it.owner]])
        const stamp = `Updated ${fmtOouStamp(it.updatedAt)}${it.updatedBy ? ` by ${it.updatedBy}` : ''}`
        narrativeRows.add(body.length)
        body.push([{ content: note ? `${note}\n${stamp}` : stamp, colSpan: head[0].length }])
      }

      autoTable(doc, {
        ...oouTableStyles,
        startY: y,
        head,
        body,
        columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' as const }, 1: { cellWidth: 'auto' as const }, 2: { cellWidth: 62 } },
        didParseCell: (data: any) => {
          if (data.section === 'body' && narrativeRows.has(data.row.index)) {
            data.cell.styles.fontSize = 6.2
            data.cell.styles.fontStyle = 'normal'
            data.cell.styles.textColor = C.darkGray
            data.cell.styles.fillColor = [247, 248, 251]
            data.cell.styles.cellPadding = { top: 1.2, bottom: 1.6, left: 3, right: 2 }
            data.cell.styles.halign = 'left'
          }
        },
      })
      y = getAutoY() + 7
    }

    drawInfra()
    drawUps()
  }

  // ── Add footers to all pages ───────────────────────────────────────────────

  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    drawFooter(p, total)
    if (testMode) drawTestWatermark()
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  const dateStr = log.date ? log.date.replace(/-/g, '') : 'unknown'
  doc.save(`EMCC_Daily_Report_${dateStr}${testMode ? '_TEST' : ''}.pdf`)
}

// ─── Utility ─────────────────────────────────────────────────────────────────

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

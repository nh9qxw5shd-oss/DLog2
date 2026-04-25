'use client'

import type { HistoricalChartData } from './supabaseClient'

export interface ChartImages {
  delayTrend:        string  // dual-line: delay minutes + incident count
  categoryBreakdown: string  // horizontal bar: incident type split
  topLocations:      string  // horizontal bar: top locations by incident count
  reportCount:       number
}

// ─── Canvas dimensions ────────────────────────────────────────────────────────
const W        = 1400
const H_TREND  = 420
const H_BAR    = 460

// ─── Brand colours ────────────────────────────────────────────────────────────
const NAVY   = '#001F45'
const ORANGE = '#E05206'
const STEEL  = '#4A6FA5'
const DARK   = '#2C3E50'
const OFFWHT = '#F8F9FC'
const GRID   = 'rgba(0,0,0,0.08)'
const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Low-level canvas helpers ─────────────────────────────────────────────────

function shortDate(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${parseInt(dd)} ${MONTHS[parseInt(mm)]}`
}

function niceMax(v: number): number {
  if (v <= 0) return 10
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  return Math.ceil(v / mag) * mag
}

function bezierPath(
  ctx: CanvasRenderingContext2D,
  n: number,
  px: (i: number) => number,
  py: (i: number) => number,
): void {
  for (let i = 0; i < n; i++) {
    if (i === 0) { ctx.moveTo(px(0), py(0)); continue }
    const mx = (px(i - 1) + px(i)) / 2
    ctx.bezierCurveTo(mx, py(i - 1), mx, py(i), px(i), py(i))
  }
}

function dots(
  ctx: CanvasRenderingContext2D,
  n: number,
  px: (i: number) => number,
  py: (i: number) => number,
  fill: string,
): void {
  for (let i = 0; i < n; i++) {
    ctx.beginPath()
    ctx.arc(px(i), py(i), 4, 0, Math.PI * 2)
    ctx.fillStyle = fill; ctx.fill()
    ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.stroke()
  }
}

// ─── Chart 1: dual-axis line (delay + incident count over time) ───────────────

function drawDualLineChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  delayVals: number[],
  countVals: number[],
): void {
  const ctx = canvas.getContext('2d')!
  const H = canvas.height
  const PAD = { top: 68, right: 88, bottom: 88, left: 96 }
  const CX = PAD.left, CY = PAD.top
  const CW = W - PAD.left - PAD.right
  const CH = H - PAD.top - PAD.bottom
  const n = labels.length

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, W, W, H)
  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)

  // Title
  ctx.fillStyle = NAVY; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Delay Minutes & Incident Count per Reporting Period', W / 2, 44)

  if (n === 0) {
    ctx.fillStyle = DARK; ctx.font = '18px Arial, sans-serif'
    ctx.fillText('No data yet', W / 2, CY + CH / 2); return
  }

  const maxDelay = niceMax(Math.max(...delayVals, 1))
  const maxCount = niceMax(Math.max(...countVals, 1))
  const TICKS = 5

  // Gridlines + left y labels (delay, orange) + right y labels (count, steel)
  for (let i = 0; i <= TICKS; i++) {
    const y = CY + CH - (i / TICKS) * CH
    ctx.strokeStyle = GRID; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX + CW, y); ctx.stroke()

    ctx.font = '13px Arial, sans-serif'
    ctx.fillStyle = ORANGE; ctx.textAlign = 'right'
    ctx.fillText(Math.round((i / TICKS) * maxDelay).toLocaleString(), CX - 8, y + 5)
    ctx.fillStyle = STEEL; ctx.textAlign = 'left'
    ctx.fillText(String(Math.round((i / TICKS) * maxCount)), CX + CW + 8, y + 5)
  }

  // Y-axis titles (rotated)
  const rotLabel = (text: string, x: number, color: string, dir: number) => {
    ctx.save(); ctx.translate(x, CY + CH / 2); ctx.rotate(dir * Math.PI / 2)
    ctx.fillStyle = color; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(text, 0, 0); ctx.restore()
  }
  rotLabel('Delay (minutes)', 22, ORANGE, -1)
  rotLabel('Incident Count',  W - 18, STEEL, 1)

  // X labels (skip for density)
  const xSkip = Math.ceil(n / 12)
  labels.forEach((lbl, i) => {
    if (i % xSkip !== 0 && i !== n - 1) return
    const x = n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
    ctx.save(); ctx.translate(x, CY + CH + 14); ctx.rotate(-Math.PI / 5)
    ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(lbl, 0, 0); ctx.restore()
  })

  const px = (i: number) => n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
  const pyD = (i: number) => CY + CH - (delayVals[i] / maxDelay) * CH
  const pyC = (i: number) => CY + CH - (countVals[i] / maxCount) * CH

  // Delay fill
  ctx.beginPath()
  ctx.moveTo(px(0), CY + CH)
  bezierPath(ctx, n, px, pyD)
  ctx.lineTo(px(n - 1), CY + CH); ctx.closePath()
  ctx.fillStyle = 'rgba(224,82,6,0.10)'; ctx.fill()

  // Delay line
  ctx.beginPath(); ctx.strokeStyle = ORANGE; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'
  bezierPath(ctx, n, px, pyD); ctx.stroke()

  // Count line (dashed)
  ctx.beginPath(); ctx.strokeStyle = STEEL; ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  bezierPath(ctx, n, px, pyC); ctx.stroke()
  ctx.setLineDash([])

  dots(ctx, n, px, pyD, ORANGE)
  dots(ctx, n, px, pyC, STEEL)

  // Axes
  ctx.strokeStyle = DARK; ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(CX, CY); ctx.lineTo(CX, CY + CH); ctx.lineTo(CX + CW, CY + CH)
  ctx.moveTo(CX + CW, CY); ctx.lineTo(CX + CW, CY + CH)
  ctx.stroke()

  // Legend
  const lx = CX + 16, ly = CY + 14
  ctx.fillStyle = 'rgba(248,249,252,0.88)'; ctx.fillRect(lx - 8, ly - 16, 210, 52)
  ctx.strokeStyle = ORANGE; ctx.lineWidth = 2.5; ctx.setLineDash([])
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 24, ly); ctx.stroke()
  ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('Total Delay (min)', lx + 30, ly + 4)
  ctx.strokeStyle = STEEL; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
  ctx.beginPath(); ctx.moveTo(lx, ly + 24); ctx.lineTo(lx + 24, ly + 24); ctx.stroke()
  ctx.setLineDash([]); ctx.fillStyle = DARK
  ctx.fillText('Incident Count', lx + 30, ly + 28)
}

// ─── Chart 2 & 3: horizontal bar ─────────────────────────────────────────────

function drawHorizBarChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  values: number[],
  colors: string[],
  title: string,
): void {
  const ctx = canvas.getContext('2d')!
  const H = canvas.height
  const PAD = { top: 68, right: 80, bottom: 36, left: 250 }
  const CX = PAD.left, CY = PAD.top
  const CW = W - PAD.left - PAD.right
  const CH = H - PAD.top - PAD.bottom
  const n = labels.length

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = NAVY; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(title, W / 2, 44)

  if (n === 0) {
    ctx.fillStyle = DARK; ctx.font = '18px Arial, sans-serif'
    ctx.fillText('No data yet', W / 2, CY + CH / 2); return
  }

  const maxVal = Math.max(...values, 1)
  const TICKS = 5

  for (let i = 1; i <= TICKS; i++) {
    const x = CX + (i / TICKS) * CW
    ctx.strokeStyle = GRID; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x, CY + CH); ctx.stroke()
    ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(String(Math.round((i / TICKS) * maxVal)), x, CY + CH + 20)
  }

  const rowH  = CH / n
  const barPd = rowH * 0.18

  labels.forEach((label, i) => {
    const barY = CY + i * rowH + barPd
    const barH = rowH - 2 * barPd
    const barW = Math.max((values[i] / maxVal) * CW, 2)

    ctx.fillStyle   = colors[i] + 'CC'
    ctx.strokeStyle = colors[i]
    ctx.lineWidth   = 1.5
    ctx.beginPath(); ctx.roundRect(CX, barY, barW, barH, 3); ctx.fill(); ctx.stroke()

    ctx.fillStyle = NAVY; ctx.font = 'bold 13px Arial, sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(String(values[i]), CX + barW + 7, barY + barH / 2 + 5)

    ctx.fillStyle = DARK; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'right'
    let lbl = label
    while (ctx.measureText(lbl).width > PAD.left - 18 && lbl.length > 5) {
      lbl = lbl.slice(0, -4) + '…'
    }
    ctx.fillText(lbl, CX - 10, barY + barH / 2 + 5)
  })

  ctx.strokeStyle = DARK; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX, CY + CH); ctx.stroke()
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderHistoricalCharts(
  data: HistoricalChartData
): Promise<ChartImages> {
  if (typeof window === 'undefined') {
    throw new Error('renderHistoricalCharts must be called in a browser context')
  }

  const trend = data.trendPoints.slice(-30)

  // Chart 1: dual-line delay + count trend
  const c1 = document.createElement('canvas')
  c1.width = W; c1.height = H_TREND
  drawDualLineChart(
    c1,
    trend.map(p => shortDate(p.date)),
    trend.map(p => p.totalDelay),
    trend.map(p => p.incidentCount),
  )

  // Chart 2: category distribution
  const c2 = document.createElement('canvas')
  c2.width = W; c2.height = H_BAR
  const cats = data.categoryBreakdown
  drawHorizBarChart(c2, cats.map(c => c.label), cats.map(c => c.count), cats.map(c => c.color),
    'Incident Type Distribution (All Reporting Periods)')

  // Chart 3: top locations (fixed canvas height for consistent PDF aspect ratio)
  const locs = data.locationBreakdown
  const c3 = document.createElement('canvas')
  c3.width = W; c3.height = H_BAR
  drawHorizBarChart(c3, locs.map(l => l.location), locs.map(l => l.count),
    locs.map(() => STEEL),
    'Top Locations by Incident Count (All Reporting Periods)')

  return {
    delayTrend:        c1.toDataURL('image/png'),
    categoryBreakdown: c2.toDataURL('image/png'),
    topLocations:      c3.toDataURL('image/png'),
    reportCount:       data.reportCount,
  }
}

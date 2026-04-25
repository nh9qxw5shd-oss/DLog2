'use client'

import type { HistoricalChartData } from './supabaseClient'

export interface ChartImages {
  delayTrend:          string  // page 1 — dual-line: delay + incident count
  categoryBreakdown:   string  // page 1 — horiz bar: incident type split
  topLocations:        string  // page 1 — horiz bar: top locations
  timeOfDay:           string  // page 2 — vert bar: incidents by hour of day
  avgDelayTrend:       string  // page 2 — line: avg delay per incident
  safetyCategoryTrend: string  // page 2 — stacked bar: safety-critical evolution
  reportCount:         number
}

// ─── Canvas widths (all charts same width) ────────────────────────────────────
const CW      = 1400
const H_TREND = 420
const H_BAR   = 460
const H_TIME  = 400

// ─── Brand colours ────────────────────────────────────────────────────────────
const NAVY   = '#001F45'
const ORANGE = '#E05206'
const STEEL  = '#4A6FA5'
const AMBER  = '#F39C12'
const DARK   = '#2C3E50'
const OFFWHT = '#F8F9FC'
const GRID   = 'rgba(0,0,0,0.08)'
const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Safety-critical categories with display config ───────────────────────────
const SAFETY_CATS = [
  { key: 'SPAD',          label: 'SPAD',          color: '#E05206' },
  { key: 'TPWS',          label: 'TPWS',          color: '#F39C12' },
  { key: 'NEAR_MISS',     label: 'Near Miss',     color: '#F1C40F' },
  { key: 'BRIDGE_STRIKE', label: 'Bridge Strike', color: '#E67E22' },
  { key: 'PERSON_STRUCK', label: 'Person Struck', color: '#E74C3C' },
  { key: 'FATALITY',      label: 'Fatality',      color: '#C0392B' },
]

// ─── Low-level helpers ────────────────────────────────────────────────────────

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
    ctx.beginPath(); ctx.arc(px(i), py(i), 4, 0, Math.PI * 2)
    ctx.fillStyle = fill; ctx.fill()
    ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.stroke()
  }
}

function noData(ctx: CanvasRenderingContext2D, W: number, H: number, msg: string): void {
  ctx.fillStyle = DARK; ctx.font = '18px Arial, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(msg, W / 2, H / 2)
}

function title(ctx: CanvasRenderingContext2D, W: number, text: string): void {
  ctx.fillStyle = NAVY; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(text, W / 2, 44)
}

function yGridAndLabels(
  ctx: CanvasRenderingContext2D,
  CX: number, CY: number, CW: number, CH: number,
  maxVal: number, ticks: number,
  color = DARK,
): void {
  for (let i = 0; i <= ticks; i++) {
    const y = CY + CH - (i / ticks) * CH
    ctx.strokeStyle = GRID; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX + CW, y); ctx.stroke()
    ctx.fillStyle = color; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(Math.round((i / ticks) * maxVal).toLocaleString(), CX - 8, y + 5)
  }
}

function axes(
  ctx: CanvasRenderingContext2D,
  CX: number, CY: number, CW: number, CH: number,
): void {
  ctx.strokeStyle = DARK; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX, CY + CH); ctx.lineTo(CX + CW, CY + CH); ctx.stroke()
}

function rotLabel(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number, color: string,
): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = color; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(text, 0, 0); ctx.restore()
}

function xLabelsRotated(
  ctx: CanvasRenderingContext2D,
  labels: string[], n: number,
  CX: number, CY: number, CW: number, CH: number,
  skip: number,
): void {
  labels.forEach((lbl, i) => {
    if (i % skip !== 0 && i !== n - 1) return
    const x = n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
    ctx.save(); ctx.translate(x, CY + CH + 14); ctx.rotate(-Math.PI / 5)
    ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(lbl, 0, 0); ctx.restore()
  })
}

// ─── Chart 1: dual-axis line (delay + incident count) ────────────────────────

function drawDualLineChart(
  canvas: HTMLCanvasElement,
  labels: string[], delayVals: number[], countVals: number[],
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const PAD = { top: 68, right: 88, bottom: 88, left: 96 }
  const CX = PAD.left, CY = PAD.top, CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom
  const n = labels.length

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)
  title(ctx, W, 'Delay Minutes & Incident Count per Reporting Period')

  if (n === 0) { noData(ctx, W, H, 'No data yet'); return }

  const maxDelay = niceMax(Math.max(...delayVals, 1))
  const maxCount = niceMax(Math.max(...countVals, 1))
  const TICKS = 5

  for (let i = 0; i <= TICKS; i++) {
    const y = CY + CH - (i / TICKS) * CH
    ctx.strokeStyle = GRID; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX + CW, y); ctx.stroke()
    ctx.fillStyle = ORANGE; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(Math.round((i / TICKS) * maxDelay).toLocaleString(), CX - 8, y + 5)
    ctx.fillStyle = STEEL; ctx.textAlign = 'left'
    ctx.fillText(String(Math.round((i / TICKS) * maxCount)), CX + CW + 8, y + 5)
  }

  rotLabel(ctx, 'Delay (minutes)', 22, CY + CH / 2, ORANGE)
  ctx.save(); ctx.translate(W - 18, CY + CH / 2); ctx.rotate(Math.PI / 2)
  ctx.fillStyle = STEEL; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Incident Count', 0, 0); ctx.restore()

  xLabelsRotated(ctx, labels, n, CX, CY, CW, CH, Math.ceil(n / 12))

  const px = (i: number) => n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
  const pyD = (i: number) => CY + CH - (delayVals[i] / maxDelay) * CH
  const pyC = (i: number) => CY + CH - (countVals[i] / maxCount) * CH

  ctx.beginPath()
  ctx.moveTo(px(0), CY + CH)
  ctx.lineTo(px(0), pyD(0))
  for (let i = 1; i < n; i++) {
    const mx = (px(i - 1) + px(i)) / 2
    ctx.bezierCurveTo(mx, pyD(i - 1), mx, pyD(i), px(i), pyD(i))
  }
  ctx.lineTo(px(n - 1), CY + CH)
  ctx.closePath()
  ctx.fillStyle = 'rgba(224,82,6,0.10)'; ctx.fill()

  ctx.beginPath(); ctx.strokeStyle = ORANGE; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'
  bezierPath(ctx, n, px, pyD); ctx.stroke()
  ctx.beginPath(); ctx.strokeStyle = STEEL; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
  bezierPath(ctx, n, px, pyC); ctx.stroke(); ctx.setLineDash([])

  dots(ctx, n, px, pyD, ORANGE); dots(ctx, n, px, pyC, STEEL)

  ctx.strokeStyle = DARK; ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(CX, CY); ctx.lineTo(CX, CY + CH); ctx.lineTo(CX + CW, CY + CH)
  ctx.moveTo(CX + CW, CY); ctx.lineTo(CX + CW, CY + CH); ctx.stroke()

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
  labels: string[], values: number[], colors: string[], ttl: string,
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const PAD = { top: 68, right: 80, bottom: 36, left: 250 }
  const CX = PAD.left, CY = PAD.top, CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom
  const n = labels.length

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)
  title(ctx, W, ttl)

  if (n === 0) { noData(ctx, W, H, 'No data yet'); return }

  const maxVal = Math.max(...values, 1)
  for (let i = 1; i <= 5; i++) {
    const x = CX + (i / 5) * CW
    ctx.strokeStyle = GRID; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x, CY + CH); ctx.stroke()
    ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(String(Math.round((i / 5) * maxVal)), x, CY + CH + 20)
  }

  const rowH = CH / n, barPd = rowH * 0.18
  labels.forEach((label, i) => {
    const barY = CY + i * rowH + barPd, barH = rowH - 2 * barPd
    const barW = Math.max((values[i] / maxVal) * CW, 2)
    ctx.fillStyle = colors[i] + 'CC'; ctx.strokeStyle = colors[i]; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(CX, barY, barW, barH, 3); ctx.fill(); ctx.stroke()
    ctx.fillStyle = NAVY; ctx.font = 'bold 13px Arial, sans-serif'; ctx.textAlign = 'left'
    ctx.fillText(String(values[i]), CX + barW + 7, barY + barH / 2 + 5)
    ctx.fillStyle = DARK; ctx.font = '14px Arial, sans-serif'; ctx.textAlign = 'right'
    let lbl = label
    while (ctx.measureText(lbl).width > PAD.left - 18 && lbl.length > 5) lbl = lbl.slice(0, -4) + '…'
    ctx.fillText(lbl, CX - 10, barY + barH / 2 + 5)
  })

  axes(ctx, CX, CY, CW, CH)
}

// ─── Chart 4: vertical bar — incidents by hour of day ────────────────────────

function drawTimeOfDayChart(
  canvas: HTMLCanvasElement,
  byHour: number[],
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const PAD = { top: 68, right: 40, bottom: 52, left: 72 }
  const CX = PAD.left, CY = PAD.top, CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)
  title(ctx, W, 'Incident Distribution by Time of Day')

  const maxVal = niceMax(Math.max(...byHour, 1))
  yGridAndLabels(ctx, CX, CY, CW, CH, maxVal, 5)
  rotLabel(ctx, 'Incident Count', 18, CY + CH / 2, STEEL)

  // Colour top-5 busiest hours orange, rest steel
  const sorted = [...byHour].sort((a, b) => b - a)
  const threshold = sorted[4] ?? 0

  const barW = CW / 24
  const barPd = barW * 0.10

  byHour.forEach((count, hour) => {
    const bx = CX + hour * barW + barPd
    const bw = barW - 2 * barPd
    const bh = (count / maxVal) * CH
    const by = CY + CH - bh

    const isHot = count > 0 && count >= threshold
    ctx.fillStyle   = (isHot ? ORANGE : STEEL) + 'DD'
    ctx.strokeStyle = isHot ? ORANGE : STEEL
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.roundRect(bx, by, bw, Math.max(bh, 1), 2); ctx.fill(); ctx.stroke()

    // Count label above bar
    if (count > 0 && bh > 16) {
      ctx.fillStyle = NAVY; ctx.font = 'bold 12px Arial, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(String(count), bx + bw / 2, by - 4)
    }

    // Hour label every 3 hours
    if (hour % 3 === 0) {
      ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(`${String(hour).padStart(2,'0')}:00`, bx + bw / 2, CY + CH + 20)
    }
  })

  axes(ctx, CX, CY, CW, CH)

  // Legend
  const lx = CX + CW - 260, ly = CY + 14
  ctx.fillStyle = 'rgba(248,249,252,0.9)'; ctx.fillRect(lx - 8, ly - 14, 258, 28)
  ctx.fillStyle = ORANGE + 'DD'; ctx.fillRect(lx, ly - 6, 14, 14)
  ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText('Top 5 busiest hours', lx + 20, ly + 5)
}

// ─── Chart 5: single-line — average delay per incident ───────────────────────

function drawAvgDelayChart(
  canvas: HTMLCanvasElement,
  labels: string[], values: number[],
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const PAD = { top: 68, right: 40, bottom: 88, left: 96 }
  const CX = PAD.left, CY = PAD.top, CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom
  const n = labels.length

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)
  title(ctx, W, 'Average Delay per Incident per Reporting Period')

  if (n === 0) { noData(ctx, W, H, 'No data yet'); return }

  const maxVal = niceMax(Math.max(...values, 1))
  yGridAndLabels(ctx, CX, CY, CW, CH, maxVal, 5)
  rotLabel(ctx, 'Avg Delay (min / incident)', 22, CY + CH / 2, STEEL)
  xLabelsRotated(ctx, labels, n, CX, CY, CW, CH, Math.ceil(n / 12))

  const px = (i: number) => n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
  const py = (i: number) => CY + CH - (values[i] / maxVal) * CH

  ctx.beginPath()
  ctx.moveTo(px(0), CY + CH)
  ctx.lineTo(px(0), py(0))
  for (let i = 1; i < n; i++) {
    const mx = (px(i - 1) + px(i)) / 2
    ctx.bezierCurveTo(mx, py(i - 1), mx, py(i), px(i), py(i))
  }
  ctx.lineTo(px(n - 1), CY + CH)
  ctx.closePath()
  ctx.fillStyle = 'rgba(74,111,165,0.12)'; ctx.fill()

  ctx.beginPath(); ctx.strokeStyle = STEEL; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'
  bezierPath(ctx, n, px, py); ctx.stroke()
  dots(ctx, n, px, py, STEEL)
  axes(ctx, CX, CY, CW, CH)
}

// ─── Chart 6: stacked bar — safety-critical category evolution ────────────────

function drawStackedBarChart(
  canvas: HTMLCanvasElement,
  dateLabels: string[],
  datasets: Array<{ label: string; color: string; values: number[] }>,
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  // Extra top padding for legend row between title and chart
  const PAD = { top: 92, right: 40, bottom: 72, left: 72 }
  const CX = PAD.left, CY = PAD.top, CW = W - PAD.left - PAD.right, CH = H - PAD.top - PAD.bottom
  const n = dateLabels.length

  ctx.fillStyle = OFFWHT; ctx.fillRect(0, 0, W, H)
  title(ctx, W, 'Safety-Critical Incident Categories over Time')

  // Legend (between title and chart area)
  const activeDS = datasets.filter(ds => ds.values.some(v => v > 0))
  if (activeDS.length > 0) {
    const legItemW = Math.floor((W - 80) / activeDS.length)
    const legY = 60
    activeDS.forEach((ds, i) => {
      const lx = 40 + i * legItemW
      ctx.fillStyle = ds.color; ctx.fillRect(lx, legY - 6, 14, 14)
      ctx.fillStyle = DARK; ctx.font = '13px Arial, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(ds.label, lx + 18, legY + 6)
    })
  }

  if (n === 0) { noData(ctx, W, CY + CH / 2 + PAD.top, 'No safety-critical incidents recorded yet'); return }

  const totals = dateLabels.map((_, i) => datasets.reduce((s, ds) => s + ds.values[i], 0))
  const maxTotal = niceMax(Math.max(...totals, 1))
  const ticks = Math.min(5, maxTotal)

  yGridAndLabels(ctx, CX, CY, CW, CH, maxTotal, ticks)
  rotLabel(ctx, 'Safety-Critical Incidents', 18, CY + CH / 2, STEEL)

  const barW = CW / n
  const barPd = Math.max(barW * 0.12, 2)

  dateLabels.forEach((label, i) => {
    const bx = CX + i * barW + barPd
    const bw = Math.max(barW - 2 * barPd, 1)
    let stackY = CY + CH

    datasets.forEach(ds => {
      const segH = (ds.values[i] / maxTotal) * CH
      if (segH < 0.5) return
      stackY -= segH
      ctx.fillStyle = ds.color
      ctx.fillRect(bx, stackY, bw, segH)
    })

    // X label (skip for density)
    if (i % Math.ceil(n / 15) === 0 || i === n - 1) {
      ctx.save(); ctx.translate(bx + bw / 2, CY + CH + 12); ctx.rotate(-Math.PI / 5)
      ctx.fillStyle = DARK; ctx.font = '12px Arial, sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(label, 0, 0); ctx.restore()
    }
  })

  axes(ctx, CX, CY, CW, CH)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderHistoricalCharts(
  data: HistoricalChartData
): Promise<ChartImages> {
  if (typeof window === 'undefined') {
    throw new Error('renderHistoricalCharts must be called in a browser context')
  }

  const trend = data.trendPoints.slice(-30)
  const trendLabels = trend.map(p => shortDate(p.date))

  // ── Page 1 charts ────────────────────────────────────────────────────────

  // Chart 1: dual-line delay + incident count
  const c1 = document.createElement('canvas'); c1.width = CW; c1.height = H_TREND
  drawDualLineChart(c1, trendLabels, trend.map(p => p.totalDelay), trend.map(p => p.incidentCount))

  // Chart 2: incident type distribution
  const c2 = document.createElement('canvas'); c2.width = CW; c2.height = H_BAR
  const cats = data.categoryBreakdown
  drawHorizBarChart(c2, cats.map(c => c.label), cats.map(c => c.count), cats.map(c => c.color),
    'Incident Type Distribution (All Reporting Periods)')

  // Chart 3: top locations
  const c3 = document.createElement('canvas'); c3.width = CW; c3.height = H_BAR
  const locs = data.locationBreakdown
  drawHorizBarChart(c3, locs.map(l => l.location), locs.map(l => l.count), locs.map(() => STEEL),
    'Top Locations by Incident Count (All Reporting Periods)')

  // ── Page 2 charts ────────────────────────────────────────────────────────

  // Chart 4: time of day
  const c4 = document.createElement('canvas'); c4.width = CW; c4.height = H_TIME
  drawTimeOfDayChart(c4, data.timeOfDayBreakdown)

  // Chart 5: average delay per incident
  const c5 = document.createElement('canvas'); c5.width = CW; c5.height = H_TIME
  const avgDelayVals = trend.map(p => p.incidentCount > 0 ? Math.round(p.totalDelay / p.incidentCount) : 0)
  drawAvgDelayChart(c5, trendLabels, avgDelayVals)

  // Chart 6: safety-critical stacked bar
  const safeTrend = data.safetyCategoryTrend
  const safeLabels = safeTrend.map(p => shortDate(p.date))
  const safeDatasets = SAFETY_CATS.map(cat => ({
    label: cat.label,
    color: cat.color,
    values: safeTrend.map(p => p.counts[cat.key] ?? 0),
  }))
  const c6 = document.createElement('canvas'); c6.width = CW; c6.height = H_BAR
  drawStackedBarChart(c6, safeLabels, safeDatasets)

  return {
    delayTrend:          c1.toDataURL('image/png'),
    categoryBreakdown:   c2.toDataURL('image/png'),
    topLocations:        c3.toDataURL('image/png'),
    timeOfDay:           c4.toDataURL('image/png'),
    avgDelayTrend:       c5.toDataURL('image/png'),
    safetyCategoryTrend: c6.toDataURL('image/png'),
    reportCount:         data.reportCount,
  }
}

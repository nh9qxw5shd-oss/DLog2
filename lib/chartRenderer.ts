'use client'

import type { HistoricalChartData } from './supabaseClient'

export interface ChartImages {
  delayTrend:        string  // PNG data URL — line chart: delay per report date
  categoryBreakdown: string  // PNG data URL — horizontal bar: incident count by type
  reportCount:       number
}

// ─── Canvas dimensions ────────────────────────────────────────────────────────
const CANVAS_W      = 1400
const CANVAS_H_LINE = 440
const CANVAS_H_BAR  = 520

// ─── Brand colours ────────────────────────────────────────────────────────────
const NAVY   = '#001F45'
const ORANGE = '#E05206'
const STEEL  = '#4A6FA5'
const DARK   = '#2C3E50'
const OFFWHT = '#F8F9FC'
const GRID   = 'rgba(0,0,0,0.08)'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${parseInt(dd)} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mm)]}`
}

function niceMax(v: number): number {
  if (v <= 0) return 100
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  return Math.ceil(v / mag) * mag
}

// ─── Line chart (delay over time) ────────────────────────────────────────────

function drawLineChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  values: number[],
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const PAD = { top: 64, right: 40, bottom: 90, left: 90 }
  const CX = PAD.left, CY = PAD.top
  const CW = W - PAD.left - PAD.right
  const CH = H - PAD.top - PAD.bottom
  const n = values.length

  // Background
  ctx.fillStyle = OFFWHT
  ctx.fillRect(0, 0, W, H)

  // Title
  ctx.fillStyle = NAVY
  ctx.font = 'bold 22px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Total Delay Minutes per Reporting Period', W / 2, 42)

  if (n === 0) {
    ctx.fillStyle = DARK
    ctx.font = '18px Arial, sans-serif'
    ctx.fillText('No data available', W / 2, CY + CH / 2)
    return
  }

  const maxVal = niceMax(Math.max(...values))
  const YTICKS = 5

  // Gridlines + y-axis labels
  for (let i = 0; i <= YTICKS; i++) {
    const y = CY + CH - (i / YTICKS) * CH
    const val = Math.round((i / YTICKS) * maxVal)
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(CX, y); ctx.lineTo(CX + CW, y); ctx.stroke()
    ctx.fillStyle = DARK
    ctx.font = '14px Arial, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(val.toLocaleString(), CX - 10, y + 5)
  }

  // Y-axis title
  ctx.save()
  ctx.translate(22, CY + CH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = STEEL
  ctx.font = '14px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Delay (minutes)', 0, 0)
  ctx.restore()

  // X-axis labels (skip if too many to fit)
  const xSkip = Math.ceil(n / 12)
  labels.forEach((label, i) => {
    if (i % xSkip !== 0 && i !== n - 1) return
    const x = n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
    ctx.save()
    ctx.translate(x, CY + CH + 14)
    ctx.rotate(-Math.PI / 5)
    ctx.fillStyle = DARK
    ctx.font = '13px Arial, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(label, 0, 0)
    ctx.restore()
  })

  const px = (i: number) => n === 1 ? CX + CW / 2 : CX + (i / (n - 1)) * CW
  const py = (v: number) => CY + CH - (v / maxVal) * CH

  // Fill
  ctx.beginPath()
  ctx.moveTo(px(0), CY + CH)
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.lineTo(px(0), py(values[0]))
    else {
      // Smooth curve via cubic bezier
      const x0 = px(i - 1), y0 = py(values[i - 1])
      const x1 = px(i),     y1 = py(values[i])
      const cpX = (x0 + x1) / 2
      ctx.bezierCurveTo(cpX, y0, cpX, y1, x1, y1)
    }
  }
  ctx.lineTo(px(n - 1), CY + CH)
  ctx.closePath()
  ctx.fillStyle = 'rgba(224,82,6,0.12)'
  ctx.fill()

  // Line
  ctx.beginPath()
  ctx.strokeStyle = ORANGE
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      ctx.moveTo(px(0), py(values[0]))
    } else {
      const x0 = px(i - 1), y0 = py(values[i - 1])
      const x1 = px(i),     y1 = py(values[i])
      const cpX = (x0 + x1) / 2
      ctx.bezierCurveTo(cpX, y0, cpX, y1, x1, y1)
    }
  }
  ctx.stroke()

  // Points
  for (let i = 0; i < n; i++) {
    const x = px(i), y = py(values[i])
    ctx.beginPath()
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = ORANGE
    ctx.fill()
    ctx.strokeStyle = NAVY
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Axes
  ctx.strokeStyle = DARK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(CX, CY)
  ctx.lineTo(CX, CY + CH)
  ctx.lineTo(CX + CW, CY + CH)
  ctx.stroke()
}

// ─── Horizontal bar chart (category distribution) ────────────────────────────

function drawBarChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  values: number[],
  colors: string[],
): void {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const PAD = { top: 64, right: 80, bottom: 36, left: 240 }
  const CX = PAD.left, CY = PAD.top
  const CW = W - PAD.left - PAD.right
  const CH = H - PAD.top - PAD.bottom
  const n = labels.length

  // Background
  ctx.fillStyle = OFFWHT
  ctx.fillRect(0, 0, W, H)

  // Title
  ctx.fillStyle = NAVY
  ctx.font = 'bold 22px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Incident Type Distribution (All Reporting Periods)', W / 2, 42)

  if (n === 0) {
    ctx.fillStyle = DARK
    ctx.font = '18px Arial, sans-serif'
    ctx.fillText('No data available', W / 2, CY + CH / 2)
    return
  }

  const maxVal = Math.max(...values, 1)
  const XTICKS = 5

  // X gridlines + labels
  for (let i = 1; i <= XTICKS; i++) {
    const x = CX + (i / XTICKS) * CW
    const val = Math.round((i / XTICKS) * maxVal)
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, CY); ctx.lineTo(x, CY + CH); ctx.stroke()
    ctx.fillStyle = DARK
    ctx.font = '13px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(val), x, CY + CH + 20)
  }

  const rowH  = CH / n
  const barPad = rowH * 0.18

  labels.forEach((label, i) => {
    const barY = CY + i * rowH + barPad
    const barH = rowH - 2 * barPad
    const barW = Math.max((values[i] / maxVal) * CW, 2)

    // Bar
    ctx.fillStyle   = colors[i] + 'CC'
    ctx.strokeStyle = colors[i]
    ctx.lineWidth   = 1.5
    ctx.beginPath()
    ctx.roundRect(CX, barY, barW, barH, 3)
    ctx.fill()
    ctx.stroke()

    // Count label (right of bar)
    ctx.fillStyle  = NAVY
    ctx.font       = 'bold 14px Arial, sans-serif'
    ctx.textAlign  = 'left'
    ctx.fillText(String(values[i]), CX + barW + 7, barY + barH / 2 + 5)

    // Category label (left of chart)
    ctx.fillStyle  = DARK
    ctx.font       = '14px Arial, sans-serif'
    ctx.textAlign  = 'right'
    // Truncate if too wide
    let lbl = label
    while (ctx.measureText(lbl).width > PAD.left - 16 && lbl.length > 5) {
      lbl = lbl.slice(0, -4) + '…'
    }
    ctx.fillText(lbl, CX - 10, barY + barH / 2 + 5)
  })

  // Y axis
  ctx.strokeStyle = DARK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(CX, CY)
  ctx.lineTo(CX, CY + CH)
  ctx.stroke()
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderHistoricalCharts(
  data: HistoricalChartData
): Promise<ChartImages> {
  if (typeof window === 'undefined') {
    throw new Error('renderHistoricalCharts must be called in a browser context')
  }

  const trend = data.trendPoints.slice(-30)

  // ── Chart 1: delay trend line ─────────────────────────────────────────────
  const canvas1 = document.createElement('canvas')
  canvas1.width  = CANVAS_W
  canvas1.height = CANVAS_H_LINE
  drawLineChart(
    canvas1,
    trend.map(p => shortDate(p.date)),
    trend.map(p => p.totalDelay),
  )
  const delayTrend = canvas1.toDataURL('image/png')

  // ── Chart 2: category bar ─────────────────────────────────────────────────
  const canvas2 = document.createElement('canvas')
  canvas2.width  = CANVAS_W
  canvas2.height = CANVAS_H_BAR
  const cats = data.categoryBreakdown
  drawBarChart(
    canvas2,
    cats.map(c => c.label),
    cats.map(c => c.count),
    cats.map(c => c.color),
  )
  const categoryBreakdown = canvas2.toDataURL('image/png')

  return { delayTrend, categoryBreakdown, reportCount: data.reportCount }
}

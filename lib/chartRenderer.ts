'use client'

import type { HistoricalChartData } from './supabaseClient'

export interface ChartImages {
  delayTrend:        string  // PNG data URL — line chart: delay per report date
  categoryBreakdown: string  // PNG data URL — horizontal bar: incident count by type
  reportCount:       number
}

// ─── Canvas dimensions (rendered at high pixel density for crisp PDF embed) ──
const CANVAS_W = 1400
const CANVAS_H_LINE = 400
const CANVAS_H_BAR  = 500

// ─── Brand colours matching pdfGenerator ─────────────────────────────────────
const NAVY   = 'rgb(0, 31, 69)'
const ORANGE = 'rgb(224, 82, 6)'
const BLUE   = 'rgb(0, 51, 102)'
const STEEL  = 'rgb(74, 111, 165)'
const DARK   = 'rgb(44, 62, 80)'
const LIGHT  = 'rgb(248, 249, 252)'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${parseInt(dd)} ${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mm)]}`
}

// Import Chart.js components explicitly — avoids the TDZ bug triggered by the
// chart.js/auto barrel file in Next.js's webpack bundler.
async function loadChart() {
  const {
    Chart,
    CategoryScale, LinearScale,
    PointElement, LineElement,
    BarElement,
    Title, Tooltip, Legend, Filler,
  } = await import('chart.js')

  Chart.register(
    CategoryScale, LinearScale,
    PointElement, LineElement,
    BarElement,
    Title, Tooltip, Legend, Filler,
  )

  return Chart
}

type ChartConstructor = Awaited<ReturnType<typeof loadChart>>

async function renderChart(
  Chart: ChartConstructor,
  canvas: HTMLCanvasElement,
  config: object
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const chart = new Chart(canvas, {
        ...(config as any),
        options: {
          ...((config as any).options ?? {}),
          animation: {
            duration: 0,
            onComplete: () => {
              const dataUrl = canvas.toDataURL('image/png')
              chart.destroy()
              resolve(dataUrl)
            },
          },
        },
      })
    } catch (err) {
      reject(err)
    }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderHistoricalCharts(
  data: HistoricalChartData
): Promise<ChartImages> {
  if (typeof window === 'undefined') {
    throw new Error('renderHistoricalCharts must be called in a browser context')
  }

  // Load Chart.js once; both renders share the same registered instance
  const Chart = await loadChart()

  // ── Chart 1: Delay minutes over time (line) ───────────────────────────────
  const canvas1 = document.createElement('canvas')
  canvas1.width  = CANVAS_W
  canvas1.height = CANVAS_H_LINE

  // Limit to most recent 30 data points to keep the chart readable
  const trend = data.trendPoints.slice(-30)

  const delayTrend = await renderChart(Chart, canvas1, {
    type: 'line',
    data: {
      labels: trend.map(p => shortDate(p.date)),
      datasets: [
        {
          label: 'Total Delay (min)',
          data:  trend.map(p => p.totalDelay),
          borderColor:           ORANGE,
          backgroundColor:       'rgba(224, 82, 6, 0.12)',
          borderWidth:           2.5,
          pointBackgroundColor:  ORANGE,
          pointBorderColor:      NAVY,
          pointRadius:           4,
          pointHoverRadius:      6,
          tension:               0.3,
          fill:                  true,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: {
          display:  true,
          text:     'Total Delay Minutes per Reporting Period',
          color:    NAVY,
          font:     { size: 18, weight: 'bold', family: 'Arial, sans-serif' },
          padding:  { bottom: 16 },
        },
      },
      scales: {
        x: {
          ticks: {
            color:      DARK,
            font:       { size: 12, family: 'Arial, sans-serif' },
            maxRotation: 45,
          },
          grid: { color: 'rgba(0,0,0,0.07)' },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: DARK,
            font:  { size: 12, family: 'Arial, sans-serif' },
          },
          grid:  { color: 'rgba(0,0,0,0.07)' },
          title: {
            display: true,
            text:    'Delay (minutes)',
            color:   STEEL,
            font:    { size: 12, family: 'Arial, sans-serif' },
          },
        },
      },
    },
  })

  // ── Chart 2: Incident type distribution (horizontal bar) ──────────────────
  const canvas2 = document.createElement('canvas')
  canvas2.width  = CANVAS_W
  canvas2.height = CANVAS_H_BAR

  // Show all categories that appear in the data (already sorted desc by count)
  const cats = data.categoryBreakdown

  const categoryBreakdown = await renderChart(Chart, canvas2, {
    type: 'bar',
    data: {
      labels: cats.map(c => c.label),
      datasets: [
        {
          label:           'Incidents',
          data:            cats.map(c => c.count),
          backgroundColor: cats.map(c => c.color + 'CC'),
          borderColor:     cats.map(c => c.color),
          borderWidth:     1.5,
          borderRadius:    3,
        },
      ],
    },
    options: {
      responsive:  false,
      indexAxis:   'y' as const,
      plugins: {
        legend: { display: false },
        title: {
          display:  true,
          text:     'Incident Type Distribution (All Reporting Periods)',
          color:    NAVY,
          font:     { size: 18, weight: 'bold', family: 'Arial, sans-serif' },
          padding:  { bottom: 16 },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: DARK,
            font:  { size: 12, family: 'Arial, sans-serif' },
          },
          grid:  { color: 'rgba(0,0,0,0.07)' },
          title: {
            display: true,
            text:    'Number of Incidents',
            color:   STEEL,
            font:    { size: 12, family: 'Arial, sans-serif' },
          },
        },
        y: {
          ticks: {
            color: DARK,
            font:  { size: 11, family: 'Arial, sans-serif' },
          },
          grid: { display: false },
        },
      },
    },
  })

  return { delayTrend, categoryBreakdown, reportCount: data.reportCount }
}

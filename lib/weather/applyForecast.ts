// ─── Forecast → look-ahead grid ───────────────────────────────────────────────
//
// Aligns a parsed Route 7 Day Forecast onto the log's look-ahead (seven
// columns, today first) by DATE, not by row position, so yesterday's issue
// dropped in by mistake fills the six days it still covers and leaves the
// seventh empty with a warning instead of shifting everything by a day.

import type { ForecastDocument, ForecastDay } from './forecastTypes'
import { FORECAST_AREA_KEYS, forecastAreaMeta, addDaysIso } from './forecastTypes'
import type { DayWeather, LookAheadWeather } from '../types'
import { LOOK_AHEAD_DAYS, makeEmptyLookAheadWeather } from '../types'

export interface ForecastApplication {
  weather: LookAheadWeather
  /** Look-ahead column dates, today first. */
  dates: string[]
  /** Human-readable notes about the alignment (stale issue, missing area…). */
  notes: string[]
}

function dayToCell(d: ForecastDay): DayWeather {
  return {
    risks: { ...d.risks },
    temps: {
      minMorning: d.temps.minMorning.value,
      max:        d.temps.max.value,
      minNight:   d.temps.minNight.value,
    },
  }
}

/**
 * @param anchorDate  YYYY-MM-DD of look-ahead column 0 (today, London time).
 * @param existing    Current grid — cells for dates the forecast does not
 *                    cover are kept, so a partial forecast never blanks work.
 */
export function applyForecast(
  forecast: ForecastDocument,
  anchorDate: string,
  existing?: LookAheadWeather,
): ForecastApplication {
  const weather = existing ? cloneGrid(existing) : makeEmptyLookAheadWeather()
  const dates: string[] = []
  for (let i = 0; i < LOOK_AHEAD_DAYS; i++) dates.push(addDaysIso(anchorDate, i))
  const notes: string[] = []

  if (forecast.validFromDate && forecast.validFromDate !== anchorDate) {
    notes.push(`Forecast is valid from ${forecast.validFromDate}, but the look-ahead starts ${anchorDate}; days were matched by date.`)
  }

  const seen: string[] = []
  for (let a = 0; a < forecast.areas.length; a++) {
    const area = forecast.areas[a]
    const key = area.key as keyof LookAheadWeather
    if (FORECAST_AREA_KEYS.indexOf(key as any) < 0) {
      notes.push(`Area "${area.name}" is not one of the four look-ahead areas and was not applied.`)
      continue
    }
    seen.push(key)
    let applied = 0
    for (let i = 0; i < dates.length; i++) {
      let match: ForecastDay | null = null
      for (let d = 0; d < area.days.length; d++) {
        if (area.days[d].date === dates[i]) { match = area.days[d]; break }
      }
      if (match) { weather[key][i] = dayToCell(match); applied++ }
    }
    if (applied < LOOK_AHEAD_DAYS) {
      notes.push(`${forecastAreaMeta(key)?.label ?? area.name}: forecast covers ${applied} of the ${LOOK_AHEAD_DAYS} look-ahead days.`)
    }
  }
  for (let k = 0; k < FORECAST_AREA_KEYS.length; k++) {
    if (seen.indexOf(FORECAST_AREA_KEYS[k]) < 0) {
      notes.push(`${forecastAreaMeta(FORECAST_AREA_KEYS[k])?.label}: not present in the forecast; cells left as they were.`)
    }
  }
  return { weather, dates, notes }
}

export function cloneGrid(grid: LookAheadWeather): LookAheadWeather {
  const out = makeEmptyLookAheadWeather()
  for (let k = 0; k < FORECAST_AREA_KEYS.length; k++) {
    const key = FORECAST_AREA_KEYS[k]
    const src = grid[key] || []
    for (let i = 0; i < LOOK_AHEAD_DAYS; i++) {
      const d = src[i]
      out[key][i] = d ? { risks: { ...d.risks }, temps: d.temps ? { ...d.temps } : undefined } : { risks: {} }
    }
  }
  return out
}

/** "Issued 18-09-2026 02:54 BST by James Parrish" for headers and footers. */
export function describeIssue(f: ForecastDocument | null | undefined): string {
  if (!f) return ''
  const parts: string[] = []
  if (f.issuedAtText) parts.push('Issued ' + f.issuedAtText.replace(/:\d{2}\s+(?=[A-Z]{2,5}\b)/, ' '))
  else if (f.issuedAt) parts.push('Issued ' + f.issuedAt)
  return parts.join(' · ')
}

/** Hash of the bytes so the same PDF is never stored twice. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string | null> {
  try {
    const subtle = (globalThis as any).crypto?.subtle
    if (!subtle) return null
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
    const digest = await subtle.digest('SHA-256', buf)
    const bytes = new Uint8Array(digest)
    let hex = ''
    for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)
    return hex
  } catch {
    return null
  }
}

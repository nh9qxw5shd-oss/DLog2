'use client'

// ─── Test Mode ────────────────────────────────────────────────────────────────
// A global, per-browser switch that lets an operator run the whole flow
// (upload → roster → weather → review → generate) exactly as for a real log,
// but with every database WRITE suppressed at the Generate step:
//   • no reports / incidents / incident_team_members / weather_lookahead upsert
//   • no ESR snapshot persisted (the NRSDB pull still happens so the PDF
//     section renders; the route is told dryRun and writes nothing)
//   • bulk historical import disabled
// Reads (continuation lookup, historical charts, ESR baseline) still run so
// the PDF is representative. The PDF itself is watermarked TEST and saved
// with a _TEST suffix so it cannot be mistaken for a real log.
//
// Persisted in localStorage so it survives navigation between pages and
// reloads, and broadcast across tabs via the storage event.

import { useEffect, useState, useCallback } from 'react'

const KEY = 'dlog2:test-mode'

export function readTestMode(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(KEY) === '1' }
  catch { return false }
}

export function writeTestMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
    // storage events don't fire in the tab that made the change
    window.dispatchEvent(new CustomEvent('dlog2:test-mode', { detail: on }))
  } catch { /* private mode etc — toggle just won't persist */ }
}

// Hydration-safe: always false on first render, then reads localStorage.
export function useTestMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false)

  useEffect(() => {
    setOn(readTestMode())
    const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) setOn(readTestMode()) }
    const onLocal   = (e: Event) => setOn(!!(e as CustomEvent<boolean>).detail)
    window.addEventListener('storage', onStorage)
    window.addEventListener('dlog2:test-mode', onLocal)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('dlog2:test-mode', onLocal)
    }
  }, [])

  const set = useCallback((next: boolean) => { writeTestMode(next); setOn(next) }, [])
  return [on, set]
}

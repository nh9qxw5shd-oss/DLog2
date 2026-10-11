'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'

// ─── Live sync of localStorage-backed state ──────────────────────────────────
// DLog2 can be open in several places at once: a standalone tab, a frame
// inside the Derby Control hub (whose storage bridge mirrors the `dlog2*` keys
// between the hub's origin and this one) and other tabs. A write in any of
// them lands in this origin's localStorage, but a component that read the key
// once on mount keeps its stale copy and its next save would put that copy
// back over the newer value. These helpers re-read on the browser's "storage"
// event — fired in every other document of the origin when a key changes — so
// the most recent write wins everywhere.
//
// Applying an incoming value must only set React state, never write it back:
// the value is already in storage, and writing it again would be redundant.

/** Calls `onChange` with the key's current value whenever another document
 *  changes it (or clears storage). Returns the unsubscribe function. */
export function subscribeStorageKey(key: string, onChange: (value: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => {
    if (e.key !== null && e.key !== key) return
    try {
      if (e.storageArea !== window.localStorage) return
      onChange(window.localStorage.getItem(key))
    } catch { /* storage unavailable */ }
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/** Keeps an incoming value off a text field while the user is typing in it.
 *  Attach `ref` to the field and call `onBlur` from its blur handler and
 *  `edited` from its onChange. `receive(v)` applies `v` at once unless the
 *  field has focus; then it is held until blur, and dropped if the user edits
 *  the field first (their edit is the more recent write). While a value is
 *  held, storage already has it, so the component should not save its own
 *  stale copy over it. */
export function useFocusSafe<T, E extends HTMLElement = HTMLInputElement>(apply: (value: T) => void) {
  const ref = useRef<E>(null)
  const held = useRef<{ value: T } | null>(null)
  const latest = useRef(apply)
  useEffect(() => { latest.current = apply })

  const receive = useCallback((value: T) => {
    // A field left focused in a background tab or frame is not being typed in
    // (it got a blur when the window lost focus), so it takes the value at once.
    const typing = !!ref.current && typeof document !== 'undefined'
      && document.activeElement === ref.current && document.hasFocus()
    if (typing) held.current = { value }
    else { held.current = null; latest.current(value) }
  }, [])
  const onBlur = useCallback(() => {
    const h = held.current
    held.current = null
    if (h) latest.current(h.value)
  }, [])
  const edited = useCallback(() => { held.current = null }, [])
  /** True while an incoming value is waiting for the field to lose focus. */
  const holding = useCallback(() => held.current !== null, [])

  // Stable identity, so it can sit in effect dependency lists.
  return useMemo(() => ({ ref, receive, onBlur, edited, holding }), [receive, onBlur, edited, holding])
}

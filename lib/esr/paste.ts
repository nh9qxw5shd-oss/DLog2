// ─── Pasted NRSDB feed validation (client-safe, pure) ─────────────────────────
// nrsdb.uk blocks logins from hosted servers, so on production the operator
// supplies the ESR feed themselves: open the feed address in a tab where they
// are logged in to NRSDB, select all, copy, paste into DLog2. People will
// paste the wrong thing, so this classifies the paste and says exactly what to
// do about it BEFORE anything is sent to the server.

import { extractEsrList } from './diff'

export const NRSDB_FEED_URL = (routeCode = 'EM', filter = 'imposed') =>
  `https://nrsdb.uk/ajax/get.php?r=getEsrsByRouteCode&routecode=${encodeURIComponent(routeCode)}&filter=${encodeURIComponent(filter)}`

export type PasteProblem =
  | 'empty' | 'login_page' | 'html' | 'tree_view' | 'not_json' | 'not_list' | 'no_esrs' | 'not_esrs' | 'wrong_route' | 'truncated'

export type PasteParse =
  | { ok: true; payload: unknown[]; count: number; routeCodes: string[] }
  | { ok: false; problem: PasteProblem; message: string }

const bad = (problem: PasteProblem, message: string): PasteParse => ({ ok: false, problem, message })

function looksLikeHtml(s: string): boolean {
  return /^\s*<!doctype html|^\s*<html|<form[\s>]|<body[\s>]/i.test(s)
}

function tryJson(s: string): unknown | undefined {
  try { return JSON.parse(s) } catch { return undefined }
}

export function parsePastedFeed(text: string, expectedRoute?: string): PasteParse {
  const raw = (text ?? '').replace(/^﻿/, '')
  const s = raw.trim()
  if (!s) return bad('empty', 'Nothing was pasted. In the NRSDB tab press Ctrl+A then Ctrl+C, come back here and click Paste again.')

  if (looksLikeHtml(s)) {
    if (/login|password|sign in/i.test(s)) {
      return bad('login_page', 'That was the NRSDB login page, so you are not logged in to NRSDB in that browser. Log in to nrsdb.uk, then click "Open NRSDB feed" again and copy the data it shows.')
    }
    return bad('html', 'That was a web page, not the ESR data. Click "Open NRSDB feed", wait for the tab to show the raw data (it starts with {"count":), then Ctrl+A, Ctrl+C.')
  }

  let parsed = tryJson(s)
  if (parsed === undefined) {
    // The real feed is {"count":…,"data":[…]}. A copy that starts like JSON
    // but does not end like it was cut off — say so before trying any
    // inner-block salvage, which could otherwise "succeed" on a nested array.
    const startsJson = s.startsWith('{') || s.startsWith('[')
    const endsJson = s.endsWith('}') || s.endsWith(']')
    if (startsJson && !endsJson) {
      return bad('truncated', 'The paste is cut off — the data starts correctly but does not end with } or ]. Go back to the NRSDB tab, press Ctrl+A (select ALL) then Ctrl+C, and paste again.')
    }
    // Browser JSON viewers sometimes wrap the text, or the copy picked up a
    // header line. Try the outermost {...} block, then the outermost [...].
    const oa = s.indexOf('{'), ob = s.lastIndexOf('}')
    if (oa >= 0 && ob > oa) parsed = tryJson(s.slice(oa, ob + 1))
    if (parsed === undefined) {
      const a = s.indexOf('['), b = s.lastIndexOf(']')
      if (a >= 0 && b > a) parsed = tryJson(s.slice(a, b + 1))
    }
  }
  if (parsed === undefined) {
    // Firefox/Edge "tree" viewers copy as "id 123 refnum EM 061.26" lines.
    if (/^\s*(id|refnum|count|data)\s*[:\t ]/im.test(s) || /\n\s*\d+\s*\n/.test(s)) {
      return bad('tree_view', 'The browser copied its formatted tree view rather than the raw data. In the NRSDB tab click "Raw Data" (Firefox) or untick "Pretty-print" (Edge/Chrome), then Ctrl+A, Ctrl+C and paste again.')
    }
    return bad('not_json', 'Could not read that as NRSDB data. Click "Open NRSDB feed", press Ctrl+A then Ctrl+C in the tab that opens, come back and click Paste.')
  }

  const list = extractEsrList(parsed)
  if (!list) return bad('not_list', 'That is valid data but not an ESR list. Make sure the tab address ends with r=getEsrsByRouteCode… and copy the whole page.')
  if (list.length === 0) return bad('no_esrs', 'The feed contained no ESRs. Check the tab address still has routecode=EM and filter=imposed, and that NRSDB is showing restrictions for the route.')

  const items = list.filter(x => x && typeof x === 'object') as Record<string, unknown>[]
  const withRef = items.filter(x => typeof x.refnum === 'string' && (x.refnum as string).trim())
  if (withRef.length === 0) return bad('not_esrs', 'That list has no ESR reference numbers in it, so it is not the ESR feed. Use the "Open NRSDB feed" button to get the right address.')

  const routeCodes = Array.from(new Set(items.map(x => {
    const r = x.route as Record<string, unknown> | undefined
    return typeof r?.routecode === 'string' ? (r.routecode as string).toUpperCase() : null
  }).filter((v): v is string => !!v)))
  if (expectedRoute && routeCodes.length > 0 && !routeCodes.includes(expectedRoute.toUpperCase())) {
    return bad('wrong_route', `That feed is for route ${routeCodes.join('/')}, not ${expectedRoute.toUpperCase()}. Click "Open NRSDB feed" so the correct route address is used.`)
  }

  return { ok: true, payload: list, count: withRef.length, routeCodes }
}

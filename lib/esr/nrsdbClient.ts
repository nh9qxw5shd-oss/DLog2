// ─── NRSDB session-cookie client (server-side only) ───────────────────────────
// Logs in to nrsdb.uk with the configured account's own credentials, keeps
// the resulting session cookies, and calls getEsrsByRouteCode — exactly what
// a user does via the site's export button, automated. Re-authenticates once
// if the session has expired mid-run.
//
// Runs only inside the Next.js route handler (app/api/esr/snapshot). Never
// import from client code: it needs the credentials in process.env and Node's
// fetch. Ported from the nrsdb-esr-sync reference script (nrsdb_client.py);
// Node's fetch has no cookie jar so a minimal one is implemented here.

const BASE_URL  = 'https://nrsdb.uk'
const LOGIN_URL = `${BASE_URL}/login.php`
const ESR_URL   = `${BASE_URL}/ajax/get.php`
const TIMEOUT_MS = 20_000

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
  'Accept-Language': 'en-GB,en;q=0.9,en-US;q=0.8',
}

export class NrsdbAuthError extends Error {
  constructor(message: string) { super(message); this.name = 'NrsdbAuthError' }
}
export class NrsdbFetchError extends Error {
  constructor(message: string) { super(message); this.name = 'NrsdbFetchError' }
}
export class NrsdbPayloadError extends Error {
  constructor(message: string) { super(message); this.name = 'NrsdbPayloadError' }
}

// ── Cookie jar ───────────────────────────────────────────────────────────────

function readSetCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof h.getSetCookie === 'function') return h.getSetCookie()
  const raw = headers.get('set-cookie')
  if (!raw) return []
  // Fallback for runtimes that fold multiple Set-Cookie headers into one
  // string: split on commas that start a new `name=` pair (not the comma in
  // an Expires date).
  return raw.split(/,(?=\s*[^;,\s]+=)/).map(s => s.trim()).filter(Boolean)
}

class CookieJar {
  private cookies = new Map<string, string>()

  absorb(headers: Headers) {
    for (const sc of readSetCookies(headers)) {
      const first = sc.split(';', 1)[0]
      const eq = first.indexOf('=')
      if (eq <= 0) continue
      const name = first.slice(0, eq).trim()
      const value = first.slice(eq + 1).trim()
      const attrs = sc.toLowerCase()
      const expired = /max-age=(-\d+|0)\b/.test(attrs) || /expires=thu, 01 jan 1970/.test(attrs)
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header(): string | null {
    if (this.cookies.size === 0) return null
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  }

  get size() { return this.cookies.size }
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface NrsdbClientOptions {
  email: string
  password: string
}

export class NrsdbClient {
  private jar = new CookieJar()
  private readonly email: string
  private readonly password: string

  constructor(opts: NrsdbClientOptions) {
    if (!opts.email || !opts.password) throw new NrsdbAuthError('NRSDB email/password not provided.')
    this.email = opts.email
    this.password = opts.password
  }

  private async request(url: string, init: RequestInit & { followRedirects?: boolean } = {}): Promise<{ resp: Response; finalUrl: string }> {
    const { followRedirects = false, ...rest } = init
    const headers = new Headers({ ...COMMON_HEADERS, ...(rest.headers as Record<string, string> | undefined) })
    const cookie = this.jar.header()
    if (cookie) headers.set('Cookie', cookie)

    let current = url
    let method = rest.method ?? 'GET'
    let body = rest.body
    for (let hop = 0; hop < 6; hop++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
      let resp: Response
      try {
        resp = await fetch(current, { ...rest, method, body, headers, redirect: 'manual', signal: ctl.signal, cache: 'no-store' })
      } catch (e) {
        throw new NrsdbFetchError(`NRSDB request failed (${current}): ${(e as Error).message}`)
      } finally {
        clearTimeout(timer)
      }
      this.jar.absorb(resp.headers)

      const isRedirect = resp.status >= 300 && resp.status < 400 && resp.headers.get('location')
      if (!isRedirect || !followRedirects) return { resp, finalUrl: current }

      current = new URL(resp.headers.get('location')!, current).toString()
      // Browsers switch POST→GET on 301/302/303 redirects; mirror that.
      if (resp.status !== 307 && resp.status !== 308) {
        method = 'GET'; body = undefined
        headers.delete('Content-Type'); headers.delete('Content-Length')
      }
      const c = this.jar.header()
      if (c) headers.set('Cookie', c)
    }
    throw new NrsdbFetchError('NRSDB request exceeded redirect limit.')
  }

  // Returns true when the login succeeded (we were redirected away from
  // login.php with a session cookie).
  async login(): Promise<boolean> {
    const form = new URLSearchParams({ email: this.email, password: this.password })
    const { resp, finalUrl } = await this.request(LOGIN_URL, {
      method: 'POST',
      body: form.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE_URL,
        'Referer': LOGIN_URL,
      },
      followRedirects: true,
    })
    // Drain the body so the connection is reusable.
    await resp.text().catch(() => '')
    return resp.ok && !finalUrl.includes('login.php') && this.jar.size > 0
  }

  async getEsrs(routeCode = 'EM', filter = 'imposed'): Promise<unknown> {
    const params = new URLSearchParams({
      r: 'getEsrsByRouteCode',
      routecode: routeCode,
      filter,
      _: String(Date.now()),
    })
    const headers = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE_URL}/listEsr.php?view=route&route=${encodeURIComponent(routeCode)}&filter=${encodeURIComponent(filter)}`,
    }

    let { resp, finalUrl } = await this.request(`${ESR_URL}?${params}`, { headers, followRedirects: true })
    let expired = finalUrl.includes('login') || !(resp.headers.get('content-type') ?? '').startsWith('application/json')

    if (expired) {
      await resp.text().catch(() => '')
      if (!(await this.login())) throw new NrsdbAuthError('NRSDB re-login failed — check NRSDB_EMAIL / NRSDB_PASSWORD.')
      ;({ resp, finalUrl } = await this.request(`${ESR_URL}?${params}`, { headers, followRedirects: true }))
      expired = finalUrl.includes('login') || !(resp.headers.get('content-type') ?? '').startsWith('application/json')
      if (expired) throw new NrsdbAuthError('NRSDB session not accepted after re-login.')
    }

    if (!resp.ok) throw new NrsdbFetchError(`NRSDB returned HTTP ${resp.status} for getEsrsByRouteCode.`)
    const text = await resp.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new NrsdbPayloadError(`NRSDB response was not JSON (${text.slice(0, 120)}…).`)
    }
  }
}

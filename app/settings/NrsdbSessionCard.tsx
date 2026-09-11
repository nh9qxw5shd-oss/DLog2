'use client'

// ─── NRSDB session (unattended ESR pulls) ─────────────────────────────────────
// Lets an operator hand the server a live NRSDB session once, from a browser
// that NRSDB allows, so the keep-alive schedule can pull the ESR feed by
// itself. Two ways in, neither needs an install:
//   • a bookmark: click it while on nrsdb.uk; it reads the page's cookies and
//     posts them here (works only if the session cookie is not HttpOnly)
//   • paste: F12 → Application/Storage → Cookies → nrsdb.uk → copy the
//     session cookie value → paste below

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Check, AlertTriangle, RefreshCw, Trash2, Bookmark, KeyRound } from 'lucide-react'

interface SessionSummary {
  suppliedAt: string; suppliedVia: string | null; lastCheckAt: string | null; lastOkAt: string | null
  lastStatus: string | null; lastError: string | null; checks: number; failures: number; cookieNames: string[]
}
interface CheckRow { checked_at: string; trigger: string; status: string; http_status: number | null; esr_count: number | null; detail: string | null }
interface StatusResp { ok: boolean; routeCode?: string; session?: SessionSummary | null; checks?: CheckRow[]; serviceRole?: boolean; message?: string }

function cn(...cls: (string | false | undefined | null)[]) { return cls.filter(Boolean).join(' ') }

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function bookmarkletFor(origin: string): string {
  const js = `(function(){if(!/nrsdb\\.uk$/.test(location.hostname)){alert('Open this bookmark while on nrsdb.uk (logged in).');return;}var c=document.cookie;if(!c){alert('No readable NRSDB cookie: the session cookie is HttpOnly. Use the paste method in DLog2 Settings.');return;}fetch('${origin}/api/esr/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookie:c,via:'bookmarklet'})}).then(function(r){return r.json()}).then(function(d){alert('DLog2: '+(d.message||JSON.stringify(d)))}).catch(function(e){alert('DLog2: '+e)})})();`
  return 'javascript:' + encodeURIComponent(js)
}

export default function NrsdbSessionCard() {
  const [status, setStatus] = useState<StatusResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [cookie, setCookie] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [origin, setOrigin] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/esr/session', { cache: 'no-store' })
      setStatus(await r.json())
    } catch (e) {
      setStatus({ ok: false, message: (e as Error).message })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { setOrigin(window.location.origin); refresh() }, [refresh])

  const submit = async () => {
    const value = cookie.trim()
    if (!value) return
    setBusy(true); setMsg(null)
    try {
      // Accept either a bare value (assume PHPSESSID) or a full "name=value; …" header.
      const header = value.includes('=') ? value : `PHPSESSID=${value}`
      const r = await fetch('/api/esr/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: header, via: 'paste' }) })
      const d = await r.json()
      setMsg({ ok: !!d.ok, text: d.message || JSON.stringify(d) })
      if (d.ok) setCookie('')
      await refresh()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally { setBusy(false) }
  }

  const forget = async () => {
    if (!confirm('Forget the stored NRSDB session? Unattended pulls stop until a new one is supplied.')) return
    setBusy(true)
    try { await fetch('/api/esr/session', { method: 'DELETE' }); await refresh() } finally { setBusy(false) }
  }

  const s = status?.session ?? null
  const healthy = !!s && s.lastStatus === 'ok'
  const tone = loading ? 'neutral' : healthy ? 'green' : s ? 'amber' : 'neutral'

  return (
    <div className={cn('card p-5 space-y-4 border',
      tone === 'green' ? 'border-[rgba(39,174,96,0.4)]' : tone === 'amber' ? 'border-[rgba(243,156,18,0.5)]' : 'border-[rgba(74,111,165,0.3)]')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white text-base font-semibold flex items-center gap-2"><KeyRound size={15} className="text-[#E05206]" /> NRSDB session — unattended ESR pulls</h2>
          <p className="text-xs text-[#7A8BA8] mt-1 max-w-2xl">
            NRSDB blocks the server from logging in, but not from reading the data once it has a session. Hand it a session once from
            a logged-in browser and the keep-alive schedule pulls the ESR feed every five minutes, so the morning log needs no paste step.
            If the session dies, the Generate step falls back to the paste flow automatically.
          </p>
        </div>
        <button onClick={refresh} disabled={loading} className="shrink-0 text-xs text-[#7A8BA8] hover:text-white inline-flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Status */}
      <div className="rounded p-3 bg-[#0F1729] border border-[rgba(74,111,165,0.2)] text-xs space-y-1">
        {loading && !status ? (
          <div className="flex items-center gap-2 text-[#7A8BA8]"><Loader2 size={12} className="animate-spin" /> Checking…</div>
        ) : !status?.ok ? (
          <div className="flex items-start gap-2 text-amber-400"><AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{status?.message || 'Status unavailable.'}</span></div>
        ) : !s ? (
          <div className="flex items-center gap-2 text-[#7A8BA8]"><AlertTriangle size={13} className="text-amber-400" /> No session stored yet. Supply one below.</div>
        ) : (
          <>
            <div className={cn('flex items-center gap-2 font-semibold', healthy ? 'text-green-300' : 'text-amber-300')}>
              {healthy ? <Check size={13} /> : <AlertTriangle size={13} />}
              {healthy ? 'Session working' : s.lastStatus ? `Session ${s.lastStatus}` : 'Session stored, not yet checked'}
              <span className="text-[#7A8BA8] font-normal">· supplied {fmt(s.suppliedAt)} via {s.suppliedVia || '?'} · cookies: {s.cookieNames.join(', ') || '—'}</span>
            </div>
            <div className="text-[#7A8BA8]">
              Last check {fmt(s.lastCheckAt)} · last success {fmt(s.lastOkAt)} · {s.checks} check{s.checks !== 1 ? 's' : ''}
              {s.failures > 0 && <span className="text-amber-400"> · {s.failures} consecutive failure{s.failures !== 1 ? 's' : ''}</span>}
            </div>
            {s.lastError && <div className="text-amber-400/90">{s.lastError}</div>}
            {status.checks && status.checks.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-[#4A5A72] hover:text-[#7A8BA8]">Recent checks</summary>
                <table className="mt-1 w-full font-mono text-[10px] text-[#7A8BA8]">
                  <tbody>
                    {status.checks.map((c, i) => (
                      <tr key={i} className={c.status === 'ok' ? 'text-green-300/80' : 'text-amber-300/80'}>
                        <td className="pr-3">{fmt(c.checked_at)}</td><td className="pr-3">{c.trigger}</td><td className="pr-3">{c.status}</td>
                        <td className="pr-3">{c.http_status ?? ''}</td><td className="pr-3">{c.esr_count ?? ''}</td><td className="truncate max-w-[24rem]">{c.detail ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}
        {status?.ok && status.serviceRole === false && (
          <div className="flex items-start gap-2 text-amber-400 pt-1"><AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>The server is running with the public anon key. Set <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> on the host — the session store is service-role only and will refuse the anon key.</span></div>
        )}
      </div>

      {/* Supply */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-white flex items-center gap-1.5"><Bookmark size={12} className="text-[#E05206]" /> Option A — one-click bookmark</p>
          <ol className="text-xs text-[#7A8BA8] space-y-1 list-decimal list-inside">
            <li>Drag this button to your bookmarks bar:{' '}
              {origin && <a href={bookmarkletFor(origin)} onClick={e => e.preventDefault()} draggable
                className="inline-block px-2 py-1 rounded bg-[#003366] text-white font-semibold cursor-grab">Send NRSDB session to DLog2</a>}
            </li>
            <li>Open nrsdb.uk and log in.</li>
            <li>Click the bookmark. It reports whether the session was stored and whether the test pull worked.</li>
          </ol>
          <p className="text-[10px] text-[#4A5A72]">If it says the cookie is HttpOnly, the browser will not expose it to the bookmark. Use option B.</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-white">Option B — paste the session cookie</p>
          <ol className="text-xs text-[#7A8BA8] space-y-1 list-decimal list-inside">
            <li>On nrsdb.uk, logged in, press F12 → Application (Edge/Chrome) or Storage (Firefox) → Cookies → nrsdb.uk.</li>
            <li>Copy the <span className="font-mono">PHPSESSID</span> value (or the whole cookie string) and paste it here.</li>
          </ol>
          <div className="flex gap-2">
            <input value={cookie} onChange={e => setCookie(e.target.value)} placeholder="PHPSESSID=…  or just the value"
              className="flex-1 text-xs font-mono px-2 py-1.5 rounded bg-[#0F1729] border border-[rgba(74,111,165,0.4)] text-white" />
            <button onClick={submit} disabled={busy || !cookie.trim()}
              className="px-3 py-1.5 rounded bg-[#E05206] text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Store &amp; test
            </button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={cn('flex items-start gap-2 p-3 rounded text-xs border',
          msg.ok ? 'bg-[rgba(39,174,96,0.1)] border-[rgba(39,174,96,0.4)] text-green-300' : 'bg-[rgba(192,57,43,0.12)] border-[rgba(192,57,43,0.4)] text-red-300')}>
          {msg.ok ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {s && (
        <div className="flex justify-end">
          <button onClick={forget} disabled={busy} className="text-xs text-[#4A5A72] hover:text-red-400 inline-flex items-center gap-1"><Trash2 size={11} /> Forget session</button>
        </div>
      )}
    </div>
  )
}

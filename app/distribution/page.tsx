'use client'

// ─── Distribution list ────────────────────────────────────────────────────────
// The addresses the daily log is emailed to (BCC) from the Send step. Paste an
// Outlook To line or one address per line to add; pause an address to keep it
// on the list without sending to it; edit or remove. Every change is live and
// needs the desk key. Also shows the recent send history.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle, ArrowLeft, Check, Copy, KeyRound, Loader2, Pause, Pencil, Play, Plus, Search, Trash2, X,
} from 'lucide-react'
import {
  readDeskKey, writeDeskKey, readSenderName, writeSenderName, fetchRecipients, addRecipients, updateRecipient,
  removeRecipient, Recipient, PublicSend, DESK_KEY_STORAGE,
} from '@/lib/distribution/client'
import { formatAddressList } from '@/lib/distribution/addresses'
import { ukDate } from '@/lib/distribution/emailTemplate'
import { subscribeStorageKey } from '@/lib/storageSync'

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

const input = 'bg-[#0A0F1E] border border-[rgba(74,111,165,0.3)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E05206]'
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

export default function DistributionPage() {
  const [key, setKey] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [by, setBy] = useState('')
  const [list, setList] = useState<Recipient[] | null>(null)
  const [sends, setSends] = useState<PublicSend[]>([])
  const [error, setError] = useState('')
  const [needKey, setNeedKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [paste, setPaste] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string; email: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async (k: string) => {
    setLoading(true); setError('')
    try {
      const r = await fetchRecipients(k)
      setList(r.recipients); setSends(r.sends); setNeedKey(false)
    } catch (e: any) {
      if (e?.status === 401) { setNeedKey(true); setList(null) }
      else setError(e?.message || 'Could not load the list')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const k = readDeskKey(); setKey(k); setKeyDraft(k); setBy(readSenderName())
    load(k)
    return subscribeStorageKey(DESK_KEY_STORAGE, v => { setKey(v ?? ''); setKeyDraft(v ?? ''); load(v ?? '') })
  }, [load])

  const saveKey = () => { writeDeskKey(keyDraft); setKey(keyDraft.trim()); load(keyDraft.trim()) }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = list ?? []
    return q ? all.filter(r => r.email.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q)) : all
  }, [list, query])
  const activeCount = (list ?? []).filter(r => r.active).length
  const pausedCount = (list ?? []).length - activeCount

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id); setError('')
    try { await fn(); await load(key) }
    catch (e: any) { setError(e?.message || 'Change failed') }
    finally { setBusyId(null) }
  }

  const add = async () => {
    setAdding(true); setAddMsg(''); setError('')
    if (by) writeSenderName(by)
    try {
      const r = await addRecipients(key, paste, by)
      const bits = [`${r.added} added`]
      if (r.alreadyListed) bits.push(`${r.alreadyListed} already on the list`)
      if (r.duplicatesInPaste) bits.push(`${r.duplicatesInPaste} repeated in the paste`)
      if (r.invalid.length) bits.push(`${r.invalid.length} not valid: ${r.invalid.slice(0, 5).join(', ')}${r.invalid.length > 5 ? '…' : ''}`)
      setAddMsg(bits.join(' · '))
      if (r.added) setPaste('')
      await load(key)
    } catch (e: any) { setError(e?.message || 'Could not add') }
    finally { setAdding(false) }
  }

  const copyActive = async () => {
    const line = formatAddressList((list ?? []).filter(r => r.active).map(r => ({ email: r.email, name: r.name })))
    try { await navigator.clipboard.writeText(line); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setError('The browser refused clipboard access.') }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="border-b border-[rgba(74,111,165,0.2)] bg-[#0F1729] sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-5 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(0 0,100% 0,80% 100%,0 100%)' }} />
              <div className="w-3 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(20% 0,100% 0,100% 100%,0 100%)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-bold leading-none">Network Rail</p>
              <p className="text-[#7A8BA8] text-xs leading-none truncate">Daily Log Distribution List</p>
            </div>
          </div>
          <Link href="/" className="flex items-center gap-1.5 text-xs text-[#7A8BA8] hover:text-white transition-colors font-mono shrink-0">
            <ArrowLeft size={12} /> <span className="hidden sm:inline">Back to Report Generator</span><span className="sm:hidden">Back</span>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-white mb-1">Distribution list</h1>
          <p className="text-sm text-[#7A8BA8]">
            Everyone here receives the East Midlands Daily Control Log by BCC from the Send step. Changes are live for the next send.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-3 p-3 rounded bg-[rgba(192,57,43,0.1)] border border-[rgba(192,57,43,0.3)]">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {needKey ? (
          <div className="card p-4 space-y-2 max-w-md">
            <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider flex items-center gap-2"><KeyRound size={12} /> Desk key</p>
            <p className="text-xs text-[#7A8BA8]">The list holds people&apos;s names and addresses, so it needs the desk key.{key && ' The key saved here was not accepted.'}</p>
            <div className="flex gap-2">
              <input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveKey() }}
                autoComplete="off" placeholder="Desk key" className={cn(input, 'flex-1 min-w-0')} />
              <button onClick={saveKey} className="px-4 py-2 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c4480a]">Open</button>
            </div>
          </div>
        ) : loading && !list ? (
          <div className="card p-4 flex items-center gap-2 text-sm text-[#7A8BA8]"><Loader2 size={14} className="animate-spin" /> Loading the list…</div>
        ) : list && (
          <>
            {/* Add */}
            <div className="card p-4 space-y-3">
              <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider flex items-center gap-2"><Plus size={12} /> Add addresses</p>
              <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={3}
                placeholder={'Paste an Outlook To line, or one address per line\nJane Smith <Jane.Smith@networkrail.co.uk>; ops@example.com'}
                className={cn(input, 'w-full font-mono text-xs')} />
              <div className="flex gap-2 flex-wrap">
                <input value={by} onChange={e => setBy(e.target.value)} placeholder="Your name" maxLength={80} className={cn(input, 'flex-1 min-w-[10rem]')} />
                <button onClick={add} disabled={adding || !paste.trim()}
                  className="px-4 py-2 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#c4480a] disabled:opacity-50 inline-flex items-center gap-2">
                  {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
                </button>
              </div>
              {addMsg && <p className="text-xs text-[#27AE60]">{addMsg}</p>}
            </div>

            {/* List */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-white">
                  <strong>{activeCount}</strong> active{pausedCount > 0 && <span className="text-[#7A8BA8]"> · {pausedCount} paused</span>}
                </p>
                <div className="relative flex-1 min-w-[12rem]">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4A5A72]" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a name or address" className={cn(input, 'w-full pl-8 py-1.5')} />
                </div>
                <button onClick={copyActive} title="Copy the active addresses as an Outlook line (a fallback if email sending is down)"
                  className="text-xs text-[#4A6FA5] hover:text-white inline-flex items-center gap-1">
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy for Outlook'}
                </button>
              </div>

              <ul className="divide-y divide-[rgba(74,111,165,0.15)] border-t border-[rgba(74,111,165,0.15)]">
                {shown.map(r => (
                  <li key={r.id} className={cn('py-2 flex items-center gap-3', !r.active && 'opacity-55')}>
                    {editing?.id === r.id ? (
                      <div className="flex-1 min-w-0 flex gap-2 flex-wrap">
                        <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Name" className={cn(input, 'py-1 flex-1 min-w-[8rem]')} />
                        <input value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} placeholder="Email" className={cn(input, 'py-1 flex-[2] min-w-[12rem]')} />
                        <button onClick={() => act(r.id, () => updateRecipient(key, r.id, { name: editing.name || null, email: editing.email }).then(() => setEditing(null)))}
                          className="p-1.5 text-[#27AE60] hover:text-white" title="Save"><Check size={14} /></button>
                        <button onClick={() => setEditing(null)} className="p-1.5 text-[#7A8BA8] hover:text-white" title="Cancel"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{r.name || r.email}{!r.active && <span className="ml-2 text-[10px] font-mono text-amber-400">PAUSED</span>}</p>
                        {r.name && <p className="text-xs text-[#7A8BA8] truncate">{r.email}</p>}
                      </div>
                    )}
                    {editing?.id !== r.id && (
                      <div className="flex items-center gap-1 shrink-0">
                        {busyId === r.id ? <Loader2 size={14} className="animate-spin text-[#7A8BA8]" /> : confirmRemove === r.id ? (
                          <>
                            <button onClick={() => act(r.id, () => removeRecipient(key, r.id)).then(() => setConfirmRemove(null))}
                              className="px-2 py-1 text-xs rounded bg-[rgba(192,57,43,0.2)] text-red-400 hover:bg-[rgba(192,57,43,0.35)]">Remove</button>
                            <button onClick={() => setConfirmRemove(null)} className="p-1.5 text-[#7A8BA8] hover:text-white" title="Keep"><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => act(r.id, () => updateRecipient(key, r.id, { active: !r.active }))}
                              className="p-1.5 text-[#7A8BA8] hover:text-white" title={r.active ? 'Pause: keep on the list but do not send' : 'Resume sending'}>
                              {r.active ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <button onClick={() => setEditing({ id: r.id, name: r.name ?? '', email: r.email })} className="p-1.5 text-[#7A8BA8] hover:text-white" title="Edit"><Pencil size={14} /></button>
                            <button onClick={() => setConfirmRemove(r.id)} className="p-1.5 text-[#7A8BA8] hover:text-red-400" title="Remove"><Trash2 size={14} /></button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {shown.length === 0 && <li className="py-4 text-sm text-[#7A8BA8]">{query ? 'Nothing matches.' : 'The list is empty.'}</li>}
              </ul>
            </div>

            {/* History */}
            <div className="card p-4 space-y-2">
              <p className="text-xs text-[#7A8BA8] font-semibold uppercase tracking-wider">Recent sends</p>
              {sends.length === 0 ? <p className="text-sm text-[#7A8BA8]">None yet.</p> : (
                <ul className="space-y-1">
                  {sends.map(s => (
                    <li key={s.id} className="text-xs flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="text-white font-mono">{ukDate(s.logDate)}</span>
                      <span className="text-[#7A8BA8]">{when(s.createdAt)}</span>
                      <span className={cn('font-mono', s.status === 'sent' ? 'text-[#27AE60]' : s.status === 'partial' ? 'text-amber-400' : s.status === 'failed' ? 'text-red-400' : 'text-[#7A8BA8]')}>
                        {s.isTest ? 'TEST ' : ''}{s.status.toUpperCase()}
                      </span>
                      <span className="text-[#7A8BA8]">{s.isTest ? `to ${s.toAddress}` : `${s.sentCount}/${s.recipientCount} addresses · ${s.emails} email${s.emails === 1 ? '' : 's'}`}</span>
                      {s.sentBy && <span className="text-[#7A8BA8]">by {s.sentBy}</span>}
                      {s.error && <span className="text-red-400 w-full">{s.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

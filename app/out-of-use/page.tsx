'use client'

// ─── Out of Use Infrastructure Register — standalone page ────────────────────
// Deliberately has NO navigation back into DLog2. Maintenance staff are given
// this URL alone; control reach it from the "Out of Use Register" button on
// the main page. Everything saved here is live immediately and is printed as
// the final section of the next daily log PDF.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Pencil, Trash2, X, Check, Loader2, RefreshCw, Cloud, CloudOff,
  AlertTriangle, ChevronDown, ChevronRight, ArrowRightLeft, Clock,
} from 'lucide-react'
import {
  OouItem, OouDraft, OouSection, OouSectionSpec, OouRegister,
  OOU_SECTIONS, OOU_SECTION_SPECS, blankDraft, isOouCloud,
  fetchOutOfUseRegister, createOouItem, updateOouItem, deleteOouItem, moveOouItem,
  readEditorName, writeEditorName, fmtSince, daysSince, ago, fmtStamp,
} from '@/lib/outOfUse'

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

const INPUT = 'w-full bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.25)] rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-[#4A6FA5] placeholder:text-[#4A5A72]'

// ─── Item form (add + edit) ───────────────────────────────────────────────────

function ItemForm({
  spec, initial, editorName, saving, error, onSave, onCancel,
}: {
  spec: OouSectionSpec
  initial: OouDraft
  editorName: string
  saving: boolean
  error: string
  onSave: (draft: OouDraft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<OouDraft>(initial)
  const set = (k: keyof OouDraft, v: string) => setDraft(d => ({ ...d, [k]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ ...draft, updatedBy: editorName })
  }

  return (
    <form onSubmit={submit} className="rounded border border-[#4A6FA5] bg-[#0F1729] p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.fields.map(f => {
          const wide = f.multiline
          if (f.key === 'since') {
            return (
              <label key={f.key} className="block">
                <span className="block text-[11px] uppercase tracking-wide text-[#7A8BA8] mb-1">{f.label}</span>
                <input type="date" value={draft.since ?? ''} onChange={e => set('since', e.target.value)} className={INPUT} />
              </label>
            )
          }
          return (
            <label key={f.key} className={cn('block', wide && 'sm:col-span-2')}>
              <span className="block text-[11px] uppercase tracking-wide text-[#7A8BA8] mb-1">
                {f.label}{f.key === 'item' && <span className="text-[#E05206]"> *</span>}
              </span>
              {f.multiline
                ? <textarea rows={3} value={draft[f.key] as string} onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder} className={INPUT} />
                : <input type="text" value={draft[f.key] as string} onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder} className={INPUT} required={f.key === 'item'} />}
            </label>
          )
        })}
      </div>

      {error && (
        <p className="flex items-start gap-2 text-xs text-red-400"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}</p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-[#4A5A72]">
          {editorName ? <>Saved as <span className="text-[#7A8BA8]">{editorName}</span></> : 'Tip: put your name in the box at the top so the log shows who last updated this.'}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-[#7A8BA8] hover:text-white border border-[rgba(74,111,165,0.25)]">
            <X size={14} /> Cancel
          </button>
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-semibold bg-[#E05206] hover:bg-[#C4480A] text-white disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        </div>
      </div>
    </form>
  )
}

// ─── One register row ─────────────────────────────────────────────────────────

function ItemRow({
  spec, item, editorName, busy, onEdit, onDelete, onMove,
}: {
  spec: OouSectionSpec
  item: OouItem
  editorName: string
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onMove: (section: OouSection) => void
}) {
  const [open, setOpen] = useState(false)
  const columns = spec.fields.filter(f => f.column && f.key !== 'item')
  const extras  = spec.fields.filter(f => !f.column && item[f.key])
  const days    = daysSince(item.since)

  return (
    <div className="rounded border border-[rgba(74,111,165,0.2)] bg-[#131C35] hover:border-[rgba(74,111,165,0.45)] transition-colors">
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => setOpen(o => !o)} className="mt-0.5 text-[#4A5A72] hover:text-white shrink-0" title={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold leading-snug">{item.item}</p>
            <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              {columns.map(f => (
                <div key={f.key} className={cn('min-w-0', f.multiline && 'sm:col-span-2')}>
                  <span className="block text-[10px] uppercase tracking-wide text-[#4A5A72]">{f.label}</span>
                  {f.key === 'since'
                    ? <span className="text-[#D0D7E2] font-mono">
                        {fmtSince(item.since)}
                        {days !== null && <span className="text-[#7A8BA8] font-sans"> · {days} day{days === 1 ? '' : 's'}</span>}
                      </span>
                    : <span className={cn('text-[#D0D7E2] whitespace-pre-line break-words', f.key === 'elr' || f.key === 'ref' ? 'font-mono' : '')}>
                        {item[f.key] || <span className="text-[#4A5A72]">—</span>}
                      </span>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={onEdit} disabled={busy} title="Edit"
              className="p-2 rounded text-[#7A8BA8] hover:text-white hover:bg-[rgba(74,111,165,0.15)]"><Pencil size={15} /></button>
            <button type="button" onClick={onDelete} disabled={busy} title="Remove from register"
              className="p-2 rounded text-[#7A8BA8] hover:text-red-400 hover:bg-[rgba(192,57,43,0.15)]"><Trash2 size={15} /></button>
          </div>
        </div>

        {open && (
          <div className="mt-3 ml-7 pt-3 border-t border-[rgba(74,111,165,0.15)] space-y-2 text-sm">
            {extras.length === 0 && spec.fields.some(f => !f.column) && (
              <p className="text-[#4A5A72] italic">No further detail recorded. Edit to add {spec.fields.filter(f => !f.column).map(f => f.label.toLowerCase()).join(', ')}.</p>
            )}
            {extras.map(f => (
              <div key={f.key}>
                <span className="block text-[10px] uppercase tracking-wide text-[#4A5A72]">{f.label}</span>
                <p className="text-[#D0D7E2] whitespace-pre-line break-words">{item[f.key]}</p>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-[#4A5A72]">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> Last updated {fmtStamp(item.updatedAt)} ({ago(item.updatedAt)}){item.updatedBy && <> by <span className="text-[#7A8BA8]">{item.updatedBy}</span></>}
              </span>
              <label className="inline-flex items-center gap-1.5">
                <ArrowRightLeft size={11} /> Move to
                <select value={item.section} disabled={busy} onChange={e => onMove(e.target.value as OouSection)}
                  className="bg-[#0F1729] border border-[rgba(74,111,165,0.25)] rounded px-1.5 py-0.5 text-[11px] text-[#D0D7E2]">
                  {OOU_SECTIONS.map(s => <option key={s} value={s}>{OOU_SECTION_SPECS[s].title}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
      {!open && (item.updatedBy || item.updatedAt) && (
        <div className="px-4 pb-2 -mt-1 ml-7 text-[10px] text-[#4A5A72]">Updated {ago(item.updatedAt)}{item.updatedBy && ` by ${item.updatedBy}`}</div>
      )}
    </div>
  )
}

// ─── One section (Short term / Long term / UPS) ──────────────────────────────

function Section({
  spec, items, editorName, onChanged,
}: {
  spec: OouSectionSpec
  items: OouItem[]
  editorName: string
  onChanged: () => void
}) {
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)

  const run = async (id: string | null, fn: () => Promise<unknown>) => {
    setSaving(true); setError(''); setBusyId(id)
    try { await fn(); setAdding(false); setEditing(null); onChanged() }
    catch (e) { setError((e as Error).message || 'Save failed.') }
    finally { setSaving(false); setBusyId(null) }
  }

  const remove = (item: OouItem) => {
    if (!window.confirm(`Remove "${item.item}" from the register?\n\nIt will no longer appear in the daily log. This cannot be undone.`)) return
    run(item.id, () => deleteOouItem(item.id)).then(() => { if (error) window.alert(error) })
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 mb-3 border-b border-[rgba(74,111,165,0.2)]">
        <div className="flex items-start gap-3">
          <div className="w-2 h-9 bg-[#E05206] rounded shrink-0" />
          <div>
            <h2 className="text-white font-semibold leading-tight">
              {spec.title} <span className="ml-1 text-xs font-mono text-[#7A8BA8]">{items.length}</span>
            </h2>
            <p className="text-xs text-[#7A8BA8] mt-0.5 max-w-2xl">{spec.blurb}</p>
          </div>
        </div>
        <button type="button" onClick={() => { setAdding(true); setEditing(null); setError('') }} disabled={adding}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold bg-[#003366] hover:bg-[#004488] text-white disabled:opacity-50">
          <Plus size={15} /> Add item
        </button>
      </div>

      <div className="space-y-2">
        {adding && (
          <ItemForm spec={spec} initial={blankDraft(spec.key)} editorName={editorName} saving={saving} error={error}
            onSave={d => run(null, () => createOouItem(d))}
            onCancel={() => { setAdding(false); setError('') }} />
        )}

        {items.length === 0 && !adding && (
          <p className="text-sm text-[#4A5A72] italic py-2">Nothing on this part of the register. The daily log will say so.</p>
        )}

        {items.map(item => editing === item.id
          ? <ItemForm key={item.id} spec={spec} initial={{ ...item }} editorName={editorName} saving={saving} error={error}
              onSave={d => run(item.id, () => updateOouItem(item.id, d))}
              onCancel={() => { setEditing(null); setError('') }} />
          : <ItemRow key={item.id} spec={spec} item={item} editorName={editorName} busy={busyId === item.id}
              onEdit={() => { setEditing(item.id); setAdding(false); setError('') }}
              onDelete={() => remove(item)}
              onMove={s => { if (s !== item.section) run(item.id, () => moveOouItem(item, s, editorName)) }} />
        )}
        {error && !adding && !editing && (
          <p className="flex items-start gap-2 text-xs text-red-400"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}</p>
        )}
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OutOfUsePage() {
  const [reg, setReg]         = useState<(OouRegister & { error?: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName]       = useState('')
  const cloud = isOouCloud()

  const load = useCallback(async () => {
    setLoading(true)
    setReg(await fetchOutOfUseRegister())
    setLoading(false)
  }, [])

  useEffect(() => { setName(readEditorName()); load() }, [load])

  const bySection = useMemo(() => {
    const m: Record<OouSection, OouItem[]> = { SHORT_TERM: [], LONG_TERM: [], UPS: [] }
    for (const i of reg?.items ?? []) m[i.section].push(i)
    return m
  }, [reg])

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)', position: 'relative', zIndex: 2 }}>
      <header className="border-b border-[rgba(74,111,165,0.2)] bg-[#0F1729]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(0 0,100% 0,80% 100%,0 100%)' }} />
              <div className="w-3 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(20% 0,100% 0,100% 100%,0 100%)' }} />
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-none">Network Rail</p>
              <p className="text-[#7A8BA8] text-xs leading-none mt-1">EMCC · Out of Use Infrastructure Register</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            {cloud
              ? <span className="inline-flex items-center gap-1.5 text-[#27AE60]"><Cloud size={12} /> Live register</span>
              : <span className="inline-flex items-center gap-1.5 text-amber-400"><CloudOff size={12} /> Local only</span>}
            <button type="button" onClick={load} disabled={loading} title="Reload"
              className="inline-flex items-center gap-1 text-[#4A5A72] hover:text-white">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Out of Use Infrastructure Register</h1>
            <p className="text-sm text-[#7A8BA8] mt-1 max-w-2xl">
              Maintained by maintenance. Whatever is on this page is printed, as it stands, at the end of every EMCC daily log.
              Add an item when an asset goes out of use, edit it as the plan moves on, remove it when it is back in use.
            </p>
          </div>
          <label className="block w-full sm:w-64">
            <span className="block text-[11px] uppercase tracking-wide text-[#7A8BA8] mb-1">Your name (shown against your edits)</span>
            <input type="text" value={name} placeholder="e.g. J Smith, IME Derby"
              onChange={e => setName(e.target.value)} onBlur={() => writeEditorName(name)}
              className={INPUT} />
          </label>
        </div>

        {!cloud && (
          <div className="flex items-start gap-3 p-3 rounded bg-[rgba(243,156,18,0.12)] border border-[rgba(243,156,18,0.5)] text-xs">
            <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[#C9A257]">
              This deployment has no database configured, so the register is stored in this browser only and will not reach the daily log.
              Set <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> / <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> and run migration 012.
            </p>
          </div>
        )}

        {reg?.error && (
          <div className="flex items-start gap-3 p-3 rounded bg-[rgba(192,57,43,0.12)] border border-[rgba(192,57,43,0.5)] text-xs">
            <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-red-300">Could not read the register: {reg.error}</p>
          </div>
        )}

        {loading && !reg
          ? <p className="inline-flex items-center gap-2 text-sm text-[#7A8BA8]"><Loader2 size={14} className="animate-spin" /> Loading register…</p>
          : OOU_SECTIONS.map(s => (
              <Section key={s} spec={OOU_SECTION_SPECS[s]} items={bySection[s]} editorName={name.trim()} onChanged={load} />
            ))}

        {reg && (
          <p className="text-[11px] text-[#4A5A72] font-mono">
            {reg.items.length} item{reg.items.length === 1 ? '' : 's'} on the register · last change {reg.lastUpdated ? `${fmtStamp(reg.lastUpdated)} (${ago(reg.lastUpdated)})` : 'none yet'}
          </p>
        )}
      </main>

      <footer className="border-t border-[rgba(74,111,165,0.15)] mt-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#4A5A72] font-mono">OUT OF USE REGISTER · OFFICIAL-SENSITIVE</p>
          <p className="text-xs text-[#4A5A72]">Network Rail Infrastructure Ltd</p>
        </div>
      </footer>
    </div>
  )
}

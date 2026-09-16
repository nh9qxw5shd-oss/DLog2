'use client'

// ─── Out of Use Infrastructure Register — standalone page ────────────────────
// Deliberately has NO navigation back into DLog2. Maintenance staff are given
// this URL alone; control reach it from the "Out of Use Register" button on
// the main page. Everything saved here is live immediately and is printed as
// the final section of the next daily log PDF.
//
// Two groups write here: maintenance (the asset, issue, refs, repair plan) and
// ops (operational impact + RAG). The RAG orders the infrastructure table,
// most significant impact first.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Pencil, Trash2, X, Check, Loader2, RefreshCw, Cloud, CloudOff,
  AlertTriangle, ArrowRightLeft, Clock, Wrench, Radio,
} from 'lucide-react'
import {
  OouItem, OouDraft, OouSection, OouSectionSpec, OouRegister, OouRag, OouFieldSpec,
  OOU_SECTIONS, OOU_SECTION_SPECS, OOU_RAGS, OOU_RAG_SPECS, OOU_UNRATED,
  blankDraft, isOouCloud, ragCounts,
  fetchOutOfUseRegister, createOouItem, updateOouItem, deleteOouItem, moveOouItem,
  readEditorName, writeEditorName, fmtSince, daysSince, ago, fmtStamp,
} from '@/lib/outOfUse'

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

const INPUT = 'w-full bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.25)] rounded px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-[#4A6FA5] placeholder:text-[#4A5A72]'
const LABEL = 'block text-[11px] uppercase tracking-wide text-[#7A8BA8] mb-1'

// ─── RAG badge ────────────────────────────────────────────────────────────────

function RagBadge({ rag, size = 'md' }: { rag: OouRag | null; size?: 'sm' | 'md' }) {
  const s = rag ? OOU_RAG_SPECS[rag] : OOU_UNRATED
  const text = rag ? `${s.label.toUpperCase()}` : OOU_UNRATED.label.toUpperCase()
  return (
    <span
      title={rag ? OOU_RAG_SPECS[rag].meaning : 'Ops have not yet rated the operational impact'}
      className={cn('inline-flex items-center justify-center rounded font-mono font-bold tracking-wide shrink-0',
        size === 'md' ? 'px-2 py-1 text-[11px] min-w-[5.5rem]' : 'px-1.5 py-0.5 text-[10px]')}
      style={{ background: s.hex, color: s.fg }}
    >
      {text}
    </span>
  )
}

function RagPicker({ value, onChange }: { value: OouRag | null; onChange: (v: OouRag | null) => void }) {
  const opts: Array<{ v: OouRag | null; label: string; hex: string; fg: string; meaning: string }> = [
    { v: null, label: OOU_UNRATED.label, hex: OOU_UNRATED.hex, fg: OOU_UNRATED.fg, meaning: 'Leave for ops to rate' },
    ...OOU_RAGS.map(r => ({ v: r, label: OOU_RAG_SPECS[r].label, hex: OOU_RAG_SPECS[r].hex, fg: OOU_RAG_SPECS[r].fg, meaning: OOU_RAG_SPECS[r].meaning })),
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map(o => {
        const active = o.v === value
        return (
          <button key={o.label} type="button" onClick={() => onChange(o.v)} title={o.meaning}
            className={cn('px-3 py-1.5 rounded text-xs font-semibold border transition-all',
              active ? 'ring-2 ring-white border-transparent' : 'border-[rgba(74,111,165,0.3)] opacity-70 hover:opacity-100')}
            style={active ? { background: o.hex, color: o.fg } : { background: `${o.hex}22`, color: '#D0D7E2' }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Item form (add + edit) ───────────────────────────────────────────────────

function FieldInput({ f, draft, set }: { f: OouFieldSpec; draft: OouDraft; set: (k: keyof OouDraft, v: any) => void }) {
  const wide = f.kind === 'multiline' || f.kind === 'rag'
  return (
    <label className={cn('block', wide && 'sm:col-span-2')}>
      <span className={LABEL}>
        {f.label}{f.key === 'item' && <span className="text-[#E05206]"> *</span>}
        {f.hint && <span className="ml-2 normal-case tracking-normal text-[#4A5A72]">— {f.hint}</span>}
      </span>
      {f.kind === 'date' && (
        <input type="date" value={draft.since ?? ''} onChange={e => set('since', e.target.value)} className={INPUT} />
      )}
      {f.kind === 'rag' && <RagPicker value={draft.rag} onChange={v => set('rag', v)} />}
      {f.kind === 'multiline' && (
        <textarea rows={3} value={draft[f.key] as string} onChange={e => set(f.key, e.target.value)}
          placeholder={f.placeholder} className={INPUT} />
      )}
      {f.kind === 'text' && (
        <input type="text" value={draft[f.key] as string} onChange={e => set(f.key, e.target.value)}
          placeholder={f.placeholder} className={INPUT} required={f.key === 'item'} />
      )}
    </label>
  )
}

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
  const set = (k: keyof OouDraft, v: any) => setDraft(d => ({ ...d, [k]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ ...draft, updatedBy: editorName })
  }

  const maint = spec.fields.filter(f => f.group === 'maintenance')
  const ops   = spec.fields.filter(f => f.group === 'ops')

  return (
    <form onSubmit={submit} className="rounded border border-[#4A6FA5] bg-[#0F1729] p-4 space-y-4">
      <fieldset className="space-y-3">
        <legend className="flex items-center gap-2 text-xs font-semibold text-[#7A8BA8] uppercase tracking-wider mb-2">
          <Wrench size={12} /> Maintenance
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {maint.map(f => <FieldInput key={f.key} f={f} draft={draft} set={set} />)}
        </div>
      </fieldset>

      {ops.length > 0 && (
        <fieldset className="space-y-3 rounded border border-[rgba(74,111,165,0.25)] bg-[rgba(74,111,165,0.06)] p-3">
          <legend className="flex items-center gap-2 text-xs font-semibold text-[#7A8BA8] uppercase tracking-wider px-1">
            <Radio size={12} /> Operational assessment (Ops)
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ops.map(f => <FieldInput key={f.key} f={f} draft={draft} set={set} />)}
          </div>
        </fieldset>
      )}

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

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2 lg:col-span-4')}>
      <span className="block text-[10px] uppercase tracking-wide text-[#4A5A72]">{label}</span>
      {children}
    </div>
  )
}

function Val({ v, mono }: { v: string; mono?: boolean }) {
  return v
    ? <span className={cn('text-[#D0D7E2] whitespace-pre-line break-words text-sm', mono && 'font-mono')}>{v}</span>
    : <span className="text-[#4A5A72] text-sm">—</span>
}

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
  const days = daysSince(item.since)
  const ragHex = item.rag ? OOU_RAG_SPECS[item.rag].hex : OOU_UNRATED.hex
  const isInfra = spec.key === 'INFRA'

  return (
    <div className="rounded border border-[rgba(74,111,165,0.2)] bg-[#131C35] hover:border-[rgba(74,111,165,0.45)] transition-colors overflow-hidden">
      <div className="flex">
        {spec.rated && <div className="w-1.5 shrink-0" style={{ background: ragHex }} />}
        <div className="flex-1 min-w-0 p-3 sm:p-4 space-y-3">
          {/* Title line */}
          <div className="flex items-start gap-3">
            {spec.rated && <RagBadge rag={item.rag} />}
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold leading-snug">{item.item}</p>
              {isInfra && (
                <p className="text-xs text-[#7A8BA8] font-mono mt-0.5">
                  {item.elr ? `ELR ${item.elr}` : 'ELR —'}
                  {item.since && <> · OOU since {fmtSince(item.since)}{days !== null && ` (${days} day${days === 1 ? '' : 's'})`}</>}
                  {item.ref && <> · Ref {item.ref}</>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={onEdit} disabled={busy} title="Edit"
                className="p-2 rounded text-[#7A8BA8] hover:text-white hover:bg-[rgba(74,111,165,0.15)]"><Pencil size={15} /></button>
              <button type="button" onClick={onDelete} disabled={busy} title="Remove from register"
                className="p-2 rounded text-[#7A8BA8] hover:text-red-400 hover:bg-[rgba(192,57,43,0.15)]"><Trash2 size={15} /></button>
            </div>
          </div>

          {/* Maintenance fields */}
          {isInfra ? (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Issue and Restrictions Imposed" wide><Val v={item.detail} /></Field>
              <Field label="Owner"><Val v={item.owner} /></Field>
              <Field label="FMS / CCIL Ref"><Val v={item.ref} mono /></Field>
              <Field label="Out of Use Since">
                <span className="text-[#D0D7E2] font-mono text-sm">{fmtSince(item.since)}</span>
                {days !== null && <span className="text-[#7A8BA8] text-sm"> · {days} d</span>}
              </Field>
              <Field label="ELR"><Val v={item.elr} mono /></Field>
              <Field label="Repair Requirements and Timescale" wide><Val v={item.plan} /></Field>
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Field label="Plan for Rectification"><Val v={item.plan} /></Field>
              <Field label="Impact on Failure"><Val v={item.impact} /></Field>
              <Field label="Owner"><Val v={item.owner} /></Field>
            </div>
          )}

          {/* Ops assessment */}
          {spec.rated && (
            <div className="rounded border p-3" style={{ borderColor: `${ragHex}66`, background: `${ragHex}12` }}>
              <div className="flex items-center gap-2 mb-1">
                <Radio size={11} className="text-[#7A8BA8]" />
                <span className="text-[10px] uppercase tracking-wide text-[#7A8BA8]">Operational impact (Ops)</span>
                <span className="text-[10px] text-[#4A5A72]">· {item.rag ? OOU_RAG_SPECS[item.rag].meaning : 'not yet assessed — ops to rate'}</span>
              </div>
              <Val v={item.opsImpact} />
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-[#4A5A72]">
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> Updated {fmtStamp(item.updatedAt)} ({ago(item.updatedAt)}){item.updatedBy && <> by <span className="text-[#7A8BA8]">{item.updatedBy}</span></>}
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
      </div>
    </div>
  )
}

// ─── One section (Infrastructure / UPS) ──────────────────────────────────────

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
    run(item.id, () => deleteOouItem(item.id))
  }

  const counts = spec.rated ? ragCounts(items) : null

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 mb-3 border-b border-[rgba(74,111,165,0.2)]">
        <div className="flex items-start gap-3">
          <div className="w-2 h-9 bg-[#E05206] rounded shrink-0" />
          <div>
            <h2 className="text-white font-semibold leading-tight flex flex-wrap items-center gap-2">
              {spec.title} <span className="text-xs font-mono text-[#7A8BA8]">{items.length}</span>
              {counts && items.length > 0 && (
                <span className="inline-flex items-center gap-1 ml-1">
                  {OOU_RAGS.map(r => counts[r] > 0 && (
                    <span key={r} className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold" style={{ background: OOU_RAG_SPECS[r].hex, color: OOU_RAG_SPECS[r].fg }}>
                      {counts[r]} {OOU_RAG_SPECS[r].short}
                    </span>
                  ))}
                  {counts.UNRATED > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold" style={{ background: OOU_UNRATED.hex, color: OOU_UNRATED.fg }}>
                      {counts.UNRATED} unrated
                    </span>
                  )}
                </span>
              )}
            </h2>
            <p className="text-xs text-[#7A8BA8] mt-0.5 max-w-3xl">{spec.blurb}</p>
          </div>
        </div>
        <button type="button" onClick={() => { setAdding(true); setEditing(null); setError('') }} disabled={adding}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold bg-[#003366] hover:bg-[#004488] text-white disabled:opacity-50">
          <Plus size={15} /> Add item
        </button>
      </div>

      {spec.rated && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-[#7A8BA8]">
          {OOU_RAGS.map(r => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: OOU_RAG_SPECS[r].hex }} />
              <span className="font-semibold text-[#D0D7E2]">{OOU_RAG_SPECS[r].label}</span> {OOU_RAG_SPECS[r].meaning.replace(' expected', '')}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: OOU_UNRATED.hex }} />
            <span className="font-semibold text-[#D0D7E2]">Not assessed</span> ops to rate
          </span>
        </div>
      )}

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
    const m: Record<OouSection, OouItem[]> = { INFRA: [], UPS: [] }
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
              Whatever is on this page is printed, as it stands, at the end of every EMCC daily log.
              <span className="text-[#D0D7E2]"> Maintenance</span> add an asset when it goes out of use, keep the issue and repair plan current, and remove it when it is back in use.
              <span className="text-[#D0D7E2]"> Ops</span> rate the operational impact; that rating sets the order.
            </p>
          </div>
          <label className="block w-full sm:w-64">
            <span className={LABEL}>Your name (shown against your edits)</span>
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
              Set <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> / <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> and run migrations 012 and 013.
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

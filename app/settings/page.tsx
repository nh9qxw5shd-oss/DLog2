'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, Plus, Trash2,
  RotateCcw, Cloud, Download, X, Loader2, AlertCircle,
} from 'lucide-react'
import { Severity } from '@/lib/types'
import {
  useCategorySettings, getLabelsForGroup,
  CategoryGroupConfig, CategorySettings, SaveStatus,
} from '@/lib/categorySettings'
import { CCIL_LABEL_MAP, normalizeForLookup } from '@/lib/ccilParser'
import { isSupabaseConfigured } from '@/lib/supabaseClient'

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
const SEV_COLORS: Record<Severity, string> = {
  CRITICAL: '#E74C3C', HIGH: '#E05206', MEDIUM: '#F39C12', LOW: '#4A6FA5', INFO: '#7A8BA8',
}

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

// ─── Save status badge ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SaveStatus }) {
  const cloudConfigured = isSupabaseConfigured()
  let icon, text, color
  switch (status) {
    case 'saving':
      icon = <Loader2 size={11} className="animate-spin" />
      text = 'Saving…'
      color = 'text-[#F39C12]'
      break
    case 'saved-cloud':
      icon = <Cloud size={11} />
      text = 'Saved to cloud'
      color = 'text-[#27AE60]'
      break
    case 'saved-local':
      icon = <Check size={11} />
      text = 'Saved locally'
      color = 'text-[#27AE60]'
      break
    case 'error':
      icon = <AlertCircle size={11} />
      text = 'Save failed'
      color = 'text-red-400'
      break
    default:
      icon = cloudConfigured ? <Cloud size={11} /> : <Check size={11} />
      text = cloudConfigured ? 'Cloud sync active' : 'Local only'
      color = 'text-[#7A8BA8]'
  }
  return (
    <span className={cn('flex items-center gap-1.5 text-xs font-mono', color)}>
      {icon}{text}
    </span>
  )
}

// ─── Single label chip with inline move-to dropdown ───────────────────────────

function LabelChip({
  label, currentGroup, allGroups, color, onMove,
}: {
  label: string
  currentGroup: string
  allGroups: Array<[string, CategoryGroupConfig]>
  color: string
  onMove: (normalizedLabel: string, targetKey: string) => void
}) {
  const norm = normalizeForLookup(label)
  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[rgba(74,111,165,0.25)]"
      style={{ backgroundColor: `${color}10` }}
    >
      <span className="text-xs text-[#D0D7E2] font-mono whitespace-nowrap">{label}</span>
      <select
        value={currentGroup}
        onChange={e => onMove(norm, e.target.value)}
        className="bg-transparent text-[10px] text-[#7A8BA8] hover:text-white font-mono border-0 outline-none cursor-pointer"
        title={`Move "${label}" to another group`}
      >
        {allGroups.map(([k, c]) => (
          <option key={k} value={k} style={{ backgroundColor: '#0F1729', color: '#FFFFFF' }}>
            → {c.displayName}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Search-and-add CCIL label to a group ─────────────────────────────────────

function AddLabelSearch({
  groupKey, settings, onAdd,
}: {
  groupKey: string
  settings: CategorySettings
  onAdd: (normalizedLabel: string) => void
}) {
  const [q, setQ] = useState('')

  const available = useMemo(() => {
    if (!q.trim()) return [] as string[]
    const ql = q.toLowerCase()
    return CCIL_LABEL_MAP
      .filter(([label, defaultGroup]) => {
        const norm = normalizeForLookup(label)
        const effective = settings.labelOverrides[norm] ?? defaultGroup
        return effective !== groupKey && label.toLowerCase().includes(ql)
      })
      .slice(0, 10)
      .map(([l]) => l)
  }, [q, groupKey, settings.labelOverrides])

  return (
    <div className="mt-3 pt-3 border-t border-[rgba(74,111,165,0.1)]">
      <div className="flex items-center gap-2">
        <Plus size={11} className="text-[#4A5A72]" />
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search to add a CCIL incident type to this group…"
          className="flex-1 bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.15)] rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-[#4A6FA5]"
        />
      </div>
      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.map(label => (
            <button
              key={label}
              onClick={() => { onAdd(normalizeForLookup(label)); setQ('') }}
              className="text-xs px-2 py-1 rounded bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.25)] text-[#7A8BA8] hover:text-white hover:border-[#4A6FA5] transition-colors font-mono"
            >
              + {label}
            </button>
          ))}
        </div>
      )}
      {q.trim() && available.length === 0 && (
        <p className="mt-2 text-xs text-[#4A5A72] italic">No matching CCIL types available.</p>
      )}
    </div>
  )
}

// ─── Single group row ─────────────────────────────────────────────────────────

function GroupRow({
  groupKey, cfg, settings, allGroups,
  onChange, onDelete, onMoveLabel,
}: {
  groupKey: string
  cfg: CategoryGroupConfig
  settings: CategorySettings
  allGroups: Array<[string, CategoryGroupConfig]>
  onChange: (patch: Partial<CategoryGroupConfig>) => void
  onDelete?: () => void
  onMoveLabel: (normalizedLabel: string, targetKey: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const labels = getLabelsForGroup(settings, groupKey)

  const handleDelete = () => {
    if (confirmDelete) { onDelete?.(); setConfirmDelete(false) }
    else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000) }
  }

  return (
    <div className="border border-[rgba(74,111,165,0.2)] rounded-lg overflow-hidden">
      <div className="grid grid-cols-[24px_1fr_120px_70px_120px_70px_28px] gap-2 items-center px-3 py-2.5 bg-[#0F1729]">
        <button onClick={() => setExpanded(p => !p)} className="text-[#4A5A72] hover:text-white transition-colors">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="space-y-0.5 min-w-0">
          <input
            type="text" value={cfg.displayName}
            onChange={e => onChange({ displayName: e.target.value })}
            className="w-full bg-transparent text-white text-sm font-medium border-b border-transparent hover:border-[rgba(74,111,165,0.4)] focus:border-[#4A6FA5] outline-none py-0.5 transition-colors"
          />
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-[#4A5A72] font-mono">{groupKey}</p>
            {cfg.isCustom && <span className="text-[9px] px-1 rounded bg-[rgba(224,82,6,0.15)] text-[#E05206] font-mono">CUSTOM</span>}
            <p className="text-[10px] text-[#4A5A72] font-mono">{labels.length} type{labels.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <input
          type="text" value={cfg.shortCode} maxLength={6}
          onChange={e => onChange({ shortCode: e.target.value.toUpperCase() })}
          className="bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.2)] rounded px-2 py-1.5 text-xs font-mono text-white text-center focus:outline-none focus:border-[#4A6FA5] uppercase"
        />

        <input
          type="color" value={cfg.color}
          onChange={e => onChange({ color: e.target.value })}
          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
        />

        <select
          value={cfg.severity}
          onChange={e => onChange({ severity: e.target.value as Severity })}
          className="bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.2)] rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#4A6FA5]"
          style={{ color: SEV_COLORS[cfg.severity] }}
        >
          {SEVERITIES.map(s => (
            <option key={s} value={s} style={{ color: SEV_COLORS[s], backgroundColor: '#0F1729' }}>{s}</option>
          ))}
        </select>

        <button
          onClick={() => onChange({ showInSummary: !cfg.showInSummary })}
          className={cn(
            'flex items-center justify-center w-full h-7 rounded text-xs font-mono transition-all',
            cfg.showInSummary
              ? 'bg-[rgba(39,174,96,0.15)] border border-[rgba(39,174,96,0.4)] text-[#27AE60]'
              : 'bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.2)] text-[#4A5A72]'
          )}
          title={cfg.showInSummary ? 'In KPI summary — click to hide' : 'Not in KPI — click to show'}
        >
          {cfg.showInSummary ? <Check size={12} /> : <span className="text-[10px]">OFF</span>}
        </button>

        {cfg.isCustom ? (
          <button
            onClick={handleDelete}
            className={cn(
              'p-1 rounded transition-colors',
              confirmDelete ? 'text-red-400 bg-[rgba(192,57,43,0.15)]' : 'text-[#4A5A72] hover:text-red-400'
            )}
            title={confirmDelete ? 'Click again to confirm delete' : 'Delete custom group'}
          >
            <Trash2 size={12} />
          </button>
        ) : <span />}
      </div>

      {expanded && (
        <div className="px-4 py-3 bg-[rgba(74,111,165,0.04)] border-t border-[rgba(74,111,165,0.1)]">
          <p className="text-[10px] text-[#4A5A72] mb-2 font-mono uppercase tracking-wider">
            CCIL incident types in this group ({labels.length})
          </p>
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map(label => (
                <LabelChip
                  key={label} label={label} currentGroup={groupKey}
                  allGroups={allGroups} color={cfg.color}
                  onMove={onMoveLabel}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#4A5A72] italic">No CCIL types in this group. Add some below.</p>
          )}
          <AddLabelSearch
            groupKey={groupKey}
            settings={settings}
            onAdd={(norm) => onMoveLabel(norm, groupKey)}
          />
        </div>
      )}
    </div>
  )
}

// ─── Add new group form ───────────────────────────────────────────────────────

function AddGroupForm({
  onSubmit, onCancel,
}: {
  onSubmit: (cfg: Omit<CategoryGroupConfig, 'priority' | 'isCustom'>) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName]     = useState('')
  const [shortCode, setShortCode]         = useState('')
  const [color, setColor]                 = useState('#4A6FA5')
  const [severity, setSeverity]           = useState<Severity>('LOW')
  const [showInSummary, setShowInSummary] = useState(false)

  const autoCode = displayName
    .replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5) || 'NEW'
  const effectiveCode = shortCode || autoCode

  const handleSubmit = () => {
    if (!displayName.trim()) return
    onSubmit({ displayName: displayName.trim(), shortCode: effectiveCode, color, severity, showInSummary })
    setDisplayName(''); setShortCode(''); setColor('#4A6FA5'); setSeverity('LOW'); setShowInSummary(false)
  }

  return (
    <div className="border border-[#E05206] rounded-lg p-4 bg-[rgba(224,82,6,0.05)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">New Group</h3>
        <button onClick={onCancel} className="text-[#7A8BA8] hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_120px_70px_120px_70px_auto] gap-2 items-center">
        <input
          type="text" value={displayName} placeholder="Display name e.g. Signalling Issues"
          onChange={e => setDisplayName(e.target.value)} autoFocus
          className="bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.2)] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#4A6FA5]"
        />
        <input
          type="text" value={shortCode} placeholder={autoCode} maxLength={6}
          onChange={e => setShortCode(e.target.value.toUpperCase())}
          className="bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.2)] rounded px-2 py-1.5 text-xs font-mono text-white text-center focus:outline-none focus:border-[#4A6FA5] uppercase"
        />
        <input
          type="color" value={color} onChange={e => setColor(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
        />
        <select
          value={severity} onChange={e => setSeverity(e.target.value as Severity)}
          className="bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.2)] rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[#4A6FA5]"
          style={{ color: SEV_COLORS[severity] }}
        >
          {SEVERITIES.map(s => (
            <option key={s} value={s} style={{ color: SEV_COLORS[s], backgroundColor: '#0F1729' }}>{s}</option>
          ))}
        </select>
        <button
          onClick={() => setShowInSummary(p => !p)}
          className={cn(
            'h-7 rounded text-xs font-mono',
            showInSummary
              ? 'bg-[rgba(39,174,96,0.15)] border border-[rgba(39,174,96,0.4)] text-[#27AE60]'
              : 'bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.2)] text-[#4A5A72]'
          )}
        >
          {showInSummary ? <Check size={12} className="mx-auto" /> : <span className="text-[10px]">KPI OFF</span>}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!displayName.trim()}
          className="px-3 py-1.5 bg-[#E05206] text-white text-xs font-semibold rounded hover:bg-[#C04706] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Create
        </button>
      </div>
      <p className="text-[10px] text-[#4A5A72] mt-2 font-mono">
        After creating, expand the group and assign CCIL incident types to it.
      </p>
    </div>
  )
}

// ─── Export modal ─────────────────────────────────────────────────────────────

function ExportModal({ settings, onClose }: { settings: CategorySettings; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const json = useMemo(() => JSON.stringify(settings, null, 2), [settings])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-[#0F1729] border border-[rgba(74,111,165,0.4)] rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(74,111,165,0.2)]">
          <div>
            <h2 className="text-white text-base font-semibold">Export Settings</h2>
            <p className="text-xs text-[#7A8BA8] mt-0.5">
              Paste the JSON below in the development chat to make these settings the permanent default.
            </p>
          </div>
          <button onClick={onClose} className="text-[#7A8BA8] hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <textarea
            value={json} readOnly
            className="w-full h-[55vh] bg-[#0A0F1E] border border-[rgba(74,111,165,0.2)] rounded p-3 text-xs font-mono text-[#D0D7E2] resize-none focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-[rgba(74,111,165,0.2)]">
          <p className="text-xs text-[#4A5A72] font-mono">{json.length.toLocaleString()} characters</p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#E05206] text-white text-sm font-semibold rounded hover:bg-[#C04706] transition-colors"
            >
              {copied ? <><Check size={14} /> Copied</> : <><Download size={14} /> Copy to Clipboard</>}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[rgba(74,111,165,0.4)] text-[#7A8BA8] text-sm rounded hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    settings, saveStatus, isLoaded,
    updateGroup, addGroup, removeGroup, moveLabelToGroup, resetToDefaults,
  } = useCategorySettings()

  const [resetConfirm, setResetConfirm]   = useState(false)
  const [showExport, setShowExport]       = useState(false)
  const [showAddGroup, setShowAddGroup]   = useState(false)

  const allGroups = useMemo(() =>
    (Object.entries(settings.groups) as Array<[string, CategoryGroupConfig]>)
      .sort(([, a], [, b]) => a.priority - b.priority),
    [settings.groups]
  )

  const summaryCount = allGroups.filter(([, c]) => c.showInSummary).length
  const overrideCount = Object.keys(settings.labelOverrides).length
  const customCount = settings.customGroupKeys.length

  const handleReset = () => {
    if (resetConfirm) { resetToDefaults(); setResetConfirm(false) }
    else { setResetConfirm(true); setTimeout(() => setResetConfirm(false), 3000) }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>

      <header className="border-b border-[rgba(74,111,165,0.2)] bg-[#0F1729] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(0 0,100% 0,80% 100%,0 100%)' }} />
              <div className="w-3 h-5 bg-[#E05206]" style={{ clipPath: 'polygon(20% 0,100% 0,100% 100%,0 100%)' }} />
            </div>
            <div>
              <p className="text-white text-sm font-bold leading-none">Network Rail</p>
              <p className="text-[#7A8BA8] text-xs leading-none">Category Settings</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <StatusBadge status={saveStatus} />
            <Link href="/" className="flex items-center gap-1.5 text-xs text-[#7A8BA8] hover:text-white transition-colors font-mono">
              <ArrowLeft size={12} /> Back to Report Generator
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-white">Incident Category Settings</h1>
            <p className="text-sm text-[#7A8BA8] mt-1">
              Configure groups, reassign CCIL incident types, control KPI summary visibility.
              {isSupabaseConfigured()
                ? ' Changes sync globally to all users via Supabase.'
                : ' Changes save to this browser only — configure Supabase for global sync.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border border-[rgba(74,111,165,0.3)] text-[#7A8BA8] hover:text-white hover:border-[rgba(74,111,165,0.6)] transition-colors"
            >
              <Download size={11} /> Export Settings
            </button>
            <button
              onClick={handleReset}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-all',
                resetConfirm
                  ? 'border-red-500 text-red-400 bg-[rgba(192,57,43,0.1)]'
                  : 'border-[rgba(74,111,165,0.3)] text-[#7A8BA8] hover:text-white hover:border-[rgba(74,111,165,0.6)]'
              )}
            >
              <RotateCcw size={11} /> {resetConfirm ? 'Confirm reset?' : 'Reset to defaults'}
            </button>
          </div>
        </div>

        {!isLoaded && (
          <div className="card p-4 flex items-center gap-3 text-sm text-[#7A8BA8]">
            <Loader2 size={14} className="animate-spin" /> Loading settings…
          </div>
        )}

        <div className="grid grid-cols-[24px_1fr_120px_70px_120px_70px_28px] gap-2 px-3 py-2">
          <span />
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Display Name / Key</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Short Code</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Colour</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Severity</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider text-center">KPI</span>
          <span />
        </div>

        <div className="space-y-2">
          {allGroups.map(([groupKey, cfg]) => (
            <GroupRow
              key={groupKey}
              groupKey={groupKey}
              cfg={cfg}
              settings={settings}
              allGroups={allGroups}
              onChange={patch => updateGroup(groupKey, patch)}
              onDelete={cfg.isCustom ? () => removeGroup(groupKey) : undefined}
              onMoveLabel={moveLabelToGroup}
            />
          ))}
        </div>

        {showAddGroup ? (
          <AddGroupForm
            onSubmit={cfg => { addGroup(cfg); setShowAddGroup(false) }}
            onCancel={() => setShowAddGroup(false)}
          />
        ) : (
          <button
            onClick={() => setShowAddGroup(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[rgba(74,111,165,0.4)] rounded-lg text-[#7A8BA8] hover:text-white hover:border-[#4A6FA5] transition-colors"
          >
            <Plus size={14} /> <span className="text-sm font-medium">Add New Group</span>
          </button>
        )}

        <div className="text-xs text-[#4A5A72] space-y-1 pt-4 border-t border-[rgba(74,111,165,0.15)]">
          <p>
            <span className="text-[#7A8BA8]">{allGroups.length}</span> total groups
            ({customCount} custom)
            · <span className="text-[#7A8BA8]">{summaryCount}</span> in KPI summary
            · <span className="text-[#7A8BA8]">{overrideCount}</span> CCIL label override{overrideCount !== 1 ? 's' : ''}
            · <span className="text-[#7A8BA8]">{CCIL_LABEL_MAP.length}</span> total CCIL types
          </p>
          <p>
            Move a CCIL type by changing the dropdown next to its label chip.
            Add a type to a group via the search box at the bottom of each group&apos;s expanded panel.
          </p>
          <p>
            Use <span className="text-[#7A8BA8]">Export Settings</span> to copy the current configuration as JSON;
            paste it in the development chat to have it baked in as the new permanent default.
          </p>
        </div>
      </main>

      {showExport && <ExportModal settings={settings} onClose={() => setShowExport(false)} />}
    </div>
  )
}

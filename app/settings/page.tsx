'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, RotateCcw, ArrowLeft, Check } from 'lucide-react'
import { IncidentCategory, Severity } from '@/lib/types'
import { useCategorySettings, DEFAULT_GROUP_CONFIG, CategoryGroupConfig } from '@/lib/categorySettings'
import { CCIL_LABEL_MAP } from '@/lib/ccilParser'

// ─── Build a map of DLog2 category → CCIL labels ─────────────────────────────

const LABELS_BY_GROUP: Partial<Record<IncidentCategory, string[]>> = {}
for (const [label, cat] of CCIL_LABEL_MAP) {
  if (!LABELS_BY_GROUP[cat]) LABELS_BY_GROUP[cat] = []
  LABELS_BY_GROUP[cat]!.push(label)
}

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

const SEV_COLORS: Record<Severity, string> = {
  CRITICAL: '#E74C3C',
  HIGH:     '#E05206',
  MEDIUM:   '#F39C12',
  LOW:      '#4A6FA5',
  INFO:     '#7A8BA8',
}

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(' ')
}

// ─── Row component ────────────────────────────────────────────────────────────

function CategoryRow({
  cat,
  cfg,
  onChange,
}: {
  cat: IncidentCategory
  cfg: CategoryGroupConfig
  onChange: (patch: Partial<CategoryGroupConfig>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const labels = LABELS_BY_GROUP[cat] || []
  const isDefault = JSON.stringify(cfg) === JSON.stringify(DEFAULT_GROUP_CONFIG[cat])

  return (
    <div className="border border-[rgba(74,111,165,0.2)] rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="grid grid-cols-[1fr_120px_90px_130px_80px_32px] gap-3 items-center px-4 py-3 bg-[#0F1729]">

        {/* Display name */}
        <div className="space-y-0.5">
          <input
            type="text"
            value={cfg.displayName}
            onChange={e => onChange({ displayName: e.target.value })}
            className="w-full bg-transparent text-white text-sm font-medium border-b border-transparent hover:border-[rgba(74,111,165,0.4)] focus:border-[#4A6FA5] outline-none py-0.5 transition-colors"
          />
          <p className="text-xs text-[#4A5A72] font-mono">{cat}</p>
        </div>

        {/* Short code */}
        <input
          type="text"
          value={cfg.shortCode}
          maxLength={6}
          onChange={e => onChange({ shortCode: e.target.value.toUpperCase() })}
          className="bg-[rgba(74,111,165,0.1)] border border-[rgba(74,111,165,0.2)] rounded px-2 py-1.5 text-xs font-mono text-white text-center focus:outline-none focus:border-[#4A6FA5] uppercase"
        />

        {/* Colour */}
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={cfg.color}
            onChange={e => onChange({ color: e.target.value })}
            className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
            style={{ accentColor: cfg.color }}
          />
          <span className="text-[10px] text-[#4A5A72] font-mono hidden lg:inline">{cfg.color}</span>
        </div>

        {/* Severity */}
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

        {/* Show in summary toggle */}
        <button
          onClick={() => onChange({ showInSummary: !cfg.showInSummary })}
          className={cn(
            'flex items-center justify-center w-full h-7 rounded text-xs font-mono transition-all',
            cfg.showInSummary
              ? 'bg-[rgba(39,174,96,0.15)] border border-[rgba(39,174,96,0.4)] text-[#27AE60]'
              : 'bg-[rgba(74,111,165,0.08)] border border-[rgba(74,111,165,0.2)] text-[#4A5A72]'
          )}
          title={cfg.showInSummary ? 'Shown in KPI summary — click to hide' : 'Not in KPI summary — click to show'}
        >
          {cfg.showInSummary ? <Check size={12} /> : <span className="text-[10px]">OFF</span>}
        </button>

        {/* Expand labels */}
        <button
          onClick={() => setExpanded(p => !p)}
          className="text-[#4A5A72] hover:text-white transition-colors"
          title={`${labels.length} CCIL type${labels.length !== 1 ? 's' : ''} in this group`}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* Expanded CCIL labels */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 bg-[rgba(74,111,165,0.04)] border-t border-[rgba(74,111,165,0.1)]">
          <p className="text-[10px] text-[#4A5A72] mb-2 font-mono uppercase tracking-wider">
            CCIL incident types mapped to this group ({labels.length})
          </p>
          {labels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map(l => (
                <span
                  key={l}
                  className="text-xs px-2 py-0.5 rounded border border-[rgba(74,111,165,0.25)] text-[#7A8BA8] font-mono"
                  style={{ backgroundColor: `${cfg.color}10` }}
                >
                  {l}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#4A5A72] italic">No CCIL labels directly mapped — classified by type code or text patterns.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { settings, updateCategory, resetToDefaults } = useCategorySettings()
  const [resetConfirm, setResetConfirm] = useState(false)
  const [saved, setSaved] = useState(false)

  const sorted = (Object.entries(settings) as [IncidentCategory, CategoryGroupConfig][])
    .sort(([, a], [, b]) => a.priority - b.priority)

  const summaryCount = sorted.filter(([, c]) => c.showInSummary).length

  const handleReset = () => {
    if (resetConfirm) {
      resetToDefaults()
      setResetConfirm(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setResetConfirm(true)
      setTimeout(() => setResetConfirm(false), 3000)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>

      {/* Header */}
      <header className="border-b border-[rgba(74,111,165,0.2)] bg-[#0F1729] sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
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
          <Link href="/" className="flex items-center gap-1.5 text-xs text-[#7A8BA8] hover:text-white transition-colors font-mono">
            <ArrowLeft size={12} />
            Back to Report Generator
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Page title */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Incident Category Settings</h1>
            <p className="text-sm text-[#7A8BA8] mt-1">
              Configure display names, short codes, colours, auto-severity and KPI summary visibility
              for each incident group. Changes save automatically to this browser.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-xs text-[#27AE60] font-mono flex items-center gap-1">
                <Check size={11} /> Saved
              </span>
            )}
            <button
              onClick={handleReset}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-all',
                resetConfirm
                  ? 'border-red-500 text-red-400 bg-[rgba(192,57,43,0.1)]'
                  : 'border-[rgba(74,111,165,0.3)] text-[#7A8BA8] hover:text-white hover:border-[rgba(74,111,165,0.6)]'
              )}
            >
              <RotateCcw size={11} />
              {resetConfirm ? 'Confirm reset?' : 'Reset to defaults'}
            </button>
          </div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_120px_90px_130px_80px_32px] gap-3 px-4 py-2">
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Display Name / Key</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Short Code</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Colour</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider">Auto Severity</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider text-center">KPI</span>
          <span className="text-[10px] text-[#4A5A72] font-mono uppercase tracking-wider text-center">Types</span>
        </div>

        {/* Category rows */}
        <div className="space-y-2">
          {sorted.map(([cat, cfg]) => (
            <CategoryRow
              key={cat}
              cat={cat as IncidentCategory}
              cfg={cfg}
              onChange={patch => {
                updateCategory(cat as IncidentCategory, patch)
                setSaved(true)
                setTimeout(() => setSaved(false), 1500)
              }}
            />
          ))}
        </div>

        {/* Footer info */}
        <div className="text-xs text-[#4A5A72] space-y-1 pt-4 border-t border-[rgba(74,111,165,0.15)]">
          <p><span className="text-[#7A8BA8]">{summaryCount}</span> groups shown in KPI summary  ·  <span className="text-[#7A8BA8]">{CCIL_LABEL_MAP.length}</span> CCIL incident types mapped</p>
          <p>Settings are stored in your browser (localStorage). They apply to this device only and are not included in the generated PDF.</p>
          <p>The <span className="text-[#7A8BA8]">Short Code</span> appears on incident badges. <span className="text-[#7A8BA8]">Auto Severity</span> is assigned during parsing — high delays will escalate severity further. <span className="text-[#7A8BA8]">KPI toggle</span> controls which groups appear in the pre-generate summary and in the PDF's safety statistics box.</p>
        </div>
      </main>
    </div>
  )
}

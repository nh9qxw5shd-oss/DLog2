'use client'

import { useState, useEffect } from 'react'
import { IncidentCategory, Severity } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryGroupConfig {
  displayName: string    // label shown in UI and PDF headers
  shortCode: string      // badge code shown on incident cards (max 6 chars)
  color: string          // hex colour for icon + badge
  severity: Severity     // default severity assigned during parsing
  showInSummary: boolean // include this group in the safety KPI summary
  kpiGroup?: string      // optional — categories sharing a kpiGroup are summed together
  priority: number       // display / sort order
}

const STORAGE_KEY = 'dlog2-category-settings-v1'

// ─── Defaults ─────────────────────────────────────────────────────────────────
// showInSummary reflects the requested KPI set:
//   Person Struck, SPADs, TPWS, Near Miss, Crime/Trespass, Irregular Working

export const DEFAULT_GROUP_CONFIG: Record<IncidentCategory, CategoryGroupConfig> = {
  FATALITY:          { displayName: 'Person Struck / Fatality',    shortCode: 'PST',   color: '#E74C3C', severity: 'CRITICAL', showInSummary: true,  kpiGroup: 'person-struck', priority: 1  },
  PERSON_STRUCK:     { displayName: 'Person Struck by Train',      shortCode: 'PST',   color: '#E74C3C', severity: 'CRITICAL', showInSummary: true,  kpiGroup: 'person-struck', priority: 2  },
  SPAD:              { displayName: 'Signal Passed at Danger',     shortCode: 'SPAD',  color: '#E05206', severity: 'HIGH',     showInSummary: true,  priority: 3  },
  TPWS:              { displayName: 'TPWS Activation',             shortCode: 'TPWS',  color: '#E05206', severity: 'MEDIUM',   showInSummary: true,  priority: 4  },
  IRREGULAR_WORKING: { displayName: 'Irregular Working',           shortCode: 'IRR',   color: '#F39C12', severity: 'MEDIUM',   showInSummary: true,  priority: 5  },
  NEAR_MISS:         { displayName: 'Near Miss',                   shortCode: 'NM',    color: '#F39C12', severity: 'MEDIUM',   showInSummary: true,  priority: 6  },
  CRIME:             { displayName: 'Crime / Trespass',            shortCode: 'CRIME', color: '#9B59B6', severity: 'MEDIUM',   showInSummary: true,  priority: 7  },
  BRIDGE_STRIKE:     { displayName: 'Bridge Strike',               shortCode: 'BSTR',  color: '#F39C12', severity: 'HIGH',     showInSummary: false, priority: 8  },
  HABD_WILD:         { displayName: 'HABD / WILD Activation',      shortCode: 'HABD',  color: '#F39C12', severity: 'MEDIUM',   showInSummary: false, priority: 9  },
  LEVEL_CROSSING:    { displayName: 'Level Crossing',              shortCode: 'LC',    color: '#E05206', severity: 'MEDIUM',   showInSummary: false, priority: 10 },
  FIRE:              { displayName: 'Fire / Lineside',             shortCode: 'FIRE',  color: '#E74C3C', severity: 'HIGH',     showInSummary: false, priority: 11 },
  PASSENGER_INJURY:  { displayName: 'Passenger / Public Injury',   shortCode: 'PAX',   color: '#E05206', severity: 'MEDIUM',   showInSummary: false, priority: 12 },
  DERAILMENT:        { displayName: 'Derailment / Collision',      shortCode: 'DERL',  color: '#E74C3C', severity: 'CRITICAL', showInSummary: false, priority: 13 },
  INFRASTRUCTURE:    { displayName: 'Infrastructure Failure',      shortCode: 'INFRA', color: '#4A6FA5', severity: 'LOW',      showInSummary: false, priority: 14 },
  TRACTION_FAILURE:  { displayName: 'OHL / Traction Failure',      shortCode: 'OLE',   color: '#4A6FA5', severity: 'MEDIUM',   showInSummary: false, priority: 15 },
  TRAIN_FAULT:       { displayName: 'Train Fault / Failure',       shortCode: 'TFLT',  color: '#6B7FA5', severity: 'LOW',      showInSummary: false, priority: 16 },
  POSSESSION:        { displayName: 'Possession Issue',            shortCode: 'POSS',  color: '#4A6FA5', severity: 'LOW',      showInSummary: false, priority: 17 },
  STATION_OVERRUN:   { displayName: 'Station Overrun',             shortCode: 'OVRUN', color: '#7A8BA8', severity: 'MEDIUM',   showInSummary: false, priority: 18 },
  STRANDED_TRAIN:    { displayName: 'Stranded Train',              shortCode: 'STRD',  color: '#7A8BA8', severity: 'INFO',     showInSummary: false, priority: 19 },
  WEATHER:           { displayName: 'Weather Event',               shortCode: 'WX',    color: '#4A6FA5', severity: 'INFO',     showInSummary: false, priority: 20 },
  GENERAL:           { displayName: 'General / Other',             shortCode: 'GEN',   color: '#4A6FA5', severity: 'INFO',     showInSummary: false, priority: 21 },
}

// ─── Load / merge helpers ─────────────────────────────────────────────────────

function loadSettings(): Record<IncidentCategory, CategoryGroupConfig> {
  if (typeof window === 'undefined') return { ...DEFAULT_GROUP_CONFIG }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<IncidentCategory, Partial<CategoryGroupConfig>>>
      const merged: Record<IncidentCategory, CategoryGroupConfig> = { ...DEFAULT_GROUP_CONFIG }
      for (const [k, v] of Object.entries(parsed)) {
        const cat = k as IncidentCategory
        if (merged[cat] && v) merged[cat] = { ...merged[cat], ...v }
      }
      return merged
    }
  } catch {}
  return { ...DEFAULT_GROUP_CONFIG }
}

function saveSettings(s: Record<IncidentCategory, CategoryGroupConfig>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

// ─── React hook ───────────────────────────────────────────────────────────────

export function useCategorySettings() {
  const [settings, setSettings] = useState<Record<IncidentCategory, CategoryGroupConfig>>(DEFAULT_GROUP_CONFIG)

  useEffect(() => { setSettings(loadSettings()) }, [])

  const updateCategory = (cat: IncidentCategory, patch: Partial<CategoryGroupConfig>) =>
    setSettings(prev => {
      const next = { ...prev, [cat]: { ...prev[cat], ...patch } }
      saveSettings(next)
      return next
    })

  const resetToDefaults = () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    setSettings({ ...DEFAULT_GROUP_CONFIG })
  }

  return { settings, updateCategory, resetToDefaults }
}

/** Synchronous read for use outside React (e.g. pdfGenerator). Falls back to defaults. */
export function readCategorySettings(): Record<IncidentCategory, CategoryGroupConfig> {
  return loadSettings()
}

// ─── KPI summary builder ──────────────────────────────────────────────────────
// Groups categories that share a kpiGroup key, returning one row per unique
// (kpiGroup | category) with the summed count.

export interface KpiRow {
  label: string
  count: number
  urgent: boolean
}

export function buildKpiRows(
  incidents: { category: IncidentCategory }[],
  settings: Record<IncidentCategory, CategoryGroupConfig>
): KpiRow[] {
  const seen = new Set<string>()
  const rows: KpiRow[] = []

  const sorted = Object.entries(settings)
    .sort(([, a], [, b]) => a.priority - b.priority)

  for (const [cat, cfg] of sorted) {
    if (!cfg.showInSummary) continue
    const key = cfg.kpiGroup ?? cat
    if (seen.has(key)) continue
    seen.add(key)

    const peers = Object.entries(settings)
      .filter(([, c]) => (c.kpiGroup ?? c.priority.toString()) === key || (cfg.kpiGroup && c.kpiGroup === cfg.kpiGroup))
      .map(([k]) => k as IncidentCategory)

    const count = incidents.filter(i => peers.includes(i.category)).length
    rows.push({
      label: cfg.displayName,
      count,
      urgent: cfg.severity === 'CRITICAL' || cfg.severity === 'HIGH',
    })
  }
  return rows
}

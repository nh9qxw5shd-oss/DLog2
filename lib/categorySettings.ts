'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { IncidentCategory, Severity } from './types'
import { CCIL_LABEL_MAP, normalizeForLookup } from './ccilParser'
import { saveAppSettings, loadAppSettings, isSupabaseConfigured } from './supabaseClient'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryGroupConfig {
  displayName: string
  shortCode: string
  color: string
  severity: Severity
  showInSummary: boolean
  kpiGroup?: string
  priority: number
  isCustom?: boolean
}

export interface CategorySettings {
  version: 1
  /** All group configs — built-in IncidentCategory keys plus any custom keys */
  groups: Record<string, CategoryGroupConfig>
  /** normalizedCcilLabel → groupKey (overrides the default from CCIL_LABEL_MAP) */
  labelOverrides: Record<string, string>
  /** Group keys the user has created (subset of groups that are custom) */
  customGroupKeys: string[]
}

export type SaveStatus = 'idle' | 'saving' | 'saved-local' | 'saved-cloud' | 'error'

// ─── Defaults ─────────────────────────────────────────────────────────────────

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

function defaultSettings(): CategorySettings {
  return { version: 1, groups: { ...DEFAULT_GROUP_CONFIG }, labelOverrides: {}, customGroupKeys: [] }
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const STORAGE_KEY = 'dlog2-category-settings-v2'

function mergeWithDefaults(partial: Partial<CategorySettings>): CategorySettings {
  const d = defaultSettings()
  return {
    version: 1,
    groups:         { ...d.groups, ...(partial.groups        ?? {}) },
    labelOverrides: partial.labelOverrides ?? {},
    customGroupKeys: partial.customGroupKeys ?? [],
  }
}

function loadFromLocalStorage(): CategorySettings {
  if (typeof window === 'undefined') return defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return mergeWithDefaults(JSON.parse(raw))
  } catch {}
  return defaultSettings()
}

function saveToLocalStorage(s: CategorySettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

// ─── Label helpers (exported for settings page) ───────────────────────────────

/** Returns all CCIL labels currently assigned to a group (default + overrides applied). */
export function getLabelsForGroup(settings: CategorySettings, groupKey: string): string[] {
  return CCIL_LABEL_MAP
    .filter(([label, defaultGroup]) => {
      const norm = normalizeForLookup(label)
      const effective = settings.labelOverrides[norm] ?? defaultGroup
      return effective === groupKey
    })
    .map(([label]) => label)
}

/** Returns all CCIL labels that have no override (their default group). */
export function getUnassignedLabels(settings: CategorySettings): string[] {
  return CCIL_LABEL_MAP
    .filter(([label]) => !settings.labelOverrides[normalizeForLookup(label)])
    .map(([label]) => label)
}

/** Sorted list of all group keys, built-in first then custom. */
export function sortedGroupKeys(settings: CategorySettings): string[] {
  return Object.entries(settings.groups)
    .sort(([, a], [, b]) => a.priority - b.priority)
    .map(([k]) => k)
}

// ─── React hook ───────────────────────────────────────────────────────────────

export function useCategorySettings() {
  const [settings, setSettings]     = useState<CategorySettings>(defaultSettings)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [isLoaded, setIsLoaded]     = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  // Mount: load localStorage instantly, then sync from Supabase
  useEffect(() => {
    const local = loadFromLocalStorage()
    setSettings(local)
    setIsLoaded(true)

    if (isSupabaseConfigured()) {
      loadAppSettings()
        .then(remote => {
          if (remote) {
            const merged = mergeWithDefaults(remote as Partial<CategorySettings>)
            setSettings(merged)
            saveToLocalStorage(merged)
          }
        })
        .catch(() => {})
    }
  }, [])

  const persistSave = useCallback((next: CategorySettings) => {
    saveToLocalStorage(next)

    if (!isSupabaseConfigured()) {
      setSaveStatus('saved-local')
      setTimeout(() => setSaveStatus('idle'), 2000)
      return
    }

    setSaveStatus('saving')
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        await saveAppSettings(next)
        setSaveStatus('saved-cloud')
      } catch {
        setSaveStatus('error')
      }
      setTimeout(() => setSaveStatus('idle'), 3000)
    }, 800)
  }, [])

  const update = useCallback((fn: (prev: CategorySettings) => CategorySettings) => {
    setSettings(prev => {
      const next = fn(prev)
      persistSave(next)
      return next
    })
  }, [persistSave])

  // ── Group config edits ──────────────────────────────────────────────────────

  const updateGroup = useCallback((key: string, patch: Partial<CategoryGroupConfig>) =>
    update(prev => ({
      ...prev,
      groups: { ...prev.groups, [key]: { ...prev.groups[key], ...patch } },
    })), [update])

  const addGroup = useCallback((cfg: Omit<CategoryGroupConfig, 'priority' | 'isCustom'>) => {
    const key = cfg.displayName.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 24)
    update(prev => {
      const maxPri = Math.max(...Object.values(prev.groups).map(g => g.priority), 0)
      return {
        ...prev,
        groups: { ...prev.groups, [key]: { ...cfg, isCustom: true, priority: maxPri + 1 } },
        customGroupKeys: [...prev.customGroupKeys, key],
      }
    })
    return key
  }, [update])

  const removeGroup = useCallback((key: string) =>
    update(prev => {
      const newOverrides = Object.fromEntries(
        Object.entries(prev.labelOverrides).filter(([, v]) => v !== key)
      )
      const { [key]: _gone, ...newGroups } = prev.groups
      return {
        ...prev,
        groups: newGroups,
        labelOverrides: newOverrides,
        customGroupKeys: prev.customGroupKeys.filter(k => k !== key),
      }
    }), [update])

  // ── Label assignment ────────────────────────────────────────────────────────

  const moveLabelToGroup = useCallback((normalizedLabel: string, targetGroupKey: string) =>
    update(prev => {
      const defaultGroup = CCIL_LABEL_MAP
        .find(([l]) => normalizeForLookup(l) === normalizedLabel)?.[1] ?? 'GENERAL'
      const newOverrides = { ...prev.labelOverrides }
      if (targetGroupKey === defaultGroup) {
        delete newOverrides[normalizedLabel]   // revert to default — no override needed
      } else {
        newOverrides[normalizedLabel] = targetGroupKey
      }
      return { ...prev, labelOverrides: newOverrides }
    }), [update])

  const resetToDefaults = useCallback(() => {
    const fresh = defaultSettings()
    setSettings(fresh)
    persistSave(fresh)
  }, [persistSave])

  return {
    settings,
    saveStatus,
    isLoaded,
    updateGroup,
    addGroup,
    removeGroup,
    moveLabelToGroup,
    resetToDefaults,
  }
}

// ─── Synchronous read (for use at parse time, outside React) ─────────────────

export function readCategorySettings(): CategorySettings {
  return loadFromLocalStorage()
}

// ─── KPI row builder ──────────────────────────────────────────────────────────

export interface KpiRow { label: string; count: number; urgent: boolean }

export function buildKpiRows(
  incidents: { category: string; displayGroup?: string }[],
  settings: CategorySettings
): KpiRow[] {
  const seen = new Set<string>()
  const rows: KpiRow[] = []

  for (const [key, cfg] of Object.entries(settings.groups).sort(([, a], [, b]) => a.priority - b.priority)) {
    if (!cfg.showInSummary) continue
    const kpiKey = cfg.kpiGroup ?? key
    if (seen.has(kpiKey)) continue
    seen.add(kpiKey)

    // Collect all group keys that share this kpiGroup
    const peerKeys = cfg.kpiGroup
      ? Object.entries(settings.groups)
          .filter(([, c]) => c.kpiGroup === cfg.kpiGroup)
          .map(([k]) => k)
      : [key]

    const count = incidents.filter(i => {
      const effective = i.displayGroup ?? i.category
      return peerKeys.includes(effective)
    }).length

    rows.push({
      label: cfg.displayName,
      count,
      urgent: cfg.severity === 'CRITICAL' || cfg.severity === 'HIGH',
    })
  }
  return rows
}

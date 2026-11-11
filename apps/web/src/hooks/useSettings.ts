import { useState, useCallback, useEffect } from 'react'

export interface PlugoStore {
  id: string
  name: string
  key: string
}

export interface AppSettings {
  stores: PlugoStore[]
  activeStoreId: string
  activeAI: 'claude' | 'openai'
  anthropicApiKey: string
  claudeModel: string
  claudeEffort: string
  openaiApiKey: string
  openaiModel: string
  openaiEffort: string
}

const DEFAULTS: AppSettings = {
  stores: [],
  activeStoreId: '',
  activeAI: 'claude',
  anthropicApiKey: '',
  claudeModel: 'claude-sonnet-5-5',
  claudeEffort: 'medium',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  openaiEffort: 'medium',
}

/** Derive the active store object from settings */
export function activeStore(s: AppSettings): PlugoStore | undefined {
  return s.stores.find(st => st.id === s.activeStoreId) ?? s.stores[0]
}

const LS_KEY = 'plugo_cloner_settings'

function loadLocal(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    // Migrate old single-store format → stores array
    if (!parsed.stores && (parsed.plugoStoreKey || parsed.plugoStoreName)) {
      const migrated: PlugoStore = { id: 'store-1', name: parsed.plugoStoreName || 'My Store', key: parsed.plugoStoreKey || '' }
      parsed.stores = [migrated]
      parsed.activeStoreId = 'store-1'
      delete parsed.plugoStoreKey
      delete parsed.plugoStoreName
    }
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveLocal(s: AppSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
}

async function fetchServerSettings(): Promise<Partial<AppSettings>> {
  try {
    const res = await fetch('http://localhost:3000/settings')
    if (!res.ok) return {}
    return await res.json()
  } catch {
    return {}
  }
}

export async function saveSettingsToServer(s: AppSettings): Promise<void> {
  await fetch('http://localhost:3000/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadLocal)

  // Merge server .env values on first load (server wins over localStorage defaults)
  useEffect(() => {
    fetchServerSettings().then(server => {
      if (Object.keys(server).length === 0) return
      setSettings(prev => {
        const merged = { ...prev, ...server }
        saveLocal(merged)
        return merged
      })
    })
  }, [])

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveLocal(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem(LS_KEY)
    setSettings({ ...DEFAULTS })
  }, [])

  return { settings, update, reset }
}

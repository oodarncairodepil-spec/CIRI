import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useSettings, saveSettingsToServer } from '@/hooks/useSettings'
import type { PlugoStore } from '@/hooks/useSettings'

const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5',   label: 'Claude Opus 5.5 (Most capable)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Balanced)' },
  { id: 'claude-haiku-5-5',  label: 'Claude Haiku 5.5 (Fast)' },
]

const OPENAI_MODELS = [
  { id: 'gpt-6-luna',   label: 'GPT-6 Luna (Latest)' },
  { id: 'o3',           label: 'o3 (Highest reasoning)' },
  { id: 'o4-mini',      label: 'o4-mini (Fast reasoning)' },
  { id: 'gpt-4o',       label: 'GPT-4o (Balanced)' },
  { id: 'gpt-4o-mini',  label: 'GPT-4o mini (Fast)' },
]

const CLAUDE_EFFORT_LEVELS = [
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
]

const OPENAI_EFFORT_LEVELS = [
  { id: 'none',   label: 'None' },
  { id: 'low',    label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high',   label: 'High' },
  { id: 'xhigh',  label: 'xHigh' },
  { id: 'max',    label: 'Max' },
]

function MaskedInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex gap-2">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm font-mono focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50"
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function SectionCard({ title, description, active, children }: {
  title: string
  description?: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border bg-white p-6 ${active ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-gray-200'}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
        {active && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Active
          </span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

function EffortPicker({ levels, value, onChange }: {
  levels: { id: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {levels.map(e => (
        <button
          key={e.id}
          type="button"
          onClick={() => onChange(e.id)}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors capitalize
            ${value === e.id
              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
        >
          {e.label}
        </button>
      ))}
    </div>
  )
}


export function SettingsPage() {
  const { settings, update, reset } = useSettings()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveSettingsToServer(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not save to .env — is the mock API running?')
    } finally {
      setSaving(false)
    }
  }

  function addStore() {
    const newStore: PlugoStore = { id: `store-${Date.now()}`, name: '', key: '' }
    const stores = [...settings.stores, newStore]
    update({ stores, activeStoreId: settings.activeStoreId || newStore.id })
  }

  function updateStore(id: string, patch: Partial<PlugoStore>) {
    update({ stores: settings.stores.map(s => s.id === id ? { ...s, ...patch } : s) })
  }

  function removeStore(id: string) {
    const stores = settings.stores.filter(s => s.id !== id)
    const activeStoreId = settings.activeStoreId === id ? (stores[0]?.id ?? '') : settings.activeStoreId
    update({ stores, activeStoreId })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Configure your store connection and AI credentials"
      />

      {/* Plugo Stores */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-1">Plugo Stores</p>
        <p className="text-xs text-gray-400 mb-3">Add multiple stores and choose which one is active for Build.</p>

        {/* Store selector cards — same pattern as AI toggle */}
        {settings.stores.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center">
            <p className="text-sm text-gray-400">No stores yet.</p>
            <button type="button" onClick={addStore} className="mt-2 text-xs text-indigo-600 hover:underline">
              Add your first store →
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 mb-4">
            {settings.stores.map(store => {
              const isActive = store.id === settings.activeStoreId || (settings.activeStoreId === '' && settings.stores[0]?.id === store.id)
              return (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => update({ activeStoreId: store.id })}
                  className={`flex-1 min-w-[180px] rounded-lg border-2 p-4 text-left transition-colors ${
                    isActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-800 truncate">
                      {store.name || 'Untitled store'}
                    </span>
                    {isActive && (
                      <span className="h-4 w-4 shrink-0 rounded-full bg-indigo-500 flex items-center justify-center ml-2">
                        <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 font-mono truncate">
                    {store.key ? store.key.slice(0, 14) + '…' : 'No key set'}
                  </p>
                </button>
              )
            })}
            {/* Add store card */}
            <button
              type="button"
              onClick={addStore}
              className="flex-1 min-w-[180px] rounded-lg border-2 border-dashed border-gray-200 p-4 text-center hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors group"
            >
              <svg className="h-5 w-5 text-gray-300 group-hover:text-indigo-400 mx-auto mb-1 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-xs text-gray-400 group-hover:text-indigo-500 transition-colors">Add store</span>
            </button>
          </div>
        )}

        {/* Active store detail — only shown when a store is selected */}
        {(() => {
          const store = settings.stores.find(s => s.id === settings.activeStoreId) ?? settings.stores[0]
          if (!store) return null
          return (
            <SectionCard
              title={store.name || 'Untitled store'}
              description="Configure the active Plugo store credentials."
              active
            >
              <Field label="Store Name" hint="A label to identify this store in your projects.">
                <input
                  type="text"
                  value={store.name}
                  onChange={e => updateStore(store.id, { name: e.target.value })}
                  placeholder="e.g. My Fashion Store"
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                />
              </Field>
              <Field label="Store API Key" hint="Starts with pk_ — available from your Plugo seller dashboard.">
                <MaskedInput
                  value={store.key}
                  onChange={v => updateStore(store.id, { key: v })}
                  placeholder="pk_12345_…"
                />
              </Field>
              {settings.stores.length > 1 && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => removeStore(store.id)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    Remove this store
                  </button>
                </div>
              )}
            </SectionCard>
          )
        })()}
      </div>

      {/* Active AI toggle */}
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-2">Active AI for Build</p>
        <p className="text-xs text-gray-400 mb-3">Only one AI model runs during the Build step. Choose which provider to use.</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => update({ activeAI: 'claude' })}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-colors ${
              settings.activeAI === 'claude'
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800">Claude</span>
              {settings.activeAI === 'claude' && (
                <span className="h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                  <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">{settings.claudeModel}</p>
            <p className="text-xs text-gray-400">Effort: {settings.claudeEffort}</p>
          </button>
          <button
            type="button"
            onClick={() => update({ activeAI: 'openai' })}
            className={`flex-1 rounded-lg border-2 p-4 text-left transition-colors ${
              settings.activeAI === 'openai'
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800">OpenAI</span>
              {settings.activeAI === 'openai' && (
                <span className="h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center">
                  <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">{settings.openaiModel}</p>
            <p className="text-xs text-gray-400">Effort: {settings.openaiEffort}</p>
          </button>
        </div>
      </div>

      {/* Claude / Anthropic */}
      {settings.activeAI === 'claude' && <SectionCard
        title="Claude (Anthropic)"
        description="Used for content generation, component mapping, and migration planning."
        active
      >
        <Field label="Anthropic API Key">
          <MaskedInput
            value={settings.anthropicApiKey}
            onChange={v => update({ anthropicApiKey: v })}
            placeholder="sk-ant-…"
          />
        </Field>
        <Field label="Model">
          <select
            value={settings.claudeModel}
            onChange={e => update({ claudeModel: e.target.value })}
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
          >
            {CLAUDE_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Reasoning Effort" hint="Higher effort produces better results but takes longer and costs more.">
          <EffortPicker
            levels={CLAUDE_EFFORT_LEVELS}
            value={settings.claudeEffort}
            onChange={v => update({ claudeEffort: v })}
          />
        </Field>
      </SectionCard>}

      {/* OpenAI */}
      {settings.activeAI === 'openai' && <SectionCard
        title="OpenAI"
        description="Used as an alternative AI backend for generation tasks."
        active
      >
        <Field label="OpenAI API Key">
          <MaskedInput
            value={settings.openaiApiKey}
            onChange={v => update({ openaiApiKey: v })}
            placeholder="sk-…"
          />
        </Field>
        <Field label="Model">
          <select
            value={settings.openaiModel}
            onChange={e => update({ openaiModel: e.target.value })}
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-100"
          >
            {OPENAI_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Reasoning Effort" hint="Applies to o3, o4-mini, and gpt-6-luna models.">
          <EffortPicker
            levels={OPENAI_EFFORT_LEVELS}
            value={settings.openaiEffort}
            onChange={v => update({ openaiEffort: v })}
          />
        </Field>
      </SectionCard>}

      {/* Actions */}
      <div className="space-y-2 pt-2">
        {error && (
          <p className="text-xs text-red-500 text-right">{error}</p>
        )}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={reset}
            className="text-sm text-red-500 hover:text-red-700 hover:underline"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved to .env' : 'Save Settings'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-right">Settings are saved to <code className="font-mono">.env</code> in the project root.</p>
      </div>
    </div>
  )
}

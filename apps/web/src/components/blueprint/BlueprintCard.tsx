import { useState, useEffect } from 'react'
import type { Blueprint } from '@/api/types'
import { apiClient } from '@/api/client'

interface Props {
  blueprint: Blueprint
  projectId: string
}

const FILE_LABELS: Record<string, { label: string; lang: string }> = {
  'plugo.config.json': { label: 'Plugo Config', lang: 'json' },
  'theme.json': { label: 'Theme', lang: 'json' },
  'integrations.json': { label: 'Integrations', lang: 'json' },
  'migration-plan.md': { label: 'Migration Plan', lang: 'markdown' },
}

export function BlueprintCard({ blueprint, projectId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)

  const isGenerating = blueprint.status === 'generating'
  const isReady = blueprint.status === 'ready'
  const files = blueprint.files ?? []

  useEffect(() => {
    if (isReady && files.length > 0 && activeFile === null) {
      setActiveFile(files[0])
    }
  }, [isReady, files, activeFile])

  useEffect(() => {
    if (!activeFile) return
    setLoadingFile(true)
    setFileContent(null)
    apiClient.getBlueprintFile(projectId, activeFile)
      .then(content => setFileContent(content))
      .catch(() => setFileContent('// Error loading file'))
      .finally(() => setLoadingFile(false))
  }, [activeFile, projectId])

  if (isGenerating) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">Blueprint</span>
          <span className="flex items-center gap-1.5 text-xs text-violet-600">
            <span className="inline-block h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
            Generating…
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-3">Building config files, theme, integrations and migration plan…</p>
        <div className="relative h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className="absolute inset-y-0 w-1/3 rounded-full bg-violet-500"
            style={{ animation: 'crawl-slide 1.5s ease-in-out infinite' }}
          />
        </div>
      </div>
    )
  }

  if (!isReady) return null

  const activeLabel = activeFile ? FILE_LABELS[activeFile] : null

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden flex">
      <div className="w-1 shrink-0 bg-indigo-400" />
      <div className="flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-800">Blueprint</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-green-700">✓ Ready</span>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Summary stats */}
      <div className="px-4 pb-3 flex gap-6 border-t border-gray-100 pt-3 flex-wrap">
        <Stat label="Files" value={files.length} />
        {blueprint.zipSize && (
          <Stat label="Size" value={`${Math.round(blueprint.zipSize / 1024)} KB`} />
        )}
        <Stat label="Version" value={`v${blueprint.version}`} />
      </div>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* File tabs */}
          <div className="flex border-b border-gray-100 overflow-x-auto">
            {files.map(f => (
              <button
                key={f}
                onClick={() => setActiveFile(f)}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors
                  ${activeFile === f
                    ? 'border-b-2 border-violet-500 text-violet-700 bg-violet-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
              >
                {FILE_LABELS[f]?.label ?? f}
              </button>
            ))}
          </div>

          {/* File content */}
          <div className="relative">
            {loadingFile && (
              <div className="p-4 text-xs text-gray-400">Loading…</div>
            )}
            {!loadingFile && fileContent !== null && (
              <pre className={`p-4 text-xs overflow-auto max-h-96 leading-relaxed ${
                activeLabel?.lang === 'markdown' ? 'whitespace-pre-wrap font-sans text-gray-700' : 'font-mono text-gray-800 bg-gray-50'
              }`}>
                {fileContent}
              </pre>
            )}
          </div>

          {/* Footer actions */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {files.length} files generated · <span className="font-mono">{activeFile}</span>
            </p>
            <a
              href={apiClient.getBlueprintDownloadUrl(blueprint.id)}
              className="text-xs font-medium text-violet-600 hover:text-violet-800 hover:underline"
            >
              Download ZIP →
            </a>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

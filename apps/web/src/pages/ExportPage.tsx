import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Spinner } from '@/components/common/Spinner'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { apiClient } from '@/api/client'

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  return `${Math.round(bytes / 1024)} KB`
}

export function ExportPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [copied, setCopied] = useState(false)

  const { data: blueprint, isLoading: bpLoading, error: bpError } = useQuery({
    queryKey: ['blueprint', id],
    queryFn: () => apiClient.getBlueprint(id),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'generating' ? 3_000 : false),
  })

  const { data: mcpConfig } = useQuery({
    queryKey: ['mcp-config', id],
    queryFn: () => apiClient.getMcpConfig(id),
    enabled: Boolean(id),
  })

  const downloadUrl = blueprint ? apiClient.getBlueprintDownloadUrl(blueprint.id) : undefined

  async function copyMcpConfig() {
    if (!mcpConfig) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(mcpConfig, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Export" subtitle="Download the Blueprint ZIP or configure your MCP server" />

      {/* Blueprint ZIP section */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-3">Blueprint ZIP</h2>

        {bpLoading && <Spinner size="sm" />}
        {bpError && <ErrorBanner message={(bpError as Error).message} />}

        {blueprint?.status === 'generating' && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Spinner size="sm" /> Blueprint is being generated…
          </div>
        )}

        {blueprint?.status === 'failed' && (
          <ErrorBanner message="Blueprint generation failed. Please try again from the project dashboard." />
        )}

        {blueprint?.status === 'ready' && downloadUrl && (
          <div className="flex items-center gap-4">
            <a
              href={downloadUrl}
              download
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Download Blueprint ZIP
            </a>
            <span className="text-sm text-gray-500">
              <span>{formatSize(blueprint.zipSize)}</span>
              <span className="mx-1">·</span>
              <span>version {blueprint.version}</span>
            </span>
          </div>
        )}
      </section>

      {/* MCP Configuration section */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-3">MCP Configuration</h2>
        <p className="text-sm text-gray-600 mb-3">
          Add this to your AI coding agent&apos;s MCP server config to give it access to the Blueprint.
        </p>
        {mcpConfig ? (
          <div className="relative">
            <pre className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs font-mono overflow-x-auto">
              {JSON.stringify(mcpConfig, null, 2)}
            </pre>
            <button
              onClick={copyMcpConfig}
              className="absolute top-2 right-2 rounded px-2 py-1 text-xs bg-white border border-gray-300 hover:bg-gray-50"
              aria-label="Copy MCP config"
            >
              {copied ? 'Copied!' : 'Copy MCP config'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-400">MCP config not available yet.</p>
        )}
      </section>
    </div>
  )
}

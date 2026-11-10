import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Spinner } from '@/components/common/Spinner'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { CrawlProgress } from '@/components/crawl/CrawlProgress'
import { useProject } from '@/hooks/useProject'
import { useCrawlStatus, useStartCrawl } from '@/hooks/useCrawl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { ProjectStatus } from '@/api/types'

function canStartCrawl(status: ProjectStatus) { return status === 'created' }
function canAnalyse(status: ProjectStatus) { return status === 'crawl_complete' }
function canIntelligence(status: ProjectStatus) { return status === 'analysis_complete' }
function canBlueprint(status: ProjectStatus) { return status === 'intelligence_complete' }

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data: project, isLoading, error } = useProject(id)
  const { data: crawlJob } = useCrawlStatus(id)
  const startCrawl = useStartCrawl()

  const startAnalysis = useMutation({
    mutationFn: () => apiClient.startAnalysis(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', id] }),
  })
  const startIntelligence = useMutation({
    mutationFn: () => apiClient.startIntelligence(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', id] }),
  })
  const startBlueprint = useMutation({
    mutationFn: () => apiClient.startBlueprint(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', id] }),
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!project) return null

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={project.name}
        subtitle={project.url}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={project.status} />
            <Link to={`/projects/${id}/pages`} className="text-sm text-indigo-600 hover:underline">
              View pages →
            </Link>
          </div>
        }
      />

      {/* Pipeline */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Pipeline</h2>
        <div className="flex gap-3 flex-wrap">
          <PipelineButton
            label="Start Crawl"
            enabled={canStartCrawl(project.status)}
            loading={startCrawl.isPending}
            onClick={() => startCrawl.mutate(id)}
            error={startCrawl.error?.message}
          />
          <PipelineButton
            label="Analyse"
            enabled={canAnalyse(project.status)}
            loading={startAnalysis.isPending}
            onClick={() => startAnalysis.mutate()}
            error={startAnalysis.error?.message}
          />
          <PipelineButton
            label="Extract Intelligence"
            enabled={canIntelligence(project.status)}
            loading={startIntelligence.isPending}
            onClick={() => startIntelligence.mutate()}
            error={startIntelligence.error?.message}
          />
          <PipelineButton
            label="Generate Blueprint"
            enabled={canBlueprint(project.status)}
            loading={startBlueprint.isPending}
            onClick={() => startBlueprint.mutate()}
            error={startBlueprint.error?.message}
          />
        </div>
      </section>

      {/* Crawl status */}
      {crawlJob && <CrawlProgress job={crawlJob} />}
    </div>
  )
}

interface PipelineButtonProps {
  label: string
  enabled: boolean
  loading: boolean
  onClick: () => void
  error?: string
}

function PipelineButton({ label, enabled, loading, onClick, error }: PipelineButtonProps) {
  return (
    <div>
      <button
        disabled={!enabled || loading}
        onClick={onClick}
        className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed
          enabled:border-indigo-600 enabled:text-indigo-700 enabled:hover:bg-indigo-50"
      >
        {loading && <Spinner size="sm" />}
        {label}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

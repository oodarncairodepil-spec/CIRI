import { Link, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { GapReportTable } from '@/components/gap-report/GapReportTable'
import { Spinner } from '@/components/common/Spinner'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { useAnalysis } from '@/hooks/useBlueprint'

export function GapReportPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: analysis, isLoading, error } = useAnalysis(id)

  const components = analysis?.components ?? []
  const mappings = analysis?.mappings ?? []
  const gapCount = mappings.filter((m) => m.isGap).length
  const availableCount = mappings.filter((m) => !m.isGap).length

  return (
    <div>
      <PageHeader
        title="Gap Report"
        subtitle="Commerce components detected on the site vs. what Plugo v1 supports"
        actions={
          <Link to={`/projects/${id}/export`} className="text-sm text-indigo-600 hover:underline">
            Export →
          </Link>
        }
      />

      {error && <ErrorBanner message={(error as Error).message} />}

      {isLoading && (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      )}

      {analysis?.status === 'running' && (
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
          <Spinner size="sm" /> Analysis running…
        </div>
      )}

      {analysis?.status === 'failed' && (
        <ErrorBanner message="Analysis failed. Please try again from the project dashboard." />
      )}

      {mappings.length > 0 && (
        <>
          <div className="flex gap-6 mb-6 text-sm">
            <div>
              <span className="font-semibold text-gray-800">{components.length}</span>
              <span className="text-gray-500 ml-1">components detected</span>
            </div>
            <div>
              <span className="font-semibold text-green-700">{availableCount}</span>
              <span className="text-gray-500 ml-1">available in Plugo v1</span>
            </div>
            <div>
              <span className="font-semibold text-red-600">{gapCount}</span>
              <span className="text-gray-500 ml-1">gaps</span>
            </div>
          </div>

          <GapReportTable mappings={mappings} />
        </>
      )}

      {!isLoading && mappings.length === 0 && analysis?.status === 'completed' && (
        <p className="text-sm text-gray-500">No commerce components were detected on this site.</p>
      )}
    </div>
  )
}

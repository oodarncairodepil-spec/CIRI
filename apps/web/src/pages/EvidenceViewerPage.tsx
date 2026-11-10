import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { Spinner } from '@/components/common/Spinner'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { apiClient } from '@/api/client'

export function EvidenceViewerPage() {
  const { id = '', pageId = '' } = useParams<{ id: string; pageId: string }>()

  const { data: capture, isLoading, error } = useQuery({
    queryKey: ['capture', pageId],
    queryFn: () => apiClient.getPageCapture(pageId),
    enabled: Boolean(pageId),
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  if (error) return <ErrorBanner message={(error as Error).message} />
  if (!capture) return null

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4 flex gap-1 items-center">
        <Link to={`/projects/${id}`} className="hover:underline text-indigo-600">Project</Link>
        <span>›</span>
        <Link to={`/projects/${id}/pages`} className="hover:underline text-indigo-600">Pages</Link>
        <span>›</span>
        <span className="text-gray-700 truncate max-w-xs" title={`Page ${pageId}`}>Evidence</span>
      </nav>

      <EvidencePanel
        capture={capture}
        domData={[]}
        stylesData={{}}
      />
    </div>
  )
}

import { useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Spinner } from '@/components/common/Spinner'
import { ErrorBanner } from '@/components/common/ErrorBanner'
import { EmptyState } from '@/components/common/EmptyState'
import { apiClient } from '@/api/client'
import type { PageType } from '@/api/types'

const PAGE_SIZE = 25

const PAGE_TYPES: PageType[] = [
  'homepage', 'category', 'subcategory', 'product', 'search',
  'collection', 'brand', 'campaign', 'content', 'static', 'cart', 'other',
]

function usePages(
  projectId: string,
  opts: { pageType?: PageType; status?: string; offset: number }
) {
  return useQuery({
    queryKey: ['pages', projectId, opts],
    queryFn: () =>
      apiClient.listPages(projectId, {
        pageType: opts.pageType,
        status: opts.status,
        limit: PAGE_SIZE,
        offset: opts.offset,
      }),
    enabled: Boolean(projectId),
  })
}

export function PagesPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [pageType, setPageType] = useState<PageType | ''>('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading, error } = usePages(id, {
    pageType: pageType || undefined,
    status: status || undefined,
    offset,
  })

  const reset = useCallback(() => setOffset(0), [])

  const total = data?.total ?? 0
  const items = data?.items ?? []
  const start = offset + 1
  const end = Math.min(offset + PAGE_SIZE, total)

  return (
    <div>
      <PageHeader title="Pages" subtitle={`${total} pages crawled`} />

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={pageType}
          onChange={(e) => { setPageType(e.target.value as PageType | ''); reset() }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          {PAGE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); reset() }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="captured">Captured</option>
          <option value="failed">Failed</option>
          <option value="discovered">Discovered</option>
        </select>
      </div>

      {error && <ErrorBanner message={(error as Error).message} />}

      {isLoading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}

      {!isLoading && items.length === 0 && (
        <EmptyState title="No pages match" description="Try adjusting your filters." />
      )}

      {items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">URL</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Depth</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((page) => (
                  <tr key={page.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-xs">
                      <span
                        className="block truncate text-gray-700"
                        title={page.url}
                      >
                        {page.url.length > 60 ? page.url.slice(0, 60) + '…' : page.url}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={page.pageType} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={page.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">{page.crawlDepth}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/projects/${id}/pages/${page.id}/evidence`}
                        className="text-indigo-600 hover:underline whitespace-nowrap"
                      >
                        View evidence
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>Showing {start}–{end} of {total} pages</span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                disabled={end >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

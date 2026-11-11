import { Link } from 'react-router-dom'
import type { FavoritePage } from '@/hooks/useFavoritePages'
import { useVisualizePage, PHASE_LABEL } from '@/hooks/useVisualizePage'

export function matchTone(pct: number) {
  if (pct >= 99) return 'bg-green-100 text-green-700'
  if (pct >= 95) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function FavoriteRow({ page, projectId }: { page: FavoritePage; projectId: string }) {
  const { status, error, isRunning, run } = useVisualizePage(projectId, page.displayId)
  const fidelity = status?.fidelity
  const path = (() => {
    try { return new URL(page.url).pathname || '/' } catch { return '/' }
  })()

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 max-w-xs">
        <span className="block truncate text-gray-700 text-xs font-medium" title={page.url}>{path}</span>
        <span className="block truncate text-gray-400 text-[10px]" title={page.url}>{page.url}</span>
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {page.pageType}
        </span>
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-violet-600">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
            {PHASE_LABEL[status?.phase ?? 'starting']}…
          </span>
        ) : error || status?.status === 'failed' ? (
          <span className="text-xs text-red-600" title={error?.message ?? status?.error}>
            {error?.message ?? 'Check failed'}
          </span>
        ) : fidelity ? (
          <span className="inline-flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${matchTone(fidelity.desktop.matchPct)}`} title="Desktop pixel match">
              Desktop {fidelity.desktop.matchPct}%
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${matchTone(fidelity.mobile.matchPct)}`} title="Mobile pixel match">
              Mobile {fidelity.mobile.matchPct}%
            </span>
          </span>
        ) : (
          <span className="text-xs text-gray-400">Not checked yet</span>
        )}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        {fidelity && !isRunning && (
          <Link
            to={`/projects/${projectId}/preview/${page.displayId}`}
            className="mr-2 text-xs font-medium text-violet-600 hover:underline"
          >
            Open clone
          </Link>
        )}
        <button
          onClick={() => run(false)}
          disabled={isRunning || Boolean(error)}
          className="inline-flex items-center rounded px-2.5 py-1 text-xs font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {fidelity ? 'Re-check' : 'Visualize'}
        </button>
      </td>
    </tr>
  )
}

export function FavoriteVisualizeTable({ favorites, projectId }: { favorites: FavoritePage[]; projectId: string }) {
  if (favorites.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-2xl mb-2 text-gray-300">☆</p>
        <p className="text-sm text-gray-500">No favorite pages yet.</p>
        <p className="text-xs text-gray-400 mt-1">Star pages in the Crawl card to visualize them here.</p>
      </div>
    )
  }
  return (
    <table className="min-w-full text-sm">
      <thead className="bg-gray-50 border-b border-gray-100">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Page</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Match with original</th>
          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {favorites.map(page => <FavoriteRow key={page.id} page={page} projectId={projectId} />)}
      </tbody>
    </table>
  )
}

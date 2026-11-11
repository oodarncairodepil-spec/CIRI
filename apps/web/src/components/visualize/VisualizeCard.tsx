import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CollapsibleCard } from '@/components/common/CollapsibleCard'
import { FavoriteVisualizeTable } from './FavoriteVisualizeTable'
import type { Page, Blueprint } from '@/api/types'
import type { FavoritePage } from '@/hooks/useFavoritePages'

interface Props {
  pages: Page[]
  projectId: string
  favorites: FavoritePage[]
  blueprintRun?: Blueprint
  onRetake?: () => void
  retakeLoading?: boolean
}

const API = 'http://localhost:3000'

export function VisualizeCard({ pages, projectId, favorites, blueprintRun, onRetake, retakeLoading }: Props) {
  const [tab, setTab] = useState<'overview' | 'favorites'>('overview')
  const captured = pages.filter(p => (p as any).status !== 'failed')
  const previews = captured.slice(0, 4)
  const blueprintReady = blueprintRun?.status === 'ready'
  const blueprintFiles = blueprintRun?.files ?? []

  const summary = `${captured.length} pages captured`

  const badge = blueprintReady
    ? <span className="text-xs font-medium text-green-700">✓ Visualize ready</span>
    : <span className="text-xs font-medium text-violet-600">✓ Reconstructed</span>

  return (
    <CollapsibleCard
      title="Visualize"
      summary={summary}
      badge={badge}
      accent="bg-violet-400"
      defaultCollapsed={true}
      onRetake={onRetake}
      retakeLabel="Re-visualize"
      retakeLoading={retakeLoading}
    >
      {/* Tab strip */}
      <div className="flex border-b border-gray-100 bg-gray-50">
        <button
          onClick={() => setTab('overview')}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            tab === 'overview'
              ? 'text-violet-700 border-b-2 border-violet-500 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('favorites')}
          className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
            tab === 'favorites'
              ? 'text-violet-700 border-b-2 border-violet-500 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span style={{ color: '#f59e0b' }}>★</span> Favorite Pages
          {favorites.length > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              tab === 'favorites' ? 'bg-violet-100 text-violet-700' : 'bg-gray-200 text-gray-600'
            }`}>
              {favorites.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'favorites' ? (
        <FavoriteVisualizeTable favorites={favorites} projectId={projectId} />
      ) : (
      <>
      {/* Stats row */}
      <div className="px-4 pt-3 pb-3 flex gap-6 flex-wrap">
        <Stat label="Pages" value={captured.length} color="text-violet-700" />
        {blueprintReady && (
          <>
            <Stat label="Blueprint files" value={blueprintFiles.length} />
            {blueprintRun?.zipSize && (
              <Stat label="Size" value={`${Math.round(blueprintRun.zipSize / 1024)} KB`} />
            )}
            {blueprintRun?.version != null && (
              <Stat label="Version" value={`v${blueprintRun.version}`} />
            )}
          </>
        )}
      </div>

      {/* Thumbnails */}
      {previews.length > 0 && (
        <div className="px-4 pb-3 grid grid-cols-4 gap-1.5">
          {previews.map(p => (
            <div key={p.id} className="aspect-video rounded overflow-hidden bg-gray-100 border border-gray-200">
              <img
                src={`${API}/projects/${projectId}/pages/${(p as any).displayId}/screenshot/desktop`}
                alt={(p as any).pageType ?? 'page'}
                className="w-full h-full object-cover object-top"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* CTA row */}
      <div className="px-4 pb-4 flex items-center justify-end gap-2">
        {blueprintReady && (
          <a
            href={`${API}/projects/${projectId}/blueprint/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Download Blueprint
          </a>
        )}
        <Link
          to={`/projects/${projectId}/visualize`}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.869v6.262a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          Open Visualize
        </Link>
      </div>
      </>
      )}
    </CollapsibleCard>
  )
}

function Stat({ label, value, color = 'text-gray-900' }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

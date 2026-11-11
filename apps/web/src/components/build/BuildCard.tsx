import { useState } from 'react'
import { CollapsibleCard } from '@/components/common/CollapsibleCard'
import type { BuildRun, BuildPhase } from '@/api/types'
import type { FavoritePage } from '@/hooks/useFavoritePages'
import { useSinglePageBuild, reconstructUrl } from '@/hooks/useSinglePageBuild'

interface Props {
  build: BuildRun
  forceOpen?: boolean
  onRetake?: () => void
  retakeLoading?: boolean
  favorites: FavoritePage[]
  projectId: string
}

function PhaseRow({ phase }: { phase: BuildPhase }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 shrink-0">
        {phase.status === 'completed' && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-600">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        {phase.status === 'running' && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          </span>
        )}
        {phase.status === 'failed' && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
        {phase.status === 'pending' && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100">
            <span className="h-2 w-2 rounded-full bg-gray-300" />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${
          phase.status === 'completed' ? 'text-gray-700'
          : phase.status === 'running' ? 'text-indigo-700'
          : phase.status === 'failed' ? 'text-red-600'
          : 'text-gray-400'
        }`}>{phase.label}</p>
        {phase.detail && phase.status !== 'pending' && (
          <p className="text-xs text-gray-400 mt-0.5">{phase.detail}</p>
        )}
      </div>
    </div>
  )
}


function FavoriteBuildRow({ page, projectId }: { page: FavoritePage; projectId: string }) {
  const { isRunning, hasBuild, hasSnapshot, error, build, status } = useSinglePageBuild(projectId, page.displayId)
  const path = (() => { try { return new URL(page.url).pathname || '/' } catch { return '/' } })()

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 max-w-xs">
        <div className="flex flex-col gap-0.5">
          <span className="block truncate text-gray-700 text-xs font-medium" title={page.url}>{path}</span>
          <span className="block truncate text-gray-400 text-[10px]" title={page.url}>{page.url}</span>
        </div>
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {page.pageType}
        </span>
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Building…
          </span>
        ) : error || status?.status === 'failed' ? (
          <span className="text-xs text-red-600" title={error?.message ?? status?.error}>Build failed</span>
        ) : hasBuild ? (
          <span className="text-xs text-emerald-700 font-medium">✓ Built</span>
        ) : hasSnapshot ? (
          <span className="text-xs text-gray-400">Ready to build</span>
        ) : (
          <span className="text-xs text-gray-400">Not crawled</span>
        )}
      </td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-1.5">
          {(hasBuild || hasSnapshot) && (
            <a
              href={reconstructUrl(projectId, page.displayId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
            >
              Open clone
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          <button
            onClick={build}
            disabled={isRunning || !hasSnapshot}
            title={!hasSnapshot ? 'Crawl this page first' : hasBuild ? 'Re-build from latest crawl data' : 'Build clone from crawled data'}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Building…
              </>
            ) : hasBuild ? 'Re-build' : 'Build'}
          </button>
        </div>
      </td>
    </tr>
  )
}

export function BuildCard({ build, forceOpen, onRetake, retakeLoading, favorites, projectId }: Props) {
  const [tab, setTab] = useState<'progress' | 'favorites'>('progress')

  const completed = build.phases.filter(p => p.status === 'completed').length
  const total = build.phases.length
  const pct = Math.round((completed / total) * 100)
  const isRunning = build.status === 'running' || build.status === 'pending'
  const isDone = build.status === 'completed'

  const badge = isRunning
    ? <span className="flex items-center gap-1 text-xs text-indigo-600"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />Building…</span>
    : isDone
    ? <span className="text-xs font-medium text-green-700">✓ Complete</span>
    : build.status === 'failed'
    ? <span className="text-xs font-medium text-red-600">✗ Failed</span>
    : null

  return (
    <CollapsibleCard
      title="Recreate"
      summary={`${completed}/${total} phases`}
      badge={badge}
      forceOpen={forceOpen}
      accent="bg-emerald-400"
      onRetake={onRetake}
      retakeLabel="Re-build"
      retakeLoading={retakeLoading}
    >
      {/* Tab strip */}
      <div className="flex border-b border-gray-100 bg-gray-50">
        <button
          onClick={() => setTab('progress')}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            tab === 'progress'
              ? 'text-emerald-700 border-b-2 border-emerald-500 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Build Progress
        </button>
        <button
          onClick={() => setTab('favorites')}
          className={`px-4 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
            tab === 'favorites'
              ? 'text-emerald-700 border-b-2 border-emerald-500 bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span style={{ color: '#f59e0b' }}>★</span> Favorite Pages
          {favorites.length > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              tab === 'favorites' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
            }`}>
              {favorites.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'progress' ? (
        <>
          {/* Progress bar */}
          <div className="h-1 bg-gray-100">
            <div
              className={`h-full transition-all duration-500 ${isDone ? 'bg-green-500' : 'bg-indigo-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Phases */}
          <div className="px-4 divide-y divide-gray-50">
            {build.phases.map(phase => (
              <PhaseRow key={phase.id} phase={phase} />
            ))}
          </div>

          {/* Footer — config summary */}
          {(build.aiModel || build.plugoStoreName) && (
            <div className="border-t border-gray-100 px-4 py-2.5 flex flex-wrap gap-3">
              {build.aiModel && (
                <span className="text-xs text-gray-400">
                  AI: <span className="font-medium text-gray-600">{build.aiModel}</span>
                  {(build as any).aiEffort ? ` · ${(build as any).aiEffort}` : ''}
                </span>
              )}
              {build.plugoStoreName && (
                <span className="text-xs text-gray-400">
                  Store: <span className="font-medium text-gray-600">{build.plugoStoreName}</span>
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        /* Favorite Pages tab */
        <div>
          {favorites.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-2xl mb-2">☆</p>
              <p className="text-sm text-gray-500">No favorite pages yet.</p>
              <p className="text-xs text-gray-400 mt-1">Star pages in the Crawl card to save them here.</p>
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Page</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {favorites.map(page => (
                  <FavoriteBuildRow key={page.id} page={page} projectId={projectId} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </CollapsibleCard>
  )
}

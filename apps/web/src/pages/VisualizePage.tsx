import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useProject } from '@/hooks/useProject'
import { apiClient } from '@/api/client'
import { Spinner } from '@/components/common/Spinner'
import type { Page } from '@/api/types'

const API = 'http://localhost:3000'

export function VisualizePage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: project } = useProject(id)
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Page | null>(null)
  const [iframeLoading, setIframeLoading] = useState(true)
  const iframeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!id) return
    apiClient.listPages(id)
      .then(r => {
        const list: Page[] = r.items ?? (r as any)
        setPages(list)
        setSelected(list.find(p => (p as any).pageType === 'homepage') ?? list[0] ?? null)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <Spinner size="lg" />
      </div>
    )
  }

  const screenshotUrl = (p: Page) =>
    `${API}/projects/${id}/pages/${(p as any).displayId}/screenshot/desktop`

  const reconstructUrl = (p: Page) =>
    `${API}/projects/${id}/pages/${(p as any).displayId}/reconstruct`

  return (
    <div className="flex h-screen bg-gray-900 overflow-hidden">

      {/* Sidebar — page list */}
      <div className="w-56 shrink-0 flex flex-col border-r border-gray-700 bg-gray-800">
        <div className="px-4 py-3 border-b border-gray-700">
          <a
            href={`/projects/${id}`}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors mb-2"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to project
          </a>
          <p className="text-xs font-semibold text-white truncate">{project?.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{pages.length} pages captured</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {pages.map(p => {
            const isActive = selected?.id === p.id
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current)
                  setSelected(p)
                  setIframeLoading(true)
                }}
                className={`w-full text-left px-3 py-2 transition-colors group ${
                  isActive ? 'bg-gray-700' : 'hover:bg-gray-700/50'
                }`}
              >
                {/* Thumbnail */}
                <div className="rounded overflow-hidden mb-1.5 aspect-video bg-gray-700">
                  <img
                    src={screenshotUrl(p)}
                    alt=""
                    className="w-full h-full object-cover object-top"
                    loading="lazy"
                  />
                </div>
                <p className={`text-xs font-medium capitalize truncate ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                  {(p as any).pageType ?? 'page'}
                </p>
                <p className="text-xs text-gray-600 truncate">{p.url}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main — reconstructed page iframe */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Browser chrome */}
        <div className="shrink-0 bg-gray-700 px-4 py-2 flex items-center gap-3 border-b border-gray-600">
          <div className="flex gap-1.5 shrink-0">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 bg-gray-600 rounded px-3 py-1 text-xs text-gray-300 font-mono truncate">
            {selected ? selected.url : project?.url ?? ''}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {iframeLoading && selected && (
              <span className="text-xs text-gray-500">Loading…</span>
            )}
            {selected && (
              <span className="text-xs text-gray-500 capitalize">{(selected as any).pageType ?? 'page'}</span>
            )}
            <span className="text-xs rounded bg-gray-600 px-1.5 py-0.5 text-gray-400">Reconstructed</span>
          </div>
        </div>

        {/* Reconstructed page in iframe */}
        <div className="flex-1 overflow-hidden relative">
          {selected ? (
            <>
              {iframeLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-6 w-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    <p className="text-sm text-gray-500">Reconstructing page…</p>
                  </div>
                </div>
              )}
              <iframe
                key={selected.id}
                src={reconstructUrl(selected)}
                title={selected.url}
                className="w-full h-full border-0"
                onLoad={() => {
                  if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current)
                  setIframeLoading(false)
                }}
                ref={el => {
                  if (el && iframeLoading) {
                    if (iframeTimerRef.current) clearTimeout(iframeTimerRef.current)
                    iframeTimerRef.current = setTimeout(() => setIframeLoading(false), 8000)
                  }
                }}
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              No page selected
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

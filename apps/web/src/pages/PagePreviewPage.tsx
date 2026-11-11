import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useVisualizePage, pageApiUrl, PHASE_LABEL } from '@/hooks/useVisualizePage'
import { matchTone } from '@/components/visualize/FavoriteVisualizeTable'

type View = 'clone' | 'original' | 'side' | 'diff'
type Device = 'desktop' | 'mobile'

const VIEWS: { id: View; label: string }[] = [
  { id: 'clone', label: 'Clone' },
  { id: 'original', label: 'Original' },
  { id: 'side', label: 'Side by side' },
  { id: 'diff', label: 'Differences' },
]

function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md border border-gray-700 overflow-hidden shrink-0">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.id ? 'bg-gray-200 text-gray-900' : 'bg-gray-900 text-gray-400 hover:text-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Shot({ src, label, width }: { src: string; label: string; width: number }) {
  return (
    <div className="min-w-0 flex-1 flex flex-col items-center">
      <p className="sticky top-0 z-10 w-full bg-gray-800 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-300">
        {label}
      </p>
      <img src={src} alt={label} style={{ width: '100%', maxWidth: width }} className="block bg-white" />
    </div>
  )
}

export function PagePreviewPage() {
  const { id = '', displayId = '' } = useParams<{ id: string; displayId: string }>()
  const [view, setView] = useState<View>('clone')
  const [device, setDevice] = useState<Device>('desktop')
  const { status, error, isRunning, run } = useVisualizePage(id, displayId)

  const fidelity = status?.fidelity
  const stamp = fidelity?.checkedAt ?? ''
  const width = device === 'desktop' ? 1440 : 390
  const cloneUrl = pageApiUrl(id, displayId, `reconstruct${device === 'mobile' ? '?device=mobile' : ''}`)
  const img = (sub: string) => `${pageApiUrl(id, displayId, `${sub}/${device}`)}?t=${encodeURIComponent(stamp)}`
  const needsCheck = view === 'side' || view === 'diff'

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 bg-gray-950 border-b border-gray-800">
        <Link
          to={`/projects/${id}`}
          className="rounded-md border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:text-white"
        >
          ← Back
        </Link>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-300" title={status?.url}>
          {status?.url ?? displayId}
        </span>

        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
            {PHASE_LABEL[status?.phase ?? 'starting']}…
          </span>
        ) : fidelity ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${matchTone(fidelity.desktop.matchPct)}`}>
              Desktop {fidelity.desktop.matchPct}%
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${matchTone(fidelity.mobile.matchPct)}`}>
              Mobile {fidelity.mobile.matchPct}%
            </span>
            <span
              className="text-[11px] text-gray-500"
              title={fidelity.externalRequests === 0
                ? 'Every stylesheet, font and image is served from the crawl'
                : `Not in the crawl, loaded from the original site:\n${(fidelity.externalUrls ?? []).join('\n')}`}
            >
              {fidelity.externalRequests === 0 ? 'Fully from crawled data' : `${fidelity.externalRequests} live-site requests`}
            </span>
          </span>
        ) : (
          <span className="text-xs text-gray-500">Not compared with the original yet</span>
        )}

        <Segmented value={view} options={VIEWS} onChange={setView} />
        <Segmented
          value={device}
          options={[{ id: 'desktop', label: 'Desktop' }, { id: 'mobile', label: 'Mobile' }]}
          onChange={setDevice}
        />
        <button
          onClick={() => run(false)}
          disabled={isRunning}
          className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {fidelity ? 'Re-check' : 'Compare with original'}
        </button>
        <button
          onClick={() => run(true)}
          disabled={isRunning}
          title="Crawl this page again from the live site, then compare"
          className="rounded-md border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-300 hover:text-white disabled:opacity-40"
        >
          Re-capture
        </button>
      </div>

      {(error || status?.status === 'failed') && (
        <p className="shrink-0 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error?.message ?? status?.error ?? 'The comparison failed'}
        </p>
      )}

      {/* Stage */}
      <div className="flex-1 min-h-0 overflow-auto">
        {view === 'clone' && (
          <iframe
            key={cloneUrl + stamp}
            src={cloneUrl}
            title="Cloned page"
            sandbox="allow-same-origin allow-scripts"
            className="block h-full border-0 bg-white mx-auto"
            style={{ width: device === 'desktop' ? '100%' : 390 }}
          />
        )}
        {view === 'original' && (
          <div className="flex justify-center">
            <Shot src={img('screenshot')} label="Original (crawl screenshot)" width={width} />
          </div>
        )}
        {needsCheck && !fidelity && (
          <p className="py-16 text-center text-sm text-gray-400">
            {isRunning ? 'Comparison running…' : 'Run “Compare with original” to produce this view.'}
          </p>
        )}
        {view === 'side' && fidelity && (
          <div className="flex gap-px">
            <Shot src={img('screenshot')} label="Original" width={width} />
            <Shot src={img('clone-screenshot')} label="Clone" width={width} />
          </div>
        )}
        {view === 'diff' && fidelity && (
          <div className="flex justify-center">
            <Shot
              src={img('diff')}
              label={`Pixels that differ are red · ${fidelity[device].matchPct}% match`}
              width={width}
            />
          </div>
        )}
      </div>
    </div>
  )
}

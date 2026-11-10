import type { CrawlJob } from '@/api/types'

interface Props {
  job: CrawlJob
  refetch?: () => void
}

export function CrawlProgress({ job }: Props) {
  const { pagesDiscovered, pagesCaptured, pagesFailed } = job
  const pct = pagesDiscovered > 0 ? Math.round((pagesCaptured / pagesDiscovered) * 100) : 0

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex gap-6 mb-4">
        <Stat label="Discovered" value={pagesDiscovered} />
        <Stat label="Captured" value={pagesCaptured} color="text-green-700" />
        <Stat label="Failed" value={pagesFailed} color="text-red-600" />
      </div>

      <div className="relative h-2 w-full rounded-full bg-gray-200">
        <div
          className="absolute left-0 top-0 h-2 rounded-full bg-indigo-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Accessible progress element (visually hidden) */}
      <progress
        role="progressbar"
        aria-valuenow={pagesCaptured}
        aria-valuemax={pagesDiscovered}
        aria-label="Crawl progress"
        value={pagesCaptured}
        max={pagesDiscovered}
        className="sr-only"
      />

      <p className="mt-1 text-xs text-right text-gray-500">{pct}%</p>
    </div>
  )
}

function Stat({ label, value, color = 'text-gray-900' }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface FidelityResult {
  matchPct: number
  originalHeight: number
  cloneHeight: number
}

export interface PageFidelity {
  desktop: FidelityResult
  mobile: FidelityResult
  externalRequests: number
  externalUrls?: string[]
  checkedAt: string
}

export interface VisualizeStatus {
  pageId: string
  url: string
  pageType: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  phase?: 'starting' | 'capturing' | 'rendering' | 'comparing'
  error?: string
  hasSnapshot: boolean
  fidelity: PageFidelity | null
}

export const PHASE_LABEL: Record<NonNullable<VisualizeStatus['phase']>, string> = {
  starting: 'Starting',
  capturing: 'Capturing original',
  rendering: 'Rendering clone',
  comparing: 'Comparing pixels',
}

export function pageApiUrl(projectId: string, displayId: string, sub: string) {
  return `/api/projects/${projectId}/pages/${displayId}/${sub}`
}

async function call(url: string, init?: RequestInit): Promise<VisualizeStatus> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) throw new Error(res.status === 404 ? 'This page is no longer in the crawl' : res.statusText)
  return res.json()
}

export function useVisualizePage(projectId: string, displayId: string) {
  const queryClient = useQueryClient()
  const queryKey = ['visualize', projectId, displayId]
  const url = pageApiUrl(projectId, displayId, 'visualize')

  const query = useQuery({
    queryKey,
    queryFn: () => call(url),
    enabled: Boolean(projectId && displayId),
    retry: false,
    refetchInterval: q => (q.state.data?.status === 'running' ? 1_000 : false),
  })

  const start = useMutation({
    mutationFn: (recapture: boolean) => call(url, { method: 'POST', body: JSON.stringify({ recapture }) }),
    onSuccess: data => queryClient.setQueryData(queryKey, data),
  })

  return {
    status: query.data,
    error: (query.error ?? start.error) as Error | null,
    isRunning: start.isPending || query.data?.status === 'running',
    run: (recapture = false) => start.mutate(recapture),
  }
}

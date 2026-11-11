import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface SinglePageBuildStatus {
  pageId: string
  url: string
  hasSnapshot: boolean
  hasBuild: boolean
  status: 'idle' | 'running' | 'completed' | 'failed'
  error?: string
}

const API = 'http://localhost:3000'

function buildUrl(projectId: string, displayId: string) {
  return `${API}/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(displayId)}/build`
}

export function reconstructUrl(projectId: string, displayId: string, mobile = false) {
  return `${API}/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(displayId)}/reconstruct${mobile ? '?device=mobile' : ''}`
}

async function fetchStatus(url: string, init?: RequestInit): Promise<SinglePageBuildStatus> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export function useSinglePageBuild(projectId: string, displayId: string) {
  const queryClient = useQueryClient()
  const queryKey = ['page-build', projectId, displayId]
  const url = buildUrl(projectId, displayId)

  const query = useQuery({
    queryKey,
    queryFn: () => fetchStatus(url),
    enabled: Boolean(projectId && displayId),
    retry: false,
    refetchInterval: q => (q.state.data?.status === 'running' ? 1_000 : false),
  })

  const build = useMutation({
    mutationFn: () => fetchStatus(url, { method: 'POST' }),
    onSuccess: data => queryClient.setQueryData(queryKey, data),
  })

  return {
    status: query.data,
    isRunning: build.isPending || query.data?.status === 'running',
    hasBuild: query.data?.hasBuild ?? false,
    hasSnapshot: query.data?.hasSnapshot ?? false,
    error: (query.error ?? build.error) as Error | null,
    build: () => build.mutate(),
  }
}

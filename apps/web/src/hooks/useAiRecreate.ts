import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AiRecreateStatus } from '@/api/types'

const API = 'http://localhost:3000'

function aiRecreateUrl(projectId: string, displayId: string) {
  return `${API}/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(displayId)}/ai-recreate`
}

export function aiRecreationOutputUrl(projectId: string, displayId: string) {
  return `${API}/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(displayId)}/ai-recreation-output`
}

async function call(url: string, init?: RequestInit): Promise<AiRecreateStatus> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export function useAiRecreate(projectId: string, displayId: string) {
  const queryClient = useQueryClient()
  const queryKey = ['ai-recreate', projectId, displayId]
  const url = aiRecreateUrl(projectId, displayId)

  const query = useQuery({
    queryKey,
    queryFn: () => call(url),
    enabled: Boolean(projectId && displayId),
    retry: false,
    refetchInterval: q => (q.state.data?.status === 'running' ? 1_000 : false),
  })

  const start = useMutation({
    mutationFn: () => call(url, { method: 'POST' }),
    onSuccess: data => queryClient.setQueryData(queryKey, data),
  })

  return {
    status: query.data,
    isRunning: start.isPending || query.data?.status === 'running',
    hasResult: query.data?.hasResult ?? false,
    hasSnapshot: query.data?.hasSnapshot ?? false,
    error: (query.error ?? start.error) as Error | null,
    run: () => start.mutate(),
  }
}

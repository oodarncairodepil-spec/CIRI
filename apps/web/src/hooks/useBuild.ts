import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { ProjectStatus } from '@/api/types'

export function useBuildStatus(projectId: string, projectStatus?: ProjectStatus) {
  const inFlight = projectStatus === 'building'
  return useQuery({
    queryKey: ['build', projectId],
    queryFn: async () => {
      try { return await apiClient.getBuild(projectId) } catch { return null }
    },
    enabled: Boolean(projectId),
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data?.status
      if (s === 'running' || s === 'pending') return 1_200
      if (s == null && inFlight) return 800
      return false
    },
  })
}

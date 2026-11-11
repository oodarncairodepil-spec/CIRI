import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { ProjectStatus } from '@/api/types'

export function useIntelligenceStatus(projectId: string, projectStatus?: ProjectStatus) {
  const inFlight = projectStatus === 'generating_intelligence'
  return useQuery({
    queryKey: ['intelligence', projectId],
    queryFn: async () => {
      try {
        return await apiClient.getIntelligence(projectId)
      } catch {
        return null
      }
    },
    enabled: Boolean(projectId),
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data?.status
      if (s === 'running') return 1_500
      if (s == null && inFlight) return 1_000
      return false
    },
  })
}

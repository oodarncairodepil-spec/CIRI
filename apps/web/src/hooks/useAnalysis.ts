import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { ProjectStatus } from '@/api/types'

export function useAnalysisStatus(projectId: string, projectStatus?: ProjectStatus) {
  const inFlight = projectStatus === 'analysing'
  return useQuery({
    queryKey: ['analysis', projectId],
    queryFn: async () => {
      try {
        return await apiClient.getAnalysis(projectId)
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

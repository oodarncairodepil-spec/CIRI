import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'

function isActive(status?: string) {
  return status === 'running' || status === 'pending'
}

export function useAnalysis(projectId: string) {
  return useQuery({
    queryKey: ['analysis', projectId],
    queryFn: () => apiClient.getAnalysis(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => (isActive(query.state.data?.status) ? 3_000 : false),
  })
}

export function useIntelligence(projectId: string) {
  return useQuery({
    queryKey: ['intelligence', projectId],
    queryFn: () => apiClient.getIntelligence(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => (isActive(query.state.data?.status) ? 3_000 : false),
  })
}

export function useBlueprint(projectId: string) {
  return useQuery({
    queryKey: ['blueprint', projectId],
    queryFn: () => apiClient.getBlueprint(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => (query.state.data?.status === 'generating' ? 3_000 : false),
  })
}

export function useStartAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => apiClient.startAnalysis(projectId),
    onSuccess: (_data, projectId) => {
      void queryClient.invalidateQueries({ queryKey: ['analysis', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

export function useStartIntelligence() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => apiClient.startIntelligence(projectId),
    onSuccess: (_data, projectId) => {
      void queryClient.invalidateQueries({ queryKey: ['intelligence', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

export function useStartBlueprint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => apiClient.startBlueprint(projectId),
    onSuccess: (_data, projectId) => {
      void queryClient.invalidateQueries({ queryKey: ['blueprint', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

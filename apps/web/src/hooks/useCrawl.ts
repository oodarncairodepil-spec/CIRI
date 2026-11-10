import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'

export function useCrawlStatus(projectId: string) {
  return useQuery({
    queryKey: ['crawl', projectId],
    queryFn: () => apiClient.getCrawl(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 5_000 : false,
  })
}

export function useStartCrawl() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => apiClient.startCrawl(projectId),
    onSuccess: (_data, projectId) => {
      void queryClient.invalidateQueries({ queryKey: ['crawl', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}

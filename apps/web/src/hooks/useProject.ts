import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { Project } from '@/api/types'

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.listProjects(),
    staleTime: 10_000,
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => apiClient.getProject(id),
    enabled: Boolean(id),
  })
}

export function useCreateProject(options?: { onSuccess?: (project: Project) => void }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; url: string }) => apiClient.createProject(body),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      options?.onSuccess?.(project)
    },
  })
}

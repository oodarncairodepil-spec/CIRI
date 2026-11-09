import type {
  Project,
  CrawlJob,
  Page,
  PageType,
  PageCapture,
  AnalysisRun,
  CommerceComponent,
  PlugoMapping,
  IntelligenceRun,
  Blueprint,
} from './types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // use statusText
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export const apiClient = {
  // Projects
  listProjects(): Promise<Project[]> {
    return request('/api/projects')
  },
  createProject(body: { name: string; url: string }): Promise<Project> {
    return request('/api/projects', { method: 'POST', body: JSON.stringify(body) })
  },
  getProject(id: string): Promise<Project> {
    return request(`/api/projects/${id}`)
  },

  // Crawls
  startCrawl(projectId: string): Promise<{ jobId: string }> {
    return request(`/api/projects/${projectId}/crawl`, { method: 'POST' })
  },
  getCrawl(projectId: string): Promise<CrawlJob> {
    return request(`/api/projects/${projectId}/crawl`)
  },

  // Pages
  listPages(
    projectId: string,
    params?: { pageType?: PageType; status?: string; limit?: number; offset?: number },
  ): Promise<{ total: number; items: Page[] }> {
    const qs = new URLSearchParams()
    if (params?.pageType) qs.set('pageType', params.pageType)
    if (params?.status) qs.set('status', params.status)
    if (params?.limit !== undefined) qs.set('limit', String(params.limit))
    if (params?.offset !== undefined) qs.set('offset', String(params.offset))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return request(`/api/projects/${projectId}/pages${query}`)
  },
  getPageCapture(pageId: string): Promise<PageCapture> {
    return request(`/api/pages/${pageId}/capture`)
  },

  // Analysis
  startAnalysis(projectId: string): Promise<{ runId: string }> {
    return request(`/api/projects/${projectId}/analyse`, { method: 'POST' })
  },
  getAnalysis(
    projectId: string,
  ): Promise<AnalysisRun & { components: CommerceComponent[]; mappings: PlugoMapping[] }> {
    return request(`/api/projects/${projectId}/analysis`)
  },

  // Intelligence
  startIntelligence(projectId: string): Promise<{ runId: string }> {
    return request(`/api/projects/${projectId}/intelligence`, { method: 'POST' })
  },
  getIntelligence(projectId: string): Promise<IntelligenceRun> {
    return request(`/api/projects/${projectId}/intelligence`)
  },

  // Blueprint
  startBlueprint(projectId: string): Promise<{ blueprintId: string }> {
    return request(`/api/projects/${projectId}/blueprint`, { method: 'POST' })
  },
  getBlueprint(projectId: string): Promise<Blueprint> {
    return request(`/api/projects/${projectId}/blueprint`)
  },
  getBlueprintDownloadUrl(blueprintId: string): string {
    return `/api/blueprints/${blueprintId}/download`
  },
  getMcpConfig(projectId: string): Promise<{ mcpServerUrl: string; projectId: string }> {
    return request(`/api/projects/${projectId}/mcp-config`)
  },
}

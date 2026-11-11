export type ProjectStatus =
  | 'created'
  | 'crawling'
  | 'crawl_complete'
  | 'analysing'
  | 'analysis_complete'
  | 'generating_intelligence'
  | 'intelligence_complete'
  | 'generating_blueprint'
  | 'blueprint_ready'
  | 'failed'

export interface Project {
  id: string
  name: string
  url: string
  status: ProjectStatus
  config?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CrawlJob {
  id: string
  projectId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  pagesDiscovered: number
  pagesCaptured: number
  pagesFailed: number
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export type PageType =
  | 'homepage'
  | 'category'
  | 'subcategory'
  | 'product'
  | 'search'
  | 'collection'
  | 'brand'
  | 'campaign'
  | 'content'
  | 'static'
  | 'cart'
  | 'other'

export type EvidenceStatus =
  | 'measured'
  | 'inferred'
  | 'unknown'
  | 'unavailable'
  | 'not_applicable'

export interface Page {
  id: string
  projectId: string
  url: string
  pageType: PageType
  crawlDepth: number
  status: 'discovered' | 'capturing' | 'captured' | 'failed'
  error?: string
  createdAt: string
}

export interface PageCapture {
  id: string
  pageId: string
  viewportWidth: number
  viewportHeight: number
  screenshotDesktopKey?: string
  screenshotMobileKey?: string
  capturedAt: string
}

export interface AnalysisRun {
  id: string
  projectId: string
  crawlJobId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  platform?: string
  platformConfidence?: string
  startedAt?: string
  completedAt?: string
  components?: CommerceComponent[]
  mappings?: PlugoMapping[]
}

export interface CommerceComponent {
  id: string
  componentType: string
  selector?: string
  occurrenceCount: number
  confidence: string
  evidenceStatus: EvidenceStatus
}

export interface PlugoMapping {
  componentType: string
  plugoEndpoint?: string
  renderHint: string
  isGap: boolean
  gapReason?: string
}

export interface IntelligenceRun {
  id: string
  projectId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
}

export interface Blueprint {
  id: string
  projectId: string
  version: number
  zipSize?: number
  status: 'generating' | 'ready' | 'failed'
  createdAt: string
  completedAt?: string
}

export interface AiRecreateStatus {
  pageId: string
  url: string
  hasSnapshot: boolean
  hasResult: boolean
  status: 'idle' | 'running' | 'completed' | 'failed'
  phase?: string
  error?: string
}

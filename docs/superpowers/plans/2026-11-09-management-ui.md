# Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal web UI that lets a Plugo engineer create a project, trigger a crawl, monitor progress, inspect captured evidence, review the migration gap report, and download the Blueprint ZIP.

**Architecture:** Single-page app (Vite + React + TypeScript) talking to the existing Express API (`apps/api`). TanStack Query handles all server state; React Router v6 provides client-side routing. No global state store — each page owns its data via query hooks.

**Tech Stack:** Vite 5, React 18, TypeScript 5, React Router v6, TanStack Query v5, Tailwind CSS 3, shadcn/ui components, Vitest + Testing Library

**Spec:** `/Users/plugoemployee/REA/FM26/plan.md` §10 (UI spec), plus the API contracts defined in Sub-plans A, B, C.

## Global Constraints

- TypeScript strict mode; no `any` without eslint-disable comment and reason
- All API calls via a single typed client (`apps/web/src/api/client.ts`)
- No inline styles — Tailwind utility classes only
- Pages must work at viewport widths 1024 px and above (internal tool, desktop only)
- All date/time values displayed in the browser's local timezone
- Polling intervals: job status 3 s, crawl status 5 s — stop polling when terminal state reached
- Never display raw S3 keys to the user; use human-readable labels
- EvidenceStatus badges: `measured` → green, `inferred` → yellow, `unknown`/`unavailable` → red, `not_applicable` → grey
- Error responses from the API must surface a human-readable message, never a raw JSON blob
- Vitest + Testing Library for all component tests; no Cypress/Playwright in this sub-project

## Review Focus

- **Polling stops on terminal state:** `status === 'completed' | 'failed'` must disable the interval; a stale `useInterval` ref that keeps firing after unmount will spam the API and produce React state-update warnings.
- **Race between navigate-away and in-flight refetch:** cancelling a TanStack Query refetch mid-navigation should not throw an unhandled promise rejection; use `enabled` flags tied to route presence.
- **Large page inventory (1 000+ rows):** the pages table must use virtual scrolling or server-side pagination; rendering 1 000 DOM rows locks the thread.
- **Missing optional API fields (`logo`, `compareAtPrice`, `image`):** every component that reads these must guard for `undefined`; a missing field must render gracefully, not throw.
- **Blueprint download redirect (302 → presigned S3 URL):** `fetch` follows redirects automatically, so the download link must be an `<a href>` pointing at the API endpoint with `download` attribute, not a `fetch` call that tries to read the body as JSON.

---

## File Structure

```
apps/web/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── main.tsx                          # App entry, React Router provider
│   ├── App.tsx                           # Route definitions
│   ├── api/
│   │   └── client.ts                     # Typed fetch wrapper + all API calls
│   ├── hooks/
│   │   ├── usePolling.ts                 # Generic polling hook (clears on terminal state)
│   │   ├── useProject.ts                 # TanStack Query hooks for project data
│   │   ├── useCrawl.ts                   # Hooks for crawl status + pages
│   │   └── useBlueprint.ts              # Hooks for analysis/intelligence/blueprint
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Shell.tsx                 # App shell: sidebar + main area
│   │   │   └── PageHeader.tsx
│   │   ├── common/
│   │   │   ├── StatusBadge.tsx           # Coloured pill for job/EvidenceStatus values
│   │   │   ├── ErrorBanner.tsx
│   │   │   ├── Spinner.tsx
│   │   │   └── EmptyState.tsx
│   │   ├── projects/
│   │   │   ├── ProjectCard.tsx
│   │   │   └── CreateProjectForm.tsx
│   │   ├── crawl/
│   │   │   ├── CrawlProgress.tsx         # Live counters (discovered/captured/failed)
│   │   │   └── PageTypeBreakdown.tsx     # Bar chart of page type counts
│   │   ├── evidence/
│   │   │   ├── EvidencePanel.tsx         # Three-panel layout wrapper
│   │   │   ├── DomTreeViewer.tsx         # Collapsible DOM tree
│   │   │   ├── StylesPanel.tsx           # Computed + matched CSS rules
│   │   │   └── ScreenshotViewer.tsx      # Desktop / mobile toggle
│   │   └── gap-report/
│   │       ├── GapReportTable.tsx        # Commerce components + Plugo mapping
│   │       └── GapBadge.tsx              # "Available" / "Gap" pill
│   └── pages/
│       ├── ProjectsPage.tsx              # List + create
│       ├── ProjectDetailPage.tsx         # Dashboard for one project
│       ├── PagesPage.tsx                 # Page inventory table with filters
│       ├── EvidenceViewerPage.tsx        # Three-panel evidence inspector
│       ├── GapReportPage.tsx             # Commerce component mapping
│       └── ExportPage.tsx                # Blueprint download + MCP config
└── tests/
    ├── components/
    │   ├── StatusBadge.test.tsx
    │   ├── CreateProjectForm.test.tsx
    │   ├── CrawlProgress.test.tsx
    │   ├── GapReportTable.test.tsx
    │   └── EvidencePanel.test.tsx
    └── pages/
        ├── ProjectsPage.test.tsx
        └── ExportPage.test.tsx
```

---

### Task 1: Scaffold `apps/web`

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: running dev server at `http://localhost:5173`, routing skeleton with placeholder pages

- [ ] **Step 1: Initialise package.json with exact dependency versions**

```json
{
  "name": "@plugo-cloner/web",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.1",
    "@tanstack/react-query": "^5.56.2",
    "@tanstack/react-query-devtools": "^5.56.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.11",
    "typescript": "^5.5.4",
    "vite": "^5.4.3",
    "vitest": "^2.1.1",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.1"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

Configure `@vitejs/plugin-react`, proxy `/api` → `http://localhost:3000`, test environment `jsdom` with `globals: true` and `setupFiles: ['./src/test-setup.ts']`.

- [ ] **Step 3: Create `tailwind.config.ts`**

Content paths: `['./index.html', './src/**/*.{ts,tsx}']`. No custom theme extensions needed.

- [ ] **Step 4: Create `tsconfig.json`**

Strict mode, `"jsx": "react-jsx"`, `"moduleResolution": "bundler"`, paths alias `@/*` → `./src/*`.

- [ ] **Step 5: Create `index.html`**

Standard Vite HTML template, title `"Plugo Cloner"`, script `type="module" src="/src/main.tsx"`.

- [ ] **Step 6: Create `src/main.tsx` and `src/App.tsx`**

`main.tsx`: wrap app in `<QueryClientProvider>` and `<BrowserRouter>`.

`App.tsx`: define routes (all placeholder `<div>` for now):
- `/` → `ProjectsPage`
- `/projects/:id` → `ProjectDetailPage`
- `/projects/:id/pages` → `PagesPage`
- `/projects/:id/pages/:pageId/evidence` → `EvidenceViewerPage`
- `/projects/:id/gap-report` → `GapReportPage`
- `/projects/:id/export` → `ExportPage`

- [ ] **Step 7: Run dev server and verify routes load without errors**

```bash
cd apps/web && npm install && npm run dev
```

Expected: server starts at `http://localhost:5173`, each route renders its placeholder `<div>`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold Vite + React + TanStack Query app"
```

---

### Task 2: API Client

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/types.ts`

**Interfaces:**
- Produces: `apiClient` object with typed methods used by all hooks in later tasks

- [ ] **Step 1: Write failing test for `apiClient.createProject`**

```typescript
// tests/api/client.test.ts
import { apiClient } from '@/api/client'

test('createProject POSTs to /api/projects and returns the created project', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'proj-1', name: 'Test', url: 'https://example.com', status: 'created' }),
  } as Response)

  const result = await apiClient.createProject({ name: 'Test', url: 'https://example.com' })
  expect(result.id).toBe('proj-1')
  expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/projects')
})
```

Run: `cd apps/web && npm test`
Expected: FAIL — `apiClient` not found.

- [ ] **Step 2: Define `src/api/types.ts`**

Export TypeScript interfaces matching the API responses from Sub-plans A, B, C:

```typescript
export type ProjectStatus = 'created' | 'crawling' | 'crawl_complete' | 'analysing' | 'analysis_complete' | 'generating_intelligence' | 'intelligence_complete' | 'generating_blueprint' | 'blueprint_ready' | 'failed'

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

export type PageType = 'homepage' | 'category' | 'subcategory' | 'product' | 'search' | 'collection' | 'brand' | 'campaign' | 'content' | 'static' | 'cart' | 'other'
export type EvidenceStatus = 'measured' | 'inferred' | 'unknown' | 'unavailable' | 'not_applicable'

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
```

- [ ] **Step 3: Implement `src/api/client.ts`**

Thin typed wrapper around `fetch`. All methods throw an `Error` with the response's `error` field (or status text) on non-2xx. No retry logic here.

Signature:

```typescript
export const apiClient = {
  // Projects
  listProjects(): Promise<Project[]>
  createProject(body: { name: string; url: string }): Promise<Project>
  getProject(id: string): Promise<Project>

  // Crawls
  startCrawl(projectId: string): Promise<{ jobId: string }>
  getCrawl(projectId: string): Promise<CrawlJob>

  // Pages
  listPages(projectId: string, params?: { pageType?: PageType; status?: string; limit?: number; offset?: number }): Promise<{ total: number; items: Page[] }>
  getPageCapture(pageId: string): Promise<PageCapture>

  // Analysis
  startAnalysis(projectId: string): Promise<{ runId: string }>
  getAnalysis(projectId: string): Promise<AnalysisRun & { components: CommerceComponent[]; mappings: PlugoMapping[] }>

  // Intelligence
  startIntelligence(projectId: string): Promise<{ runId: string }>
  getIntelligence(projectId: string): Promise<IntelligenceRun>

  // Blueprint
  startBlueprint(projectId: string): Promise<{ blueprintId: string }>
  getBlueprint(projectId: string): Promise<Blueprint>
  getBlueprintDownloadUrl(blueprintId: string): string   // returns the API path, not a presigned URL
  getMcpConfig(projectId: string): Promise<{ mcpServerUrl: string; projectId: string }>
}
```

`getBlueprintDownloadUrl` returns `/api/blueprints/${blueprintId}/download` as a plain string — the UI opens it as an anchor `href`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd apps/web && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/
git commit -m "feat(web): add typed API client"
```

---

### Task 3: Common Components + Shell

**Files:**
- Create: `apps/web/src/components/common/StatusBadge.tsx`
- Create: `apps/web/src/components/common/ErrorBanner.tsx`
- Create: `apps/web/src/components/common/Spinner.tsx`
- Create: `apps/web/src/components/common/EmptyState.tsx`
- Create: `apps/web/src/components/layout/Shell.tsx`
- Create: `apps/web/src/components/layout/PageHeader.tsx`
- Test: `apps/web/tests/components/StatusBadge.test.tsx`

**Interfaces:**
- Produces: `<StatusBadge status="measured" />`, `<Shell>`, `<PageHeader title="..." />` used by all pages

- [ ] **Step 1: Write failing test for `StatusBadge`**

```typescript
// tests/components/StatusBadge.test.tsx
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/components/common/StatusBadge'

test.each([
  ['measured', 'green'],
  ['inferred', 'yellow'],
  ['unknown', 'red'],
  ['unavailable', 'red'],
  ['not_applicable', 'grey'],
] as const)('renders %s status with %s colour class', (status, colour) => {
  const { container } = render(<StatusBadge status={status} />)
  expect(container.firstChild).toHaveClass(colour)
  expect(screen.getByText(status.replace('_', ' '))).toBeInTheDocument()
})

test('also accepts job statuses', () => {
  render(<StatusBadge status="completed" />)
  expect(screen.getByText('completed')).toBeInTheDocument()
})
```

Run: `npm test`
Expected: FAIL — `StatusBadge` not found.

- [ ] **Step 2: Implement `StatusBadge`**

Colour map (Tailwind class fragments):
- `measured` / `completed` / `ready` → `bg-green-100 text-green-800`
- `inferred` / `running` / `pending` → `bg-yellow-100 text-yellow-800`
- `unknown` / `unavailable` / `failed` → `bg-red-100 text-red-800`
- `not_applicable` / `capturing` / `discovered` → `bg-gray-100 text-gray-700`

Render a `<span>` with `rounded-full px-2 py-0.5 text-xs font-medium` plus the colour classes. Display text: replace underscores with spaces.

- [ ] **Step 3: Implement remaining common components**

`ErrorBanner`: red banner with an `×` dismiss button. Props: `message: string; onDismiss?: () => void`.

`Spinner`: animated SVG circle. Props: `size?: 'sm' | 'md' | 'lg'` (default `md`).

`EmptyState`: centred text + optional CTA button. Props: `title: string; description?: string; action?: { label: string; onClick: () => void }`.

- [ ] **Step 4: Implement `Shell` and `PageHeader`**

`Shell`: two-column layout — left `w-56` sidebar with nav links (Projects list, link back to `ProjectsPage`), right `flex-1` main area with `<Outlet />`. Nav links use React Router `<NavLink>` with active state styling (`font-semibold`).

`PageHeader`: `<h1>` with `text-2xl font-bold`, optional `subtitle` prop rendered as `text-sm text-gray-500`, optional `actions` slot on the right.

- [ ] **Step 5: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/
git commit -m "feat(web): add shell layout and common components"
```

---

### Task 4: Projects Page (List + Create)

**Files:**
- Create: `apps/web/src/hooks/useProject.ts`
- Create: `apps/web/src/components/projects/ProjectCard.tsx`
- Create: `apps/web/src/components/projects/CreateProjectForm.tsx`
- Modify: `apps/web/src/pages/ProjectsPage.tsx`
- Test: `apps/web/tests/components/CreateProjectForm.test.tsx`
- Test: `apps/web/tests/pages/ProjectsPage.test.tsx`

**Interfaces:**
- Consumes: `apiClient.listProjects()`, `apiClient.createProject()`
- Produces: working `ProjectsPage` that lists projects and opens a create-project form

- [ ] **Step 1: Write failing tests**

```typescript
// tests/components/CreateProjectForm.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateProjectForm } from '@/components/projects/CreateProjectForm'

test('calls onSubmit with name and url when form is valid', async () => {
  const onSubmit = vi.fn()
  render(<CreateProjectForm onSubmit={onSubmit} onCancel={vi.fn()} />)
  await userEvent.type(screen.getByLabelText('Project name'), 'ACME Store')
  await userEvent.type(screen.getByLabelText('URL'), 'https://acme.com')
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
  expect(onSubmit).toHaveBeenCalledWith({ name: 'ACME Store', url: 'https://acme.com' })
})

test('shows validation error when URL is not https', async () => {
  render(<CreateProjectForm onSubmit={vi.fn()} onCancel={vi.fn()} />)
  await userEvent.type(screen.getByLabelText('URL'), 'http://acme.com')
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
  expect(screen.getByText(/must be https/i)).toBeInTheDocument()
})
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Implement `useProject.ts` hooks**

```typescript
export function useProjects(): UseQueryResult<Project[]>
export function useProject(id: string): UseQueryResult<Project>
export function useCreateProject(): UseMutationResult<Project, Error, { name: string; url: string }>
```

`useProjects` staleTime 10 s. `useCreateProject` on success: invalidate `['projects']` query and call a passed `onSuccess` callback.

- [ ] **Step 3: Implement `ProjectCard`**

Card showing: project name (bold), URL (truncated, link), status badge, `createdAt` relative time. Click navigates to `/projects/:id`.

- [ ] **Step 4: Implement `CreateProjectForm`**

Controlled form with two fields: `Project name` (required, min 2 chars) and `URL` (required, must start with `https://`). Submit button disabled while mutation is pending. On error from mutation: show `<ErrorBanner>`.

- [ ] **Step 5: Implement `ProjectsPage`**

Grid of `<ProjectCard>` components (3 columns on wide screens). `+` button top-right opens an inline modal with `<CreateProjectForm>`. Show `<Spinner>` while loading, `<EmptyState>` with "Create your first project" CTA when list is empty.

- [ ] **Step 6: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ProjectsPage.tsx apps/web/src/hooks/useProject.ts apps/web/src/components/projects/
git commit -m "feat(web): projects list and create form"
```

---

### Task 5: Project Dashboard

**Files:**
- Create: `apps/web/src/hooks/useCrawl.ts`
- Create: `apps/web/src/components/crawl/CrawlProgress.tsx`
- Create: `apps/web/src/components/crawl/PageTypeBreakdown.tsx`
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx`
- Test: `apps/web/tests/components/CrawlProgress.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getCrawl()`, `apiClient.getProject()`, `apiClient.startCrawl()`, `apiClient.startAnalysis()`, `apiClient.startIntelligence()`, `apiClient.startBlueprint()`
- Produces: dashboard with pipeline stage buttons and live crawl counters

- [ ] **Step 1: Write failing test for `CrawlProgress`**

```typescript
// tests/components/CrawlProgress.test.tsx
import { render, screen } from '@testing-library/react'
import { CrawlProgress } from '@/components/crawl/CrawlProgress'

const job = { id: 'j1', projectId: 'p1', status: 'running', pagesDiscovered: 100, pagesCaptured: 42, pagesFailed: 3, createdAt: new Date().toISOString() }

test('displays discovered, captured and failed counts', () => {
  render(<CrawlProgress job={job} />)
  expect(screen.getByText('100')).toBeInTheDocument() // discovered
  expect(screen.getByText('42')).toBeInTheDocument()  // captured
  expect(screen.getByText('3')).toBeInTheDocument()   // failed
})

test('shows progress bar at correct percentage', () => {
  render(<CrawlProgress job={job} />)
  const bar = screen.getByRole('progressbar')
  expect(bar).toHaveAttribute('aria-valuenow', '42')
  expect(bar).toHaveAttribute('aria-valuemax', '100')
})

test('stops polling when status is completed', () => {
  const refetch = vi.fn()
  render(<CrawlProgress job={{ ...job, status: 'completed' }} refetch={refetch} />)
  // After mount, refetch should not have been scheduled
  expect(refetch).not.toHaveBeenCalled()
})
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Implement `useCrawl.ts`**

```typescript
export function useCrawlStatus(projectId: string): UseQueryResult<CrawlJob>
export function useStartCrawl(): UseMutationResult<{ jobId: string }, Error, string>
```

`useCrawlStatus`: refetch every 5 s while `status === 'running'` using `refetchInterval: (data) => data?.status === 'running' ? 5000 : false`.

- [ ] **Step 3: Implement `CrawlProgress`**

Props: `job: CrawlJob; refetch?: () => void`. Displays three stat tiles (Discovered / Captured / Failed) and an `<progress>` bar (`aria-valuenow`, `aria-valuemax`, `aria-label="Crawl progress"`). Percentage = `pagesCaptured / pagesDiscovered * 100`, clamp to 0–100.

- [ ] **Step 4: Implement `PageTypeBreakdown`**

Props: `pages: Page[]`. Groups pages by `pageType` and renders a horizontal bar chart using plain CSS `flex` widths (no chart library). Each bar labelled with type and count.

- [ ] **Step 5: Implement `ProjectDetailPage`**

Sections:
1. **Header** — project name, URL, status badge, "View pages" link
2. **Pipeline** — four stage buttons in sequence: `Start Crawl` / `Analyse` / `Extract Intelligence` / `Generate Blueprint`. Each button: disabled until its prerequisite stage is complete (guard on `project.status`), shows `<Spinner>` while the mutation is pending, navigates to the relevant sub-page on success where appropriate.
3. **Crawl status** — `<CrawlProgress>` when a crawl job exists
4. **Page breakdown** — `<PageTypeBreakdown>` when crawl completed

Stage prerequisite guard:
- `Start Crawl` — enabled when `status === 'created'`
- `Analyse` — enabled when `status === 'crawl_complete'`
- `Extract Intelligence` — enabled when `status === 'analysis_complete'`
- `Generate Blueprint` — enabled when `status === 'intelligence_complete'`

- [ ] **Step 6: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ProjectDetailPage.tsx apps/web/src/hooks/useCrawl.ts apps/web/src/components/crawl/
git commit -m "feat(web): project dashboard with pipeline controls and crawl progress"
```

---

### Task 6: Page Inventory Table

**Files:**
- Modify: `apps/web/src/pages/PagesPage.tsx`
- Test: (covered by manual smoke test; unit test surface is too shallow for a dedicated file)

**Interfaces:**
- Consumes: `apiClient.listPages()` with filter params
- Produces: paginated, filterable table of crawled pages linking to evidence viewer

- [ ] **Step 1: Implement `PagesPage`**

Features:
- Filter bar: `Page type` dropdown (all types + "All"), `Status` dropdown (`all | captured | failed`), free-text URL search (debounced 300 ms)
- Table columns: URL (truncated to 60 chars, full URL in `title`), Page Type (badge), Status (badge), Depth, Actions ("View evidence" link → `/projects/:id/pages/:pageId/evidence`)
- Pagination: `Prev` / `Next` buttons, "Showing X–Y of Z pages", page size 25
- Empty state when no pages match filter
- Error banner on fetch failure

Server-side pagination: pass `limit=25&offset=N` to `apiClient.listPages()`; do NOT load all pages into memory.

- [ ] **Step 2: Verify in browser**

Start dev server, create a project (or use a fixture), navigate to `/projects/:id/pages`. Confirm filter, pagination, and evidence link all work. Confirm no visible React errors in console.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PagesPage.tsx
git commit -m "feat(web): page inventory table with filters and pagination"
```

---

### Task 7: Evidence Viewer (Three-Panel)

**Files:**
- Create: `apps/web/src/components/evidence/EvidencePanel.tsx`
- Create: `apps/web/src/components/evidence/DomTreeViewer.tsx`
- Create: `apps/web/src/components/evidence/StylesPanel.tsx`
- Create: `apps/web/src/components/evidence/ScreenshotViewer.tsx`
- Modify: `apps/web/src/pages/EvidenceViewerPage.tsx`
- Test: `apps/web/tests/components/EvidencePanel.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getPageCapture()`, page S3 keys (screenshots served via API proxy endpoint `GET /api/pages/:id/screenshot/:viewport`)
- Produces: three-panel layout with DOM tree, styles panel, and screenshot viewer

- [ ] **Step 1: Write failing test for `EvidencePanel`**

```typescript
// tests/components/EvidencePanel.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'

const capture = {
  id: 'cap-1', pageId: 'pg-1', viewportWidth: 1440, viewportHeight: 900,
  screenshotDesktopKey: 'projects/p1/screenshots/pg1-desktop.png',
  capturedAt: new Date().toISOString(),
}

test('renders three panel tabs', () => {
  render(<EvidencePanel capture={capture} domData={[]} stylesData={{}} />)
  expect(screen.getByRole('tab', { name: 'DOM' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Styles' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Screenshot' })).toBeInTheDocument()
})

test('switches panel on tab click', async () => {
  render(<EvidencePanel capture={capture} domData={[]} stylesData={{}} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Screenshot' }))
  expect(screen.getByRole('tab', { name: 'Screenshot' })).toHaveAttribute('aria-selected', 'true')
})
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Implement `ScreenshotViewer`**

Props: `pageId: string; hasDesktop: boolean; hasMobile: boolean`. Toggle between Desktop / Mobile. Renders `<img src="/api/pages/:pageId/screenshot/:viewport" alt="...">`. On image error: show "Screenshot unavailable".

- [ ] **Step 3: Implement `DomTreeViewer`**

Props: `nodes: DomNode[]` (the `DomNode` type from Sub-plan A). Renders a collapsible tree. Each node shows tag + first 2 classes + text preview (40 chars). Collapsed by default beyond depth 2.

- [ ] **Step 4: Implement `StylesPanel`**

Props: `styles: Record<string, ElementStyles>` (keyed by selector). Renders a list of selectors; clicking one expands computed properties as a two-column table (property / value). EvidenceStatus badge per value where present.

- [ ] **Step 5: Implement `EvidencePanel` and `EvidenceViewerPage`**

`EvidencePanel`: tabbed wrapper (DOM / Styles / Screenshot). Active tab controlled by `aria-selected`.

`EvidenceViewerPage`: fetch `PageCapture` and the raw DOM/CSS JSON files via API, pass to `<EvidencePanel>`. Show `<Spinner>` while loading. Breadcrumb: Project → Pages → Evidence for `<url>`.

- [ ] **Step 6: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/evidence/ apps/web/src/pages/EvidenceViewerPage.tsx
git commit -m "feat(web): three-panel evidence viewer"
```

---

### Task 8: Gap Report Screen

**Files:**
- Create: `apps/web/src/hooks/useBlueprint.ts`
- Create: `apps/web/src/components/gap-report/GapReportTable.tsx`
- Create: `apps/web/src/components/gap-report/GapBadge.tsx`
- Modify: `apps/web/src/pages/GapReportPage.tsx`
- Test: `apps/web/tests/components/GapReportTable.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getAnalysis()` → `components[]` + `mappings[]`
- Produces: table showing each detected commerce component with its Plugo mapping status

- [ ] **Step 1: Write failing test for `GapReportTable`**

```typescript
// tests/components/GapReportTable.test.tsx
import { render, screen } from '@testing-library/react'
import { GapReportTable } from '@/components/gap-report/GapReportTable'

const mappings = [
  { componentType: 'product-grid', plugoEndpoint: 'GET /products', renderHint: 'Paginate...', isGap: false },
  { componentType: 'customer-login', isGap: true, gapReason: 'No auth API in Plugo v1', renderHint: '' },
]

test('renders a row per mapping', () => {
  render(<GapReportTable mappings={mappings} />)
  expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2 rows
})

test('marks gap rows with red badge', () => {
  render(<GapReportTable mappings={mappings} />)
  expect(screen.getByText('Gap')).toBeInTheDocument()
  expect(screen.getByText('Available')).toBeInTheDocument()
})

test('shows gap reason for gap components', () => {
  render(<GapReportTable mappings={mappings} />)
  expect(screen.getByText('No auth API in Plugo v1')).toBeInTheDocument()
})
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Implement `GapBadge`**

Props: `isGap: boolean`. Renders "Available" (green) or "Gap" (red) pill using `<StatusBadge>` colour classes.

- [ ] **Step 3: Implement `GapReportTable`**

Props: `mappings: PlugoMapping[]`. Columns: Component Type, Status (`<GapBadge>`), Plugo Endpoint (or "—"), Render Hint (truncated 80 chars, expand on click), Gap Reason (shown only when `isGap`). Sort: gaps first, then alphabetical by component type.

- [ ] **Step 4: Implement `useBlueprint.ts` hooks**

```typescript
export function useAnalysis(projectId: string): UseQueryResult<AnalysisRun & { components: CommerceComponent[]; mappings: PlugoMapping[] }>
export function useIntelligence(projectId: string): UseQueryResult<IntelligenceRun>
export function useBlueprint(projectId: string): UseQueryResult<Blueprint>
export function useStartAnalysis(): UseMutationResult<{ runId: string }, Error, string>
export function useStartIntelligence(): UseMutationResult<{ runId: string }, Error, string>
export function useStartBlueprint(): UseMutationResult<{ blueprintId: string }, Error, string>
```

`useAnalysis` / `useIntelligence` / `useBlueprint`: refetch every 3 s while status is `running` or `pending`.

- [ ] **Step 5: Implement `GapReportPage`**

Fetches analysis. Shows summary: "X components detected, Y available in Plugo v1, Z gaps". Below: `<GapReportTable>`. Link to Export page when blueprint is ready. `<Spinner>` while analysis is loading/running. `<ErrorBanner>` on failure.

- [ ] **Step 6: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/GapReportPage.tsx apps/web/src/hooks/useBlueprint.ts apps/web/src/components/gap-report/
git commit -m "feat(web): gap report screen"
```

---

### Task 9: Export Screen + MCP Config

**Files:**
- Modify: `apps/web/src/pages/ExportPage.tsx`
- Test: `apps/web/tests/pages/ExportPage.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getBlueprint()`, `apiClient.getBlueprintDownloadUrl()`, `apiClient.getMcpConfig()`
- Produces: download link for Blueprint ZIP + copyable MCP config JSON

- [ ] **Step 1: Write failing test for `ExportPage`**

```typescript
// tests/pages/ExportPage.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { ExportPage } from '@/pages/ExportPage'
import * as client from '@/api/client'

vi.mock('@/api/client')

const readyBlueprint = { id: 'bp-1', projectId: 'p1', version: 1, zipSize: 204800, status: 'ready', createdAt: new Date().toISOString() }
const mcpConfig = { mcpServerUrl: 'http://localhost:3000/mcp/p1', projectId: 'p1' }

function setup() {
  vi.mocked(client.apiClient.getBlueprint).mockResolvedValue(readyBlueprint)
  vi.mocked(client.apiClient.getMcpConfig).mockResolvedValue(mcpConfig)
  vi.mocked(client.apiClient.getBlueprintDownloadUrl).mockReturnValue('/api/blueprints/bp-1/download')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/projects/p1/export']}>
        <Routes><Route path="/projects/:id/export" element={<ExportPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

test('shows download link pointing at API endpoint', async () => {
  setup()
  const link = await screen.findByRole('link', { name: /download blueprint/i })
  expect(link).toHaveAttribute('href', '/api/blueprints/bp-1/download')
  expect(link).toHaveAttribute('download')
})

test('shows formatted ZIP size', async () => {
  setup()
  await screen.findByText('200 KB')
})

test('copy button puts MCP config JSON on clipboard', async () => {
  setup()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  await userEvent.click(await screen.findByRole('button', { name: /copy mcp config/i }))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('mcpServerUrl'))
})
```

Run: `npm test`
Expected: FAIL.

- [ ] **Step 2: Implement `ExportPage`**

Sections:
1. **Blueprint ZIP** — when `blueprint.status === 'ready'`: show `<a href={downloadUrl} download>Download Blueprint ZIP</a>` (200 KB · version 1); when `generating`: spinner + "Blueprint is being generated…"; when `failed`: error banner.
2. **MCP Configuration** — code block showing the JSON from `getMcpConfig()` with a "Copy" button. Clicking copy calls `navigator.clipboard.writeText()` and briefly shows "Copied!".

Format ZIP size: bytes → "X KB" (÷ 1024, round to nearest integer).

- [ ] **Step 3: Run tests and verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ExportPage.tsx
git commit -m "feat(web): export screen with blueprint download and MCP config"
```

---

### Task 10: Wire Navigation + End-to-End Smoke Test

**Files:**
- Modify: `apps/web/src/components/layout/Shell.tsx` (add per-project nav links)
- Modify: `apps/web/src/App.tsx` (nest project routes under `ProjectDetailPage` layout)

**Interfaces:**
- Consumes: all prior tasks
- Produces: fully navigable app with all pages wired together

- [ ] **Step 1: Update Shell to show project-scoped nav when inside a project route**

When the current route matches `/projects/:id/*`, show secondary nav links:
- Dashboard (`/projects/:id`)
- Pages (`/projects/:id/pages`)
- Gap Report (`/projects/:id/gap-report`)
- Export (`/projects/:id/export`)

Use `useParams()` to read `:id`. When not in a project route, show only "All Projects" link.

- [ ] **Step 2: Nest project routes under layout**

In `App.tsx`, use a layout route for `/projects/:id` that renders `<Shell>` + `<Outlet>`, so all project sub-pages share the sidebar nav.

- [ ] **Step 3: Manual end-to-end smoke test**

With both `apps/api` (pointing at dev database with a seeded project) and `apps/web` running:

1. Open `http://localhost:5173` → Projects page shows seeded project
2. Click project → Dashboard with "Start Crawl" button enabled
3. Click "Start Crawl" → button becomes spinner, crawl job created, progress updates every 5 s
4. After crawl completes → "Analyse" button enabled; click it
5. After analysis → navigate to "Gap Report" page → table shows components with gap/available badges
6. Navigate to "Pages" → filter by page type works, click "View evidence" → three-panel viewer opens
7. After intelligence + blueprint → navigate to "Export" → download link present, MCP config copy works

Expected: all steps complete without console errors or unhandled promise rejections.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Shell.tsx
git commit -m "feat(web): wire navigation and complete app shell"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-09-management-ui.md`. Please review the plan.

**Which execution approach would you prefer?**

- **Subagent-driven** — fresh subagent per task with independent review before the next task starts; most thorough.
- **Native** — all tasks implemented in this session, one reviewer pass on the whole branch at the end; fastest.

For this plan I recommend **Native**, because the 10 tasks have sequential dependencies (each page depends on the hooks from the previous task), there is no parallelism to exploit, and a single reviewer pass at the end is sufficient for a UI that connects to already-tested API endpoints.

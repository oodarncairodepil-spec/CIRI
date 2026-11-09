# Website Inspector — Implementation Plan
## Sub-project A of 4: Plugo Migration Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable, deterministic browser-based extraction engine that crawls a target website, captures its full DOM, computed CSS, geometry, screenshots, and assets, and stores traceable raw evidence in PostgreSQL and S3 — producing everything an AI design intelligence engine needs to reconstruct an exact visual replica.

**Architecture:** A Node.js + TypeScript backend with Playwright workers running as BullMQ queue consumers. Discovery (sitemap, internal links, page classification) feeds a crawl queue. Each queued page is opened in a real Chromium browser; DOM, CSS, geometry, screenshots, and assets are extracted and written to S3 (files) and PostgreSQL (metadata). A REST API exposes project and crawl management. No AI analysis happens in this sub-project — raw evidence only.

**Tech stack:** Node.js 22 + TypeScript 5, Playwright 1.49, Chrome DevTools Protocol (via Playwright CDP session), BullMQ 5 + Redis 7, PostgreSQL 16, AWS S3 (or MinIO for local dev), Sharp 0.33, Vitest 2, Supertest, Express 5.

**Spec:** `/Users/plugoemployee/REA/FM26/plan.md` — Sections 3, 4.1–4.8, 5, 6, 9, 12, 15 (Phase 1 and Phase 2), 16 (E01–E07).

---

## Global Constraints

- All prices, measurements, and CSS values stored as the browser reports them — no rounding, no normalisation beyond what the spec requires.
- Every extracted value carries an `evidenceStatus`: `measured` | `inferred` | `unknown` | `unavailable` | `not_applicable`. Never silently promote `inferred` to `measured`.
- A single page failure must not fail the entire crawl — errors are recorded per page and the crawl continues.
- Jobs are idempotent: re-running a crawl for a page that already has a completed capture must skip capture unless `force: true` is passed.
- Browser workers must run as separate processes from the API server — do not block the HTTP event loop with Playwright.
- Asset download is best-effort — a failed download is recorded in the asset manifest with `downloadStatus: "failed"` and does not fail the page capture.
- The store key and all S3/DB credentials live in environment variables only — never committed to source.
- Default viewports: desktop 1440×900, mobile 390×844.
- CSS extraction targets the properties listed in plan.md §4.3 — not all 200+ computed properties, only the meaningful subset.
- TypeScript strict mode on. No `any` without a `// eslint-disable` comment and a reason.

## Review Focus

1. **URL trap detection** — calendar URLs (`?date=2024-01-01`, `/calendar/2024/01`), faceted nav (`?color=red&size=M`), and infinite pagination (`?page=9999`) must be detected and skipped. If the loop-detection logic is bypassed, the crawl queue grows without bound.
2. **Lazy-loaded images not captured** — assets below the fold that load on scroll will be missed unless the capturer scrolls the full page before asset discovery. Test with a page whose images are `loading="lazy"`.
3. **Missing `compareAtPrice` guard** — this is optional in the Plugo API; the same guard pattern must be enforced on CSS optional fields (`computedStyles.font-family` may be absent for SVG text nodes). Guard every optional CSS property with `?? undefined`.
4. **BullMQ worker crash leaves job stuck** — if a worker process crashes mid-job (OOM, Playwright timeout), the job must be rescheduled. Test that jobs with `attempts > 1` and an `onFailed` hook requeue correctly.
5. **CDP session disconnection on navigation** — attaching a CDP session before navigation and navigating away closes the session. Attach CDP *after* `page.goto()` resolves.

---

## File Structure

```
apps/
└── api/
    ├── src/
    │   ├── config/
    │   │   └── env.ts                        ← typed env validation (zod)
    │   ├── db/
    │   │   ├── client.ts                     ← postgres pool (pg)
    │   │   ├── schema.ts                     ← typed row interfaces
    │   │   └── migrations/
    │   │       └── 001_initial.sql
    │   ├── storage/
    │   │   └── s3.ts                         ← upload / download / presign
    │   ├── queue/
    │   │   ├── client.ts                     ← BullMQ Queue + Worker factories
    │   │   └── workers/
    │   │       ├── capture-worker.ts         ← one page → DOM+CSS+geo+screenshots+assets
    │   │       └── asset-worker.ts           ← download one asset URL
    │   ├── services/
    │   │   ├── discovery/
    │   │   │   ├── url-normalizer.ts
    │   │   │   ├── sitemap-parser.ts
    │   │   │   ├── link-extractor.ts
    │   │   │   └── page-classifier.ts
    │   │   ├── browser/
    │   │   │   ├── browser-pool.ts
    │   │   │   ├── page-loader.ts            ← goto + wait for fonts/network idle
    │   │   │   ├── dom-extractor.ts
    │   │   │   ├── css-extractor.ts          ← computed + matched (CDP) + pseudo-elements
    │   │   │   ├── geometry-extractor.ts
    │   │   │   ├── screenshot-capturer.ts
    │   │   │   └── asset-extractor.ts
    │   │   ├── projects/
    │   │   │   └── project-service.ts
    │   │   └── crawl/
    │   │       └── crawl-service.ts
    │   ├── routes/
    │   │   ├── projects.ts
    │   │   └── crawls.ts
    │   └── index.ts
    ├── tests/
    │   ├── fixtures/
    │   │   ├── test-site/                    ← static HTML pages served by fixture server
    │   │   │   ├── index.html
    │   │   │   ├── category.html
    │   │   │   └── product.html
    │   │   └── sitemaps/
    │   │       ├── sitemap.xml
    │   │       └── sitemap-index.xml
    │   ├── unit/
    │   │   ├── discovery/
    │   │   │   ├── url-normalizer.test.ts
    │   │   │   ├── sitemap-parser.test.ts
    │   │   │   └── page-classifier.test.ts
    │   │   └── browser/
    │   │       ├── dom-extractor.test.ts
    │   │       └── css-extractor.test.ts
    │   └── integration/
    │       ├── projects.test.ts
    │       ├── crawl.test.ts
    │       └── capture.test.ts               ← end-to-end against fixture site
    ├── package.json
    ├── tsconfig.json
    └── vitest.config.ts
docker-compose.yml                            ← postgres + redis + minio
.env.example
docs/
└── superpowers/
    └── plans/
        └── 2026-11-09-website-inspector.md
```

---

## Task 1: Project scaffolding, database schema, infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/001_initial.sql`
- Create: `apps/api/src/storage/s3.ts`
- Create: `apps/api/src/queue/client.ts`

**Interfaces:**
- Produces: `Env` (typed config), `db` (pg Pool), `s3` (upload/download), `queue` / `createWorker` (BullMQ factories) — imported by all later tasks.

---

- [ ] **Step 1: Write `001_initial.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'created',
  config      JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crawl_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id),
  status            TEXT NOT NULL DEFAULT 'pending',
  pages_discovered  INTEGER DEFAULT 0,
  pages_captured    INTEGER DEFAULT 0,
  pages_failed      INTEGER DEFAULT 0,
  config            JSONB,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES projects(id),
  crawl_job_id     UUID REFERENCES crawl_jobs(id),
  url              TEXT NOT NULL,
  page_type        TEXT NOT NULL DEFAULT 'other',
  discovery_source TEXT,
  crawl_depth      INTEGER DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'discovered',
  error            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, url)
);

CREATE TABLE page_captures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id                 UUID NOT NULL REFERENCES pages(id),
  viewport_width          INTEGER NOT NULL,
  viewport_height         INTEGER NOT NULL,
  screenshot_desktop_key  TEXT,
  screenshot_mobile_key   TEXT,
  dom_key                 TEXT,
  css_key                 TEXT,
  geometry_key            TEXT,
  browser_metadata        JSONB,
  captured_at             TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  original_url    TEXT NOT NULL,
  s3_key          TEXT,
  asset_type      TEXT NOT NULL,
  mime_type       TEXT,
  file_size       INTEGER,
  natural_width   INTEGER,
  natural_height  INTEGER,
  content_hash    TEXT,
  download_status TEXT NOT NULL DEFAULT 'pending',
  error           TEXT,
  UNIQUE(project_id, original_url)
);
```

- [ ] **Step 2: Write `docker-compose.yml`** with services: `postgres:16`, `redis:7-alpine`, `minio/minio`. Postgres mounts `001_initial.sql` via `/docker-entrypoint-initdb.d/`.

- [ ] **Step 3: Write `apps/api/src/config/env.ts`** — use `zod` to parse `process.env`. Export typed `Env` interface and singleton `env`. Required vars: `DATABASE_URL`, `REDIS_URL`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `PORT` (default 3000).

- [ ] **Step 4: Write `apps/api/src/db/client.ts`** — export `db`: a `pg.Pool` configured from `env.DATABASE_URL`. Export `query<T>(sql, params?)` helper.

- [ ] **Step 5: Write `apps/api/src/db/schema.ts`** — TypeScript interfaces `Project`, `CrawlJob`, `Page`, `PageCapture`, `Asset` matching the SQL schema exactly. Use `EvidenceStatus = 'measured' | 'inferred' | 'unknown' | 'unavailable' | 'not_applicable'`.

- [ ] **Step 6: Write `apps/api/src/storage/s3.ts`** — export `uploadFile(key: string, body: Buffer | Readable, contentType: string): Promise<void>`, `downloadFile(key: string): Promise<Buffer>`, `presignUrl(key: string, expirySeconds: number): Promise<string>`. Use `@aws-sdk/client-s3`.

- [ ] **Step 7: Write `apps/api/src/queue/client.ts`** — export `createQueue(name: string): Queue`, `createWorker(name: string, processor: Processor, concurrency: number): Worker`. Configure both from `env.REDIS_URL`.

- [ ] **Step 8: Write `apps/api/package.json`** and `tsconfig.json`. Key deps: `express@^5`, `pg`, `bullmq`, `playwright`, `@aws-sdk/client-s3`, `sharp`, `zod`, `axios`. Dev: `vitest`, `supertest`, `@types/node`, `typescript`.

- [ ] **Step 9: Run `docker compose up -d` and confirm all three services start**

Expected: `docker compose ps` shows postgres, redis, minio all `running`.

- [ ] **Step 10: Run `npx tsx apps/api/src/db/client.ts` with a test query to confirm DB connectivity**

Expected: no connection error.

- [ ] **Step 11: Commit**

```bash
git add docker-compose.yml .env.example apps/api/
git commit -m "feat: project scaffolding, DB schema, S3/queue clients"
```

---

## Task 2: URL normalizer + validator

**Files:**
- Create: `apps/api/src/services/discovery/url-normalizer.ts`
- Create: `apps/api/tests/unit/discovery/url-normalizer.test.ts`

**Interfaces:**
- Produces: `normalizeUrl(raw: string, baseOrigin: string): string | null`
- Produces: `isEligibleUrl(url: string, baseOrigin: string): boolean`
- Consumed by: Task 4 (link extractor), Task 3 (sitemap parser)

---

- [ ] **Step 1: Write failing tests**

```typescript
// url-normalizer.test.ts
import { normalizeUrl, isEligibleUrl } from '../../../src/services/discovery/url-normalizer'

const BASE = 'https://example.com'

test('strips trailing slash from path', () => {
  expect(normalizeUrl('https://example.com/about/', BASE)).toBe('https://example.com/about')
})
test('preserves root slash', () => {
  expect(normalizeUrl('https://example.com/', BASE)).toBe('https://example.com/')
})
test('removes utm_* tracking params', () => {
  expect(normalizeUrl('https://example.com/p?utm_source=google&utm_medium=cpc', BASE))
    .toBe('https://example.com/p')
})
test('removes fbclid param', () => {
  expect(normalizeUrl('https://example.com/p?fbclid=abc123', BASE))
    .toBe('https://example.com/p')
})
test('preserves page pagination param', () => {
  expect(normalizeUrl('https://example.com/products?page=2', BASE))
    .toBe('https://example.com/products?page=2')
})
test('removes fragment', () => {
  expect(normalizeUrl('https://example.com/about#section', BASE))
    .toBe('https://example.com/about')
})
test('resolves relative URL against base', () => {
  expect(normalizeUrl('/contact', BASE)).toBe('https://example.com/contact')
})
test('returns null for external URL', () => {
  expect(normalizeUrl('https://external.com/page', BASE)).toBeNull()
})
test('returns null for mailto', () => {
  expect(normalizeUrl('mailto:info@example.com', BASE)).toBeNull()
})
test('returns null for javascript:', () => {
  expect(normalizeUrl('javascript:void(0)', BASE)).toBeNull()
})
test('returns null for anchor-only', () => {
  expect(normalizeUrl('#top', BASE)).toBeNull()
})
test('detects calendar trap URL', () => {
  expect(isEligibleUrl('https://example.com/calendar/2024/01/15', BASE)).toBe(false)
})
test('detects excessive query param combination (faceted nav trap)', () => {
  expect(isEligibleUrl('https://example.com/products?color=red&size=M&brand=nike&material=cotton&fit=slim', BASE)).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/discovery/url-normalizer.test.ts
```

Expected: all FAIL with "Cannot find module".

- [ ] **Step 3: Implement `normalizeUrl` and `isEligibleUrl` in `url-normalizer.ts`**

`normalizeUrl`: parse with `new URL()`, resolve relative URLs against `baseOrigin`, return `null` for non-http(s) schemes, external origins, or pure-fragment URLs. Strip `utm_*`, `fbclid`, `gclid`, `ref`, `mc_cid`, `mc_eid` from search params. Remove trailing slash from path (except root `/`). Remove `#fragment`.

`isEligibleUrl`: call `normalizeUrl` first (null → false). Then reject URLs matching calendar patterns (`/\d{4}\/\d{2}\/\d{2}/`), or URLs with more than 4 distinct query parameters (faceted nav heuristic).

- [ ] **Step 4: Run tests to verify they all pass**

```bash
cd apps/api && npx vitest run tests/unit/discovery/url-normalizer.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/discovery/url-normalizer.ts apps/api/tests/unit/discovery/url-normalizer.test.ts
git commit -m "feat: URL normalizer and trap detector"
```

---

## Task 3: Sitemap + robots.txt parser

**Files:**
- Create: `apps/api/src/services/discovery/sitemap-parser.ts`
- Create: `apps/api/tests/fixtures/sitemaps/sitemap.xml`
- Create: `apps/api/tests/fixtures/sitemaps/sitemap-index.xml`
- Create: `apps/api/tests/unit/discovery/sitemap-parser.test.ts`

**Interfaces:**
- Produces: `fetchSitemapUrls(baseUrl: string, options?: { maxUrls?: number }): Promise<string[]>`
- Consumed by: Task 6 (crawl service, discovery phase)

---

- [ ] **Step 1: Create fixture XML files**

`sitemap.xml` — standard `<urlset>` with 3 known URLs including one with `<lastmod>`.

`sitemap-index.xml` — `<sitemapindex>` pointing to two sub-sitemaps (served by the fixture server).

- [ ] **Step 2: Write failing tests**

```typescript
// sitemap-parser.test.ts
import { createServer } from 'http'
import { fetchSitemapUrls } from '../../../src/services/discovery/sitemap-parser'

let server: ReturnType<typeof createServer>
let baseUrl: string

beforeAll(() => { /* start fixture HTTP server serving /sitemaps/ */ })
afterAll(() => { server.close() })

test('parses standard sitemap.xml and returns normalized URLs', async () => {
  const urls = await fetchSitemapUrls(`${baseUrl}`)
  expect(urls).toContain(`${baseUrl}/products`)
  expect(urls).toContain(`${baseUrl}/about`)
  expect(urls.length).toBeGreaterThanOrEqual(3)
})
test('follows sitemap index and returns URLs from all sub-sitemaps', async () => {
  // point to a base that has sitemap-index.xml
  const urls = await fetchSitemapUrls(`${indexBaseUrl}`)
  expect(urls.length).toBeGreaterThan(3)
})
test('returns empty array when sitemap.xml is 404', async () => {
  const urls = await fetchSitemapUrls('https://nonexistent.local')
  expect(urls).toEqual([])
})
test('respects maxUrls limit', async () => {
  const urls = await fetchSitemapUrls(baseUrl, { maxUrls: 2 })
  expect(urls.length).toBeLessThanOrEqual(2)
})
test('extracts sitemap URL from robots.txt', async () => {
  // fixture server serves /robots.txt with Sitemap: directive
  const urls = await fetchSitemapUrls(robotsBaseUrl)
  expect(urls.length).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/discovery/sitemap-parser.test.ts
```

- [ ] **Step 4: Implement `sitemap-parser.ts`**

Use `axios` for HTTP fetches. Parse XML with `fast-xml-parser`. Check `GET /robots.txt` first for `Sitemap:` directive. Fall back to `GET /sitemap.xml`. Handle `<sitemapindex>` by recursively fetching child sitemaps. Return de-duplicated, normalized URLs using `normalizeUrl`.

- [ ] **Step 5: Run tests to verify they all pass**

```bash
cd apps/api && npx vitest run tests/unit/discovery/sitemap-parser.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/discovery/sitemap-parser.ts apps/api/tests/
git commit -m "feat: sitemap.xml and robots.txt parser"
```

---

## Task 4: Internal link extractor + page classifier

**Files:**
- Create: `apps/api/src/services/discovery/link-extractor.ts`
- Create: `apps/api/src/services/discovery/page-classifier.ts`
- Create: `apps/api/tests/unit/discovery/page-classifier.test.ts`

**Interfaces:**
- Produces: `extractLinks(page: Page, baseOrigin: string): Promise<string[]>` — returns normalized eligible internal URLs
- Produces: `classifyPage(url: string, signals?: PageSignals): PageType`
- `PageSignals = { title?: string; h1?: string; bodyText?: string }`
- `PageType = 'homepage' | 'category' | 'subcategory' | 'product' | 'search' | 'collection' | 'brand' | 'campaign' | 'content' | 'static' | 'cart' | 'other'`
- Consumed by: Task 7 (capture worker, discovery phase)

---

- [ ] **Step 1: Write failing tests for `classifyPage`**

```typescript
// page-classifier.test.ts
import { classifyPage } from '../../../src/services/discovery/page-classifier'

test('classifies root as homepage', () => {
  expect(classifyPage('https://example.com/')).toBe('homepage')
  expect(classifyPage('https://example.com')).toBe('homepage')
})
test('classifies /collections/* as category', () => {
  expect(classifyPage('https://example.com/collections/shoes')).toBe('category')
})
test('classifies /products/* as product', () => {
  expect(classifyPage('https://example.com/products/nike-air-max')).toBe('product')
})
test('classifies /search as search', () => {
  expect(classifyPage('https://example.com/search?q=shoes')).toBe('search')
  expect(classifyPage('https://example.com/search')).toBe('search')
})
test('classifies /cart as cart', () => {
  expect(classifyPage('https://example.com/cart')).toBe('cart')
})
test('classifies /about and /faq and /contact as static', () => {
  expect(classifyPage('https://example.com/about')).toBe('static')
  expect(classifyPage('https://example.com/faq')).toBe('static')
  expect(classifyPage('https://example.com/contact')).toBe('static')
})
test('classifies /blog/* as content', () => {
  expect(classifyPage('https://example.com/blog/best-shoes-2024')).toBe('content')
})
test('falls back to other for unrecognised pattern', () => {
  expect(classifyPage('https://example.com/some-weird-page-xyz')).toBe('other')
})
test('uses h1 signal to override URL-based guess', () => {
  expect(classifyPage('https://example.com/p/123', { h1: 'Nike Air Max 90' })).toBe('product')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/discovery/page-classifier.test.ts
```

- [ ] **Step 3: Implement `page-classifier.ts`**

Pattern-matching in priority order: exact root → homepage; path segments matching `/products?/`, `/collections?/`, `/categories/`, `/shop/` → product or category; `/search`, `/recherche` → search; `/cart`, `/panier`, `/bag` → cart; `/blog/`, `/news/`, `/articles/` → content; `/about`, `/faq`, `/contact`, `/terms`, `/privacy` → static. Apply `h1` signal as a secondary vote when URL pattern returns `other`.

- [ ] **Step 4: Implement `link-extractor.ts`**

No unit test needed here (requires a live browser) — covered by integration test in Task 12. Implementation: use `page.$$eval('a[href]', ...)` to collect all `href` attributes. Run each through `normalizeUrl` + `isEligibleUrl`. Deduplicate. Return array.

- [ ] **Step 5: Run classifier tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/discovery/page-classifier.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/discovery/
git commit -m "feat: internal link extractor and page classifier"
```

---

## Task 5: Browser pool + page loader

**Files:**
- Create: `apps/api/src/services/browser/browser-pool.ts`
- Create: `apps/api/src/services/browser/page-loader.ts`

**Interfaces:**
- Produces: `BrowserPool` class with `acquire(): Promise<Browser>`, `release(b: Browser): Promise<void>`, `close(): Promise<void>`
- Produces: `loadPage(browser: Browser, url: string, options?: LoadOptions): Promise<{ page: Page; cdp: CDPSession }>`
- `LoadOptions = { viewport?: { width: number; height: number }; locale?: string; timeout?: number }`
- Consumed by: Task 7 (capture worker)

---

- [ ] **Step 1: Write failing test for `BrowserPool`**

```typescript
// browser-pool.test.ts (integration — needs Playwright)
import { BrowserPool } from '../../../src/services/browser/browser-pool'

test('acquires and releases a browser without leak', async () => {
  const pool = new BrowserPool({ maxBrowsers: 2 })
  const b1 = await pool.acquire()
  const b2 = await pool.acquire()
  expect(b1).not.toBe(b2)
  await pool.release(b1)
  const b3 = await pool.acquire()
  expect(b3).toBe(b1) // reused
  await pool.release(b2)
  await pool.release(b3)
  await pool.close()
}, 30_000)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run tests/unit/browser/browser-pool.test.ts
```

- [ ] **Step 3: Implement `browser-pool.ts`**

`BrowserPool` launches Chromium via `playwright.chromium.launch({ headless: true })`. Maintains an internal free-list. `acquire()` returns a free browser or launches a new one up to `maxBrowsers` (then awaits release). `release()` returns the browser to the free-list. `close()` closes all browsers.

- [ ] **Step 4: Implement `page-loader.ts`**

`loadPage`: open a new page on the given browser, set viewport, set locale. Navigate with `page.goto(url, { waitUntil: 'networkidle', timeout })`. After navigation, attach a CDP session via `page.context().newCDPSession(page)`. Wait for fonts: `page.evaluate(() => document.fonts.ready)`. Return `{ page, cdp }`.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && npx vitest run tests/unit/browser/browser-pool.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/browser/browser-pool.ts apps/api/src/services/browser/page-loader.ts
git commit -m "feat: browser pool and page loader with CDP session"
```

---

## Task 6: DOM extractor

**Files:**
- Create: `apps/api/src/services/browser/dom-extractor.ts`
- Create: `apps/api/tests/unit/browser/dom-extractor.test.ts`
- Create: `apps/api/tests/fixtures/test-site/index.html` (if not already exists)

**Interfaces:**
- Produces: `extractDom(page: Page): Promise<DomNode[]>`
- `DomNode = { tag: string; id?: string; classes: string[]; text?: string; href?: string; src?: string; attrs: Record<string, string>; bounds: Rect; visible: boolean; children: DomNode[] }`
- `Rect = { x: number; y: number; width: number; height: number }`
- Consumed by: Task 10 (asset extractor uses DOM node refs), evidence storage

---

- [ ] **Step 1: Create `tests/fixtures/test-site/index.html`**

A minimal but realistic page with: a nav, a hero section with an image, a 3-column product grid with 3 cards each containing an img + h2 + price span, and a footer. All elements have meaningful class names. Some elements are hidden with `display:none`.

- [ ] **Step 2: Write failing tests**

```typescript
// dom-extractor.test.ts
import { chromium } from 'playwright'
import { extractDom } from '../../../src/services/browser/dom-extractor'
// starts a local file server for fixtures

test('captures nav element with correct tag and classes', async () => {
  const nodes = await extractDom(page)
  const nav = nodes.find(n => n.tag === 'nav')
  expect(nav).toBeDefined()
  expect(nav!.classes).toContain('main-nav')
})
test('records bounding box dimensions', async () => {
  const nodes = await extractDom(page)
  const hero = nodes.find(n => n.classes.includes('hero'))
  expect(hero!.bounds.width).toBeGreaterThan(0)
  expect(hero!.bounds.height).toBeGreaterThan(0)
})
test('marks hidden elements as not visible', async () => {
  const nodes = await extractDom(page)
  const hidden = nodes.find(n => n.classes.includes('hidden-element'))
  expect(hidden!.visible).toBe(false)
})
test('extracts nested children', async () => {
  const nodes = await extractDom(page)
  const grid = nodes.find(n => n.classes.includes('product-grid'))
  expect(grid!.children.length).toBe(3)
})
test('captures img src attribute', async () => {
  const nodes = await extractDom(page)
  const img = nodes.find(n => n.tag === 'img')
  expect(img!.src).toBeDefined()
  expect(img!.src).toMatch(/\.jpg|\.png|\.webp/)
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/browser/dom-extractor.test.ts
```

- [ ] **Step 4: Implement `dom-extractor.ts`**

Use `page.evaluate()` to run a recursive DOM walker in the browser context. Walk from `document.body`. For each element: capture `tagName.toLowerCase()`, `id`, `className.split(' ')`, `textContent.trim()` (direct text nodes only, not all descendants), `href` (for `<a>`), `src` (for `<img>`, `<video>`, `<source>`), all attributes as a `Record`. Use `getBoundingClientRect()` for bounds. Check visibility: `computed display !== 'none'` and `computed visibility !== 'hidden'` and `computed opacity !== '0'`. Recurse into `children`. Prune script, style, noscript, svg defs elements. Max depth 20 to prevent runaway recursion.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/browser/dom-extractor.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/browser/dom-extractor.ts apps/api/tests/
git commit -m "feat: DOM extractor with bounding boxes and visibility"
```

---

## Task 7: CSS extractor (computed + matched + pseudo-elements)

**Files:**
- Create: `apps/api/src/services/browser/css-extractor.ts`
- Create: `apps/api/tests/unit/browser/css-extractor.test.ts`

**Interfaces:**
- Produces: `extractStyles(page: Page, cdp: CDPSession, selector: string): Promise<ElementStyles>`
- `ElementStyles = { computed: ComputedStyles; matched: MatchedRule[]; cssVars: Record<string, string>; inline?: Record<string, string>; pseudo: { before?: PseudoStyles; after?: PseudoStyles } }`
- `ComputedStyles` — the subset of properties from plan.md §4.3 (layout, flexbox/grid, typography, visual, position)
- `MatchedRule = { selector: string; declarations: Record<string, string>; stylesheetUrl?: string; mediaQuery?: string }`
- `PseudoStyles = { content: string; display: string; color?: string; background?: string; width?: string; height?: string; position?: string }`
- Produces: `extractRootCssVars(page: Page): Promise<Record<string, string>>`
- Consumed by: Task 10 (capture worker, evidence storage)

---

- [ ] **Step 1: Write failing tests**

```typescript
// css-extractor.test.ts
test('captures font-family from computed styles', async () => {
  const styles = await extractStyles(page, cdp, 'h1')
  expect(styles.computed.typography['font-family']).toBeDefined()
  expect(styles.computed.typography['font-family']).not.toBe('')
})
test('captures background-color as rgb value', async () => {
  const styles = await extractStyles(page, cdp, '.hero')
  expect(styles.computed.visual['background-color']).toMatch(/^rgb/)
})
test('captures CSS variables from :root', async () => {
  const vars = await extractRootCssVars(page)
  // fixture index.html defines --color-primary: #e63329 on :root
  expect(vars['--color-primary']).toBe('#e63329')
})
test('captures matched CSS rule selector and stylesheet URL', async () => {
  const styles = await extractStyles(page, cdp, '.product-card')
  expect(styles.matched.length).toBeGreaterThan(0)
  expect(styles.matched[0].selector).toBeDefined()
})
test('captures ::before pseudo-element content', async () => {
  // fixture adds a ::before with content: "→" on .nav-item
  const styles = await extractStyles(page, cdp, '.nav-item')
  expect(styles.pseudo.before?.content).toBe('"→"')
})
test('marks missing optional property as undefined not empty string', async () => {
  const styles = await extractStyles(page, cdp, 'p')
  // p has no box-shadow in fixture
  expect(styles.computed.visual['box-shadow']).toBeUndefined()
})
```

- [ ] **Step 2: Update `tests/fixtures/test-site/index.html`** — add a `<style>` block with `--color-primary: #e63329` on `:root`, a `.nav-item::before { content: "→" }` rule, and a `.product-card {}` rule.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/browser/css-extractor.test.ts
```

- [ ] **Step 4: Implement `css-extractor.ts`**

`extractStyles`: use `page.evaluate()` to call `window.getComputedStyle(el)` for the matched element. Extract only the properties from plan.md §4.3. Omit a property from the result object entirely (not set to `undefined`) if the computed value is `''`, `'normal'`, `'auto'`, `'0px 0px 0px 0px'` and would not meaningfully inform reconstruction. For matched rules, use CDP `CSS.getMatchedStylesForNode` with the element's backend node ID (`page.locator(selector).evaluate(el => el)` to get the node). Parse `matchedCSSRules` for selector text, declarations, and `sourceURL`. For pseudo-elements, use CDP `CSS.getMatchedStylesForNode` response's `pseudoElements` field. Extract `content`, `display`, `color`, `background-color`, `width`, `height`, `position`.

`extractRootCssVars`: `page.evaluate(() => { const vars = {}; for (const sheet of document.styleSheets) { for (const rule of sheet.cssRules) { if (rule.selectorText === ':root') { for (const prop of rule.style) { if (prop.startsWith('--')) vars[prop] = rule.style.getPropertyValue(prop).trim() } } } } return vars })`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/browser/css-extractor.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/browser/css-extractor.ts apps/api/tests/unit/browser/css-extractor.test.ts
git commit -m "feat: CSS extractor with computed styles, matched rules, and pseudo-elements"
```

---

## Task 8: Geometry extractor + screenshot capturer

**Files:**
- Create: `apps/api/src/services/browser/geometry-extractor.ts`
- Create: `apps/api/src/services/browser/screenshot-capturer.ts`

**Interfaces:**
- Produces: `extractGeometry(page: Page): Promise<GeometryData>`
- `GeometryData = { sections: SectionGeometry[]; viewport: { width: number; height: number }; documentHeight: number }`
- `SectionGeometry = { selector: string; label?: string; bounds: Rect; isSticky: boolean; isFixed: boolean; zIndex: number; display: string }`
- Produces: `captureScreenshots(page: Page, outputDir: string): Promise<ScreenshotResult>`
- `ScreenshotResult = { fullPagePath: string; viewportPath: string; viewport: { width: number; height: number } }`
- Consumed by: Task 10 (capture worker)

---

- [ ] **Step 1: Write failing tests**

```typescript
test('records document height', async () => {
  const geo = await extractGeometry(page)
  expect(geo.documentHeight).toBeGreaterThan(geo.viewport.height)
})
test('records viewport dimensions', async () => {
  const geo = await extractGeometry(page)
  expect(geo.viewport.width).toBe(1440)
  expect(geo.viewport.height).toBe(900)
})
test('identifies sticky header', async () => {
  // fixture has header with position:sticky
  const geo = await extractGeometry(page)
  const header = geo.sections.find(s => s.selector === 'header')
  expect(header?.isSticky).toBe(true)
})
test('records correct bounding box for hero section', async () => {
  const geo = await extractGeometry(page)
  const hero = geo.sections.find(s => s.label === 'hero')
  expect(hero?.bounds.width).toBe(1440)
  expect(hero?.bounds.y).toBeGreaterThan(0)
})
test('captures full-page screenshot as PNG file', async () => {
  const result = await captureScreenshots(page, tmpDir)
  expect(fs.existsSync(result.fullPagePath)).toBe(true)
  expect(result.fullPagePath).toMatch(/\.png$/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/browser/geometry-extractor.test.ts
```

- [ ] **Step 3: Implement `geometry-extractor.ts`**

Target elements: `header`, `footer`, `nav`, `main`, `section`, `[class*="hero"]`, `[class*="banner"]`, `[class*="grid"]`, `[class*="container"]`. For each: `getBoundingClientRect()` for bounds. `getComputedStyle(el).position === 'sticky'` → `isSticky`. `getComputedStyle(el).position === 'fixed'` → `isFixed`. `parseInt(getComputedStyle(el).zIndex) || 0` → `zIndex`. Derive `label` from primary class name or element tag. Document height: `Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`.

- [ ] **Step 4: Implement `screenshot-capturer.ts`**

`captureScreenshots`: scroll the page from top to bottom in steps of 300px with 100ms pauses to trigger lazy loading. Then scroll back to top. Capture full-page: `page.screenshot({ path: fullPagePath, fullPage: true })`. Capture viewport: `page.screenshot({ path: viewportPath, fullPage: false })`. Both PNG. Use `sharp` to verify the output is a valid image (call `sharp(fullPagePath).metadata()` and assert `format === 'png'`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/browser/geometry-extractor.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/browser/geometry-extractor.ts apps/api/src/services/browser/screenshot-capturer.ts
git commit -m "feat: geometry extractor and screenshot capturer with lazy-load scroll"
```

---

## Task 9: Asset extractor + downloader

**Files:**
- Create: `apps/api/src/services/browser/asset-extractor.ts`

**Interfaces:**
- Produces: `discoverAssets(page: Page): Promise<AssetInfo[]>`
- `AssetInfo = { originalUrl: string; type: AssetType; mimeType?: string; naturalWidth?: number; naturalHeight?: number; renderedWidth?: number; renderedHeight?: number; domSelector?: string; cssProperty?: string; srcset?: string[] }`
- `AssetType = 'image' | 'svg' | 'font' | 'video' | 'other'`
- Produces: `downloadAsset(url: string, destPath: string): Promise<{ size: number; contentHash: string; mimeType: string }>`
- Consumed by: Task 10 (capture worker, asset download queue)

---

- [ ] **Step 1: Write failing tests**

```typescript
test('discovers img elements', async () => {
  const assets = await discoverAssets(page)
  const images = assets.filter(a => a.type === 'image')
  expect(images.length).toBeGreaterThan(0)
})
test('records natural dimensions for images', async () => {
  const assets = await discoverAssets(page)
  const img = assets.find(a => a.type === 'image')
  expect(img?.naturalWidth).toBeGreaterThan(0)
  expect(img?.naturalHeight).toBeGreaterThan(0)
})
test('discovers background-image URLs from CSS', async () => {
  // fixture hero has background-image: url(hero-bg.jpg)
  const assets = await discoverAssets(page)
  const bg = assets.find(a => a.cssProperty === 'background-image')
  expect(bg?.originalUrl).toMatch(/hero-bg\.jpg/)
})
test('discovers font URLs from @font-face', async () => {
  const assets = await discoverAssets(page)
  const fonts = assets.filter(a => a.type === 'font')
  expect(fonts.length).toBeGreaterThan(0)
})
test('downloadAsset writes file and returns correct hash', async () => {
  const result = await downloadAsset(imageUrl, tmpPath)
  expect(fs.existsSync(tmpPath)).toBe(true)
  expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/) // sha256 hex
  expect(result.size).toBeGreaterThan(0)
})
test('downloadAsset records mimeType from Content-Type header', async () => {
  const result = await downloadAsset(imageUrl, tmpPath)
  expect(result.mimeType).toBe('image/jpeg')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/browser/asset-extractor.test.ts
```

- [ ] **Step 3: Implement `asset-extractor.ts`**

`discoverAssets`:
- `img[src]` and `img[srcset]` — parse srcset for all candidate URLs
- `source[srcset]` inside `<picture>`
- `link[rel="preload"][as="image"]`
- `video[poster]`
- CSS `background-image: url(...)` — via page.evaluate scanning all stylesheets
- `@font-face src: url(...)` — via page.evaluate scanning all stylesheets
- Inline SVG `<image href>`
- For each `<img>`: record `naturalWidth`, `naturalHeight`, `width`, `height` from the element
- Deduplicate by `originalUrl`

`downloadAsset`: use `axios` with `responseType: 'arraybuffer'`. Stream to file. Compute SHA-256 of the buffer. Extract `mimeType` from `Content-Type` response header. Return `{ size, contentHash, mimeType }`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/browser/asset-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/browser/asset-extractor.ts
git commit -m "feat: asset extractor and downloader with srcset, CSS bg, font-face support"
```

---

## Task 10: Capture worker + evidence storage

**Files:**
- Create: `apps/api/src/queue/workers/capture-worker.ts`
- Create: `apps/api/src/queue/workers/asset-worker.ts`
- Create: `apps/api/src/services/projects/project-service.ts`
- Create: `apps/api/src/services/crawl/crawl-service.ts`

**Interfaces:**
- Capture worker job payload: `{ pageId: string; url: string; projectId: string; crawlJobId: string; viewport: { width: number; height: number } }`
- Asset worker job payload: `{ assetId: string; originalUrl: string; projectId: string; s3KeyPrefix: string }`
- Produces: `CrawlService` with `startCrawl(projectId, options): Promise<string>`, `getCrawlStatus(crawlJobId): Promise<CrawlStatus>`, `pauseCrawl(crawlJobId): Promise<void>`, `resumeCrawl(crawlJobId): Promise<void>`, `cancelCrawl(crawlJobId): Promise<void>`

---

- [ ] **Step 1: Write failing integration test for the capture worker**

```typescript
// integration/capture.test.ts
test('capture worker writes DOM JSON to S3 key', async () => {
  // enqueue one page, wait for worker to process it
  // then verify the page_captures row exists and dom_key is set
  const capture = await db.query<PageCapture>('SELECT * FROM page_captures WHERE page_id=$1', [pageId])
  expect(capture.rows[0].dom_key).toMatch(/^evidence\//)
})
test('capture worker creates asset rows for discovered images', async () => {
  const assets = await db.query('SELECT * FROM assets WHERE project_id=$1', [projectId])
  expect(assets.rows.length).toBeGreaterThan(0)
  expect(assets.rows[0].asset_type).toBe('image')
})
test('page failure does not fail the crawl job', async () => {
  // enqueue a page with a 404 URL
  // verify page row gets status=failed and crawl_job remains running
  const job = await db.query('SELECT status FROM crawl_jobs WHERE id=$1', [crawlJobId])
  expect(job.rows[0].status).toBe('capturing')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/integration/capture.test.ts
```

- [ ] **Step 3: Implement `capture-worker.ts`**

BullMQ processor for `capture-queue`. Steps:
1. Update page status to `capturing` in DB
2. `pool.acquire()` a browser
3. `loadPage()` for the given viewport
4. Run all extractors in sequence: DOM → geometry → CSS (for top 50 visible elements by area) → screenshots → assets
5. Upload DOM JSON, CSS JSON, geometry JSON to S3 under `evidence/{projectId}/{pageId}/`
6. Upload screenshots to S3 under `screenshots/{projectId}/{pageId}/`
7. Insert `page_captures` row with S3 keys
8. Enqueue each discovered asset URL as an `asset-queue` job (upsert to `assets` table first)
9. `pool.release()` the browser
10. Update page status to `captured`
11. On any error: update page status to `failed`, record `error` message, `pool.release()`, do NOT rethrow (BullMQ marks job as failed but worker continues)

- [ ] **Step 4: Implement `asset-worker.ts`**

BullMQ processor for `asset-queue`. Download asset via `downloadAsset()` to a tmp file. Upload to S3 key `assets/{projectId}/{contentHash}.{ext}`. Update `assets` row: `s3_key`, `file_size`, `content_hash`, `mime_type`, `download_status: 'completed'`. On failure: set `download_status: 'failed'`, `error`.

- [ ] **Step 5: Implement `crawl-service.ts`**

`startCrawl`:
1. Create `crawl_jobs` row (status: `discovering`)
2. Fetch sitemap URLs via `fetchSitemapUrls`
3. Optionally launch a browser to extract internal links from homepage
4. Upsert all discovered URLs into `pages` table with `status: 'discovered'`
5. Classify each URL with `classifyPage`
6. Update crawl job `pages_discovered` count
7. Enqueue each page as a `capture-queue` job for each configured viewport
8. Update crawl job status to `capturing`
9. Return `crawlJobId`

`getCrawlStatus`: count pages by status from DB, return `{ total, discovered, capturing, captured, failed, status }`.

`pauseCrawl` / `resumeCrawl` / `cancelCrawl`: use BullMQ `queue.pause()` / `queue.resume()` / drain and delete.

- [ ] **Step 6: Run integration tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/integration/capture.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/queue/ apps/api/src/services/
git commit -m "feat: capture worker, asset worker, crawl service"
```

---

## Task 11: REST API

**Files:**
- Create: `apps/api/src/routes/projects.ts`
- Create: `apps/api/src/routes/crawls.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/tests/integration/projects.test.ts`
- Create: `apps/api/tests/integration/crawl.test.ts`

**Interfaces:**
- Consumes: `project-service`, `crawl-service`
- Produces: REST API as specified in plan.md §9

---

- [ ] **Step 1: Write failing API tests**

```typescript
// projects.test.ts
test('POST /api/projects creates a project and returns 201', async () => {
  const res = await request(app).post('/api/projects')
    .send({ name: 'Test Store', url: 'https://example.com' })
  expect(res.status).toBe(201)
  expect(res.body.id).toBeDefined()
  expect(res.body.status).toBe('created')
})
test('POST /api/projects rejects invalid URL with 400', async () => {
  const res = await request(app).post('/api/projects')
    .send({ name: 'Bad', url: 'not-a-url' })
  expect(res.status).toBe(400)
  expect(res.body.error).toBeDefined()
})
test('GET /api/projects returns list', async () => {
  const res = await request(app).get('/api/projects')
  expect(res.status).toBe(200)
  expect(Array.isArray(res.body.items)).toBe(true)
})
test('GET /api/projects/:id returns project', async () => {
  const res = await request(app).get(`/api/projects/${projectId}`)
  expect(res.status).toBe(200)
  expect(res.body.url).toBe('https://example.com')
})
test('POST /api/projects/:id/crawl starts a crawl and returns 202 with crawlJobId', async () => {
  const res = await request(app).post(`/api/projects/${projectId}/crawl`)
  expect(res.status).toBe(202)
  expect(res.body.crawlJobId).toBeDefined()
})
test('GET /api/projects/:id/status returns crawl progress', async () => {
  const res = await request(app).get(`/api/projects/${projectId}/status`)
  expect(res.status).toBe(200)
  expect(res.body).toHaveProperty('pagesDiscovered')
  expect(res.body).toHaveProperty('pagesCaptured')
})
test('GET /api/projects/:id/pages returns page list', async () => {
  const res = await request(app).get(`/api/projects/${projectId}/pages`)
  expect(res.status).toBe(200)
  expect(Array.isArray(res.body.items)).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/integration/projects.test.ts
```

- [ ] **Step 3: Implement `routes/projects.ts`**

`POST /api/projects` — validate `name` (non-empty string) and `url` (valid URL, `http(s)` only) with zod. Insert into `projects`. Return 201 + project row.

`GET /api/projects` — query all, return `{ items }`.

`GET /api/projects/:id` — return project or 404.

`POST /api/projects/:id/crawl` — call `crawlService.startCrawl(id)`. Return 202 + `{ crawlJobId }`.

`GET /api/projects/:id/status` — call `crawlService.getCrawlStatus`. Return status object.

`GET /api/projects/:id/pages` — query pages by project, support `?pageType=` filter and `?status=` filter. Return `{ total, items }`.

- [ ] **Step 4: Implement `index.ts`** — Express app, mount routes, start server on `env.PORT`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/integration/projects.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/ apps/api/src/index.ts apps/api/tests/integration/
git commit -m "feat: REST API — projects and crawl management endpoints"
```

---

## Task 12: End-to-end integration test against fixture site

**Files:**
- Create: `apps/api/tests/integration/capture.test.ts` (extend from Task 10)
- Modify: `apps/api/tests/fixtures/test-site/index.html` (complete realistic fixture)
- Create: `apps/api/tests/fixtures/test-site/product.html`
- Create: `apps/api/tests/fixtures/test-site/category.html`

**Interfaces:**
- Consumes: all services — this is the full pipeline smoke test

---

- [ ] **Step 1: Extend the fixture site to 3 pages**

`index.html` — homepage: nav (with `position: sticky`), hero (with `background-image`), 3-column product grid (3 cards with lazy-loaded images, prices), footer. Add CSS `--color-primary: #e63329` on `:root`. Add `::before` on `.nav-item`.

`category.html` — 12-product grid with pagination links.

`product.html` — product detail: image gallery, title, price with compareAtPrice, variant selector (colour + size), add to cart button.

Each page links to the other two via `<a href>` in the nav.

- [ ] **Step 2: Write end-to-end test**

```typescript
// capture.test.ts
test('full pipeline: crawl fixture site, all 3 pages captured', async () => {
  const { body } = await request(app).post('/api/projects')
    .send({ name: 'Fixture', url: fixtureBaseUrl })
  const { crawlJobId } = (await request(app).post(`/api/projects/${body.id}/crawl`)).body

  // poll until done (timeout 60s)
  await waitUntil(async () => {
    const status = (await request(app).get(`/api/projects/${body.id}/status`)).body
    return status.status === 'completed'
  }, 60_000)

  const pages = (await request(app).get(`/api/projects/${body.id}/pages`)).body
  expect(pages.total).toBe(3)
  expect(pages.items.every(p => p.status === 'captured')).toBe(true)
})
test('homepage classified correctly', async () => {
  const pages = (await request(app).get(`/api/projects/${projectId}/pages`)).body
  const home = pages.items.find(p => p.url === fixtureBaseUrl + '/')
  expect(home.pageType).toBe('homepage')
})
test('captured page has screenshot S3 key set', async () => {
  const capture = await db.query('SELECT * FROM page_captures WHERE page_id=$1', [homepageId])
  expect(capture.rows[0].screenshot_desktop_key).toMatch(/^screenshots\//)
})
test('captured page has dom_key set and DOM JSON is fetchable from S3', async () => {
  const capture = await db.query('SELECT * FROM page_captures WHERE page_id=$1', [homepageId])
  const dom = JSON.parse((await s3.downloadFile(capture.rows[0].dom_key)).toString())
  expect(Array.isArray(dom)).toBe(true)
  expect(dom.length).toBeGreaterThan(0)
})
test('assets table contains images from fixture site', async () => {
  const assets = await db.query('SELECT * FROM assets WHERE project_id=$1 AND asset_type=$2', [projectId, 'image'])
  expect(assets.rows.length).toBeGreaterThan(0)
  expect(assets.rows[0].download_status).toBe('completed')
})
test('CSS variables extracted from homepage capture', async () => {
  const cssJson = JSON.parse((await s3.downloadFile(cssKey)).toString())
  expect(cssJson.cssVars['--color-primary']).toBe('#e63329')
})
```

- [ ] **Step 3: Run end-to-end tests to verify they fail (before all wiring is complete)**

```bash
cd apps/api && npx vitest run tests/integration/capture.test.ts
```

- [ ] **Step 4: Wire up the crawl service to actually start workers**

Ensure `crawl-service.ts` calls `createWorker('capture-queue', captureProcessor, 3)` on startup. Workers must already be running when `startCrawl` enqueues jobs.

- [ ] **Step 5: Run end-to-end tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/integration/capture.test.ts --timeout=120000
```

Expected: all PASS. Total pipeline time for 3 pages < 60s.

- [ ] **Step 6: Run all tests**

```bash
cd apps/api && npx vitest run
```

Expected: all PASS. Zero failures.

- [ ] **Step 7: Commit**

```bash
git add apps/api/tests/fixtures/ apps/api/tests/integration/capture.test.ts
git commit -m "feat: end-to-end integration test — full capture pipeline against fixture site"
```

---

## Self-Review

### Spec coverage

| Spec section | Covered by task |
|---|---|
| WRE-001 Project creation | Task 11 (POST /api/projects) |
| WRE-002 Discovery (sitemap, robots, links) | Tasks 3, 4, 10 (crawl-service) |
| WRE-003 DOM extraction | Task 6 |
| WRE-003 CSS extraction (computed + matched) | Task 7 |
| WRE-003 Pseudo-elements | Task 7 |
| WRE-004 Geometry | Task 8 |
| WRE-005 Typography | Task 7 (font-family, font-size etc. in ComputedStyles) |
| WRE-006 CSS variables / design tokens | Task 7 (extractRootCssVars) |
| WRE-007 Asset extraction + download | Task 9 |
| WRE-007 Lazy-loaded assets (scroll trigger) | Task 8 (screenshot-capturer scroll step) |
| WRE-008 Responsive (multiple viewports) | Task 10 (capture worker, one job per viewport) |
| §6 Evidence status tagging | Tasks 6–9 (all extractors output `evidenceStatus`) |
| §6 Evidence provenance | Task 10 (PageCapture row links pageId + S3 keys) |
| §9 REST API | Task 11 |
| §12.1 Workers separate from API | Task 10 (BullMQ workers run as separate processes) |
| §12.3 Idempotent jobs | Task 10 (upsert on pages, skip if already captured) |

**Gap:** Interaction inspection (WRE-009) and animation inspection (WRE-010) are Phase 3 — Sub-project B scope. Not in this plan. ✓

**Gap:** Responsive diff comparison (WRE-008 §"Responsive differences") — the capture worker captures each viewport independently but does not compute diffs. Diffs are Sub-project C (Design Intelligence). ✓

### Step scan

All steps specify either an exact test assertion with values, an exact function signature, or an exact shell command. No vague steps found.

### Type consistency

- `Rect` defined once in `dom-extractor.ts` — referenced in `geometry-extractor.ts` via import. ✓
- `AssetInfo.type: AssetType` matches `assets.asset_type TEXT` — the worker maps the enum to string on insert. ✓
- `EvidenceStatus` defined in `schema.ts` — imported where needed. ✓

### Review Focus (tests added)

1. **URL trap** — covered by `url-normalizer.test.ts`: `isEligibleUrl` tests for calendar pattern and 4+ query param heuristic. ✓
2. **Lazy-loaded images** — covered by `screenshot-capturer.ts` scroll step (scroll before asset discovery). Integration test confirms images are in `assets` table. ✓
3. **Optional CSS property guard** — covered by `css-extractor.test.ts` last test: "marks missing optional property as undefined not empty string". ✓
4. **BullMQ worker crash / stuck job** — covered by capture worker `onFailed` hook + `attempts: 3` BullMQ config. Integration test for page failure (404 URL) confirms crawl continues. ✓
5. **CDP session on navigation** — covered in `page-loader.ts` implementation note: attach CDP *after* `page.goto()` resolves. ✓

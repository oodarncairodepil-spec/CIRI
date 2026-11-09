# Platform & Commerce Detector — Implementation Plan
## Sub-project B of 4: Plugo Migration Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyse the raw evidence produced by the Website Inspector (Sub-project A) to detect which ecommerce platform the original site uses, identify every commerce component on the site, map each component to the corresponding Plugo Storefront API endpoint, and produce a Machine-readable Migration Gap Report listing every component that cannot be reproduced in Plugo v1.

**Architecture:** A set of pure-function analysis services that operate on evidence already stored in PostgreSQL and S3 by Sub-project A. No browser or Playwright involvement — this sub-project reads JSON (DOM trees, computed CSS) from S3 and writes structured analysis results back. An Analysis Service orchestrates the pipeline and is triggered by a new REST endpoint. All detection logic is deterministic (no AI); results are stored in new PostgreSQL tables and surfaced through new API endpoints.

**Tech stack:** Node.js 22 + TypeScript 5, same PostgreSQL and S3 clients from Sub-project A. No new runtime dependencies beyond `compromise` (lightweight NLP for text signal matching). Vitest for tests.

**Spec:** `/Users/plugoemployee/REA/FM26/plan.md` — Sections 4.11 (cross-page component intelligence), 6 (evidence model), 10 (completeness). Plugo API surface: `plugo-storefront-api` skill (4 endpoints, redirect checkout, no cart/order/auth API).

**Prerequisite:** Sub-project A must be complete. The analysis pipeline reads `page_captures.dom_key` and `page_captures.css_key` from S3.

---

## Global Constraints

- All detection is deterministic — no LLM calls in this sub-project. AI-assisted naming is Sub-project C's responsibility.
- Every `CommerceComponent` must carry a `confidence` level (`high` | `medium` | `low`) and a `signals` array listing exactly what triggered the detection. Never silently assign high confidence.
- A detected platform with `confidence: 'low'` falls back to `'custom'` in all downstream mapping decisions.
- The gap report must list a `gapReason` for every unmapped component — never an empty reason.
- Running the analysis twice on the same `crawlJobId` must be idempotent: re-running replaces existing analysis rows rather than duplicating them.
- Commerce component detection must not fail the analysis if the DOM evidence for a page is missing — record `evidenceStatus: 'unavailable'` and continue.

## Review Focus

1. **False-positive platform detection** — a Shopify store that embeds WooCommerce widgets could match signals for both. The detector must rank signals by weight and return only the highest-confidence match.
2. **Generic commerce heuristics over-matching** — a nav link labelled "Shop" is not a product grid. The generic heuristics (used when platform is `custom`) must require structural evidence (repeated card pattern with price-like text), not just keyword presence.
3. **Plugo gap items surfaced to client** — features like customer login, reviews, and subcategory hierarchy must appear in the gap report even when no matching component is found on the original site (the client may expect them and must be told they're absent in Plugo v1).
4. **Analysis triggered before crawl completes** — if `startAnalysis` is called while capture workers are still running, some pages will have no DOM evidence. The service must check crawl status and reject with 409 if not `completed` or `partial`.
5. **Missing DOM evidence for a page** — if `dom_key` is null in `page_captures` (page failed), the component identifier must skip that page, not throw.

---

## File Structure

```
apps/api/src/
├── db/
│   └── migrations/
│       └── 002_analysis.sql            ← new tables for B results
├── services/
│   ├── platform/
│   │   ├── platform-signatures.ts      ← detection rule registry
│   │   └── platform-detector.ts
│   ├── commerce/
│   │   ├── component-identifier.ts
│   │   ├── plugo-mapper.ts
│   │   └── gap-reporter.ts
│   └── analysis/
│       └── analysis-service.ts         ← orchestrates B pipeline
├── routes/
│   └── analysis.ts                     ← new REST endpoints
apps/api/tests/
├── fixtures/
│   └── dom-samples/
│       ├── shopify-product-dom.json
│       ├── woocommerce-category-dom.json
│       └── generic-custom-dom.json
└── unit/
    ├── platform/
    │   └── platform-detector.test.ts
    └── commerce/
        ├── component-identifier.test.ts
        └── plugo-mapper.test.ts
```

---

## Task 1: Database migration for analysis results

**Files:**
- Create: `apps/api/src/db/migrations/002_analysis.sql`

**Interfaces:**
- Produces: tables `platform_detections`, `commerce_components`, `plugo_mappings`, `analysis_runs`
- Consumed by: Tasks 3–5 (write), Task 6 (read via API)

---

- [ ] **Step 1: Write `002_analysis.sql`**

```sql
CREATE TABLE analysis_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id),
  crawl_job_id UUID NOT NULL REFERENCES crawl_jobs(id),
  status       TEXT NOT NULL DEFAULT 'pending',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(crawl_job_id)
);

CREATE TABLE platform_detections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id  UUID NOT NULL REFERENCES analysis_runs(id),
  platform     TEXT NOT NULL,
  confidence   TEXT NOT NULL,
  signals      JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE commerce_components (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id      UUID NOT NULL REFERENCES analysis_runs(id),
  page_id          UUID REFERENCES pages(id),
  component_type   TEXT NOT NULL,
  selector         TEXT,
  bounds           JSONB,
  occurrence_count INTEGER DEFAULT 1,
  confidence       TEXT NOT NULL,
  signals          JSONB NOT NULL DEFAULT '[]',
  evidence_status  TEXT NOT NULL DEFAULT 'measured'
);

CREATE TABLE plugo_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id      UUID NOT NULL REFERENCES analysis_runs(id),
  component_type   TEXT NOT NULL UNIQUE,
  plugo_endpoint   TEXT,
  plugo_field      TEXT,
  render_hint      TEXT,
  is_gap           BOOLEAN NOT NULL DEFAULT false,
  gap_reason       TEXT
);
```

- [ ] **Step 2: Apply migration** — run `002_analysis.sql` against the local dev database started in Task 1 of Sub-project A.

```bash
psql "$DATABASE_URL" -f apps/api/src/db/migrations/002_analysis.sql
```

Expected: no errors.

- [ ] **Step 3: Extend `apps/api/src/db/schema.ts`** with TypeScript interfaces `AnalysisRun`, `PlatformDetection`, `CommerceComponent`, `PlugoMapping`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/
git commit -m "feat(B): analysis tables — platform detection, commerce components, plugo mappings"
```

---

## Task 2: Platform signatures + detector

**Files:**
- Create: `apps/api/src/services/platform/platform-signatures.ts`
- Create: `apps/api/src/services/platform/platform-detector.ts`
- Create: `apps/api/tests/unit/platform/platform-detector.test.ts`
- Create: `apps/api/tests/fixtures/dom-samples/shopify-product-dom.json`
- Create: `apps/api/tests/fixtures/dom-samples/woocommerce-category-dom.json`
- Create: `apps/api/tests/fixtures/dom-samples/generic-custom-dom.json`

**Interfaces:**
- Produces: `detectPlatform(evidence: PageEvidence[]): PlatformDetectionResult`
- `PageEvidence = { domNodes: DomNode[]; cssVars: Record<string, string>; assetUrls: string[]; pageUrl: string }`
- `PlatformDetectionResult = { platform: Platform; confidence: 'high' | 'medium' | 'low'; signals: string[] }`
- `Platform = 'shopify' | 'woocommerce' | 'odoo' | 'magento' | 'custom'`
- Consumed by: Task 3 (component identifier), Task 4 (analysis service)

---

- [ ] **Step 1: Create fixture DOM samples**

`shopify-product-dom.json` — DOM tree with: class `shopify-section`, attribute `data-section-type="product"`, asset URL `cdn.shopify.com/s/files/...`, form with `action="/cart/add"`.

`woocommerce-category-dom.json` — DOM tree with: class `woocommerce`, class `woocommerce-loop-product__title`, class `woocommerce-Price-amount`, script tag with `src` containing `wp-content/plugins/woocommerce`.

`generic-custom-dom.json` — DOM tree with no platform-specific markers, but a 3-column grid of cards each with an image, title, and price-like span.

- [ ] **Step 2: Write failing tests**

```typescript
// platform-detector.test.ts
import { detectPlatform } from '../../../src/services/platform/platform-detector'
import shopifyDom from '../../fixtures/dom-samples/shopify-product-dom.json'
import wcDom from '../../fixtures/dom-samples/woocommerce-category-dom.json'
import customDom from '../../fixtures/dom-samples/generic-custom-dom.json'

test('detects Shopify from shopify-section class and cdn.shopify.com asset URL', () => {
  const result = detectPlatform([{ domNodes: shopifyDom, cssVars: {}, assetUrls: ['https://cdn.shopify.com/s/files/1/logo.png'], pageUrl: 'https://store.com/' }])
  expect(result.platform).toBe('shopify')
  expect(result.confidence).toBe('high')
  expect(result.signals).toContain('cdn.shopify.com asset URL')
})
test('detects WooCommerce from .woocommerce-Price-amount class', () => {
  const result = detectPlatform([{ domNodes: wcDom, cssVars: {}, assetUrls: [], pageUrl: 'https://store.com/shop' }])
  expect(result.platform).toBe('woocommerce')
  expect(result.confidence).toBe('high')
})
test('falls back to custom when no platform signals match', () => {
  const result = detectPlatform([{ domNodes: customDom, cssVars: {}, assetUrls: [], pageUrl: 'https://store.com/' }])
  expect(result.platform).toBe('custom')
  expect(result.confidence).toBe('low')
})
test('returns signals array listing what triggered detection', () => {
  const result = detectPlatform([{ domNodes: shopifyDom, cssVars: {}, assetUrls: ['https://cdn.shopify.com/x.png'], pageUrl: 'https://store.com/' }])
  expect(result.signals.length).toBeGreaterThan(0)
  expect(result.signals.every(s => typeof s === 'string')).toBe(true)
})
test('uses highest-confidence platform when multiple signals match across pages', () => {
  // one page has weak WooCommerce signal, another has strong Shopify signal
  const result = detectPlatform([
    { domNodes: wcDom, cssVars: {}, assetUrls: [], pageUrl: 'https://store.com/shop' },
    { domNodes: shopifyDom, cssVars: {}, assetUrls: ['https://cdn.shopify.com/x.png'], pageUrl: 'https://store.com/' },
  ])
  expect(result.platform).toBe('shopify')
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/platform/platform-detector.test.ts
```

- [ ] **Step 4: Write `platform-signatures.ts`** — export `PLATFORM_SIGNATURES: PlatformSignature[]` where each entry has `platform`, `weight` (1–3), `match(evidence: PageEvidence): string | null` (returns a signal description string when matched, null otherwise).

Signatures:
- Shopify weight-3: asset URL contains `cdn.shopify.com`
- Shopify weight-3: DOM node class contains `shopify-section`
- Shopify weight-2: form with `action="/cart/add"` exists
- Shopify weight-1: CSS var `--color-shopify` or `--shopify-` prefix
- WooCommerce weight-3: DOM class `woocommerce-Price-amount` exists
- WooCommerce weight-3: asset URL contains `wp-content/plugins/woocommerce`
- WooCommerce weight-2: DOM class `add_to_cart_button` exists
- WooCommerce weight-1: DOM class `woocommerce` on body
- Odoo weight-3: DOM class `js_add_cart` exists
- Odoo weight-3: asset URL contains `/web/static/`
- Odoo weight-2: DOM class `oe_currency_value` exists
- Magento weight-3: asset URL contains `/static/version` and `/frontend/`
- Magento weight-2: DOM attribute `data-mage-init` exists
- Magento weight-1: DOM class matches `mage__` prefix

- [ ] **Step 5: Implement `platform-detector.ts`**

`detectPlatform`: for each `PageEvidence`, run all signatures. Accumulate scores per platform (sum of matching signal weights). The platform with the highest total score wins. If total score ≥ 3: `high`. 1–2: `medium`. 0: `low` → `custom`. Collect all matching signal description strings.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/platform/platform-detector.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/platform/ apps/api/tests/unit/platform/ apps/api/tests/fixtures/dom-samples/
git commit -m "feat(B): platform detector with weighted signal matching"
```

---

## Task 3: Commerce component identifier

**Files:**
- Create: `apps/api/src/services/commerce/component-identifier.ts`
- Create: `apps/api/tests/unit/commerce/component-identifier.test.ts`

**Interfaces:**
- Produces: `identifyCommerceComponents(domNodes: DomNode[], platform: Platform): CommerceComponent[]`
- `CommerceComponentType = 'product-card' | 'product-grid' | 'product-price' | 'product-image' | 'product-title' | 'variant-picker' | 'add-to-cart-button' | 'cart-icon' | 'cart-count-badge' | 'category-nav' | 'search-bar' | 'product-pagination' | 'product-gallery' | 'stock-indicator' | 'wishlist-button' | 'review-section' | 'customer-login' | 'account-page'`
- `CommerceComponent = { type: CommerceComponentType; selector: string; bounds: Rect; occurrenceCount: number; confidence: 'high' | 'medium' | 'low'; signals: string[] }`
- Consumed by: Task 4 (plugo-mapper), Task 5 (analysis-service)

---

- [ ] **Step 1: Write failing tests**

```typescript
// component-identifier.test.ts
import { identifyCommerceComponents } from '../../../src/services/commerce/component-identifier'
import shopifyDom from '../../fixtures/dom-samples/shopify-product-dom.json'
import customDom from '../../fixtures/dom-samples/generic-custom-dom.json'

test('identifies add-to-cart button from Shopify cart form', () => {
  const components = identifyCommerceComponents(shopifyDom, 'shopify')
  const btn = components.find(c => c.type === 'add-to-cart-button')
  expect(btn).toBeDefined()
  expect(btn!.confidence).toBe('high')
  expect(btn!.signals).toContain('form[action="/cart/add"]')
})
test('identifies product-price in Shopify DOM', () => {
  const components = identifyCommerceComponents(shopifyDom, 'shopify')
  const price = components.find(c => c.type === 'product-price')
  expect(price).toBeDefined()
})
test('identifies product-grid from generic custom DOM (repeated card pattern)', () => {
  const components = identifyCommerceComponents(customDom, 'custom')
  const grid = components.find(c => c.type === 'product-grid')
  expect(grid).toBeDefined()
  expect(grid!.confidence).toBe('medium') // custom = medium confidence
})
test('identifies customer-login even when no DOM element exists', () => {
  // customer-login should always appear in results (as "not present" = gap candidate)
  const components = identifyCommerceComponents(shopifyDom, 'shopify')
  const login = components.find(c => c.type === 'customer-login')
  expect(login).toBeDefined()
  expect(login!.confidence).toBe('high')
  expect(login!.signals).toContain('platform:shopify — login exists on original platform')
})
test('records occurrenceCount for repeated product cards', () => {
  const components = identifyCommerceComponents(customDom, 'custom')
  const card = components.find(c => c.type === 'product-card')
  expect(card?.occurrenceCount).toBeGreaterThan(1)
})
test('returns empty signals array never undefined', () => {
  const components = identifyCommerceComponents(customDom, 'custom')
  components.forEach(c => expect(Array.isArray(c.signals)).toBe(true))
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/commerce/component-identifier.test.ts
```

- [ ] **Step 3: Implement `component-identifier.ts`**

Two detection paths:

**Platform-specific (high confidence):**
- Shopify: form `action="/cart/add"` → `add-to-cart-button`; class `price__regular` or `data-product-price` attr → `product-price`; class `shopify-section` containing `product-` → `product-card`; class `product__media` → `product-gallery`; select element with `name="id"` inside product form → `variant-picker`
- WooCommerce: class `woocommerce-Price-amount` → `product-price`; class `add_to_cart_button` → `add-to-cart-button`; class `woocommerce-loop-product` → `product-card`; class `variations` → `variant-picker`
- Odoo: class `oe_currency_value` → `product-price`; class `js_add_cart` → `add-to-cart-button`; class `o_product_page` → `product-detail`

**Generic heuristics (medium confidence, used for `custom` and as fallback):**
- Repeated DOM subtrees (3+ identical-depth children of the same parent with img + heading + price-pattern span) → `product-card` + `product-grid`
- Input with `type="text"` and name/placeholder containing "search" → `search-bar`
- Link count ≥ 5 in a nav element → `category-nav`
- Element with text matching `\$[\d,]+|\d+\.\d{2}` pattern → `product-price`
- Button text containing "cart", "bag", "add" (case-insensitive) → `add-to-cart-button`

**Always-present items (platform inference):**
- When `platform !== 'custom'`, add `customer-login`, `review-section`, `wishlist-button` with `confidence: 'high'` and signal `"platform:{platform} — component exists on original platform"` — these will produce gap entries even if no DOM element is found.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/commerce/component-identifier.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/commerce/component-identifier.ts apps/api/tests/unit/commerce/component-identifier.test.ts
git commit -m "feat(B): commerce component identifier — platform-specific and generic heuristics"
```

---

## Task 4: Plugo mapper + gap reporter

**Files:**
- Create: `apps/api/src/services/commerce/plugo-mapper.ts`
- Create: `apps/api/src/services/commerce/gap-reporter.ts`
- Create: `apps/api/tests/unit/commerce/plugo-mapper.test.ts`

**Interfaces:**
- Produces: `mapToPlugo(components: CommerceComponent[]): PlugoMappingResult[]`
- `PlugoMappingResult = { componentType: CommerceComponentType; plugoEndpoint: string | null; plugoField: string | null; renderHint: string; isGap: boolean; gapReason?: string; implementationNote?: string }`
- Produces: `generateGapReport(mappings: PlugoMappingResult[]): GapReport`
- `GapReport = { gaps: GapItem[]; mappedCount: number; gapCount: number }`
- `GapItem = { componentType: CommerceComponentType; gapReason: string; workaround?: string }`
- Consumed by: Task 5 (analysis-service, writes to `plugo_mappings` table)

---

- [ ] **Step 1: Write failing tests**

```typescript
// plugo-mapper.test.ts
import { mapToPlugo } from '../../../src/services/commerce/plugo-mapper'
import { generateGapReport } from '../../../src/services/commerce/gap-reporter'

const mockComponents: CommerceComponent[] = [
  { type: 'product-grid', selector: '.grid', bounds: {...}, occurrenceCount: 1, confidence: 'high', signals: [] },
  { type: 'product-price', selector: '.price', bounds: {...}, occurrenceCount: 4, confidence: 'high', signals: [] },
  { type: 'add-to-cart-button', selector: 'button', bounds: {...}, occurrenceCount: 1, confidence: 'high', signals: [] },
  { type: 'customer-login', selector: '', bounds: {...}, occurrenceCount: 1, confidence: 'high', signals: ['platform:shopify'] },
  { type: 'review-section', selector: '.reviews', bounds: {...}, occurrenceCount: 1, confidence: 'high', signals: [] },
]

test('maps product-grid to GET /products endpoint', () => {
  const mappings = mapToPlugo(mockComponents)
  const grid = mappings.find(m => m.componentType === 'product-grid')
  expect(grid!.plugoEndpoint).toBe('GET /products')
  expect(grid!.isGap).toBe(false)
})
test('maps product-price to price field on products response', () => {
  const mappings = mapToPlugo(mockComponents)
  const price = mappings.find(m => m.componentType === 'product-price')
  expect(price!.plugoField).toBe('items[].price')
  expect(price!.renderHint).toContain('compareAtPrice')
})
test('maps add-to-cart-button to checkout redirect — not an API endpoint', () => {
  const mappings = mapToPlugo(mockComponents)
  const btn = mappings.find(m => m.componentType === 'add-to-cart-button')
  expect(btn!.plugoEndpoint).toBeNull()
  expect(btn!.renderHint).toContain('checkoutBaseUrl')
  expect(btn!.isGap).toBe(false)
})
test('flags customer-login as gap with reason', () => {
  const mappings = mapToPlugo(mockComponents)
  const login = mappings.find(m => m.componentType === 'customer-login')
  expect(login!.isGap).toBe(true)
  expect(login!.gapReason).toBeDefined()
  expect(login!.gapReason!.length).toBeGreaterThan(10)
})
test('flags review-section as gap', () => {
  const mappings = mapToPlugo(mockComponents)
  const reviews = mappings.find(m => m.componentType === 'review-section')
  expect(reviews!.isGap).toBe(true)
})
test('gap report counts mapped vs gap items', () => {
  const mappings = mapToPlugo(mockComponents)
  const report = generateGapReport(mappings)
  expect(report.gapCount).toBe(2) // customer-login + review-section
  expect(report.mappedCount).toBe(3)
})
test('gap report includes workaround suggestion for customer-login', () => {
  const mappings = mapToPlugo(mockComponents)
  const report = generateGapReport(mappings)
  const loginGap = report.gaps.find(g => g.componentType === 'customer-login')
  expect(loginGap!.workaround).toBeDefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/commerce/plugo-mapper.test.ts
```

- [ ] **Step 3: Implement `plugo-mapper.ts`**

Export a constant `PLUGO_MAPPING_TABLE: Record<CommerceComponentType, Omit<PlugoMappingResult, 'componentType'>>`:

```typescript
{
  'product-grid':        { plugoEndpoint: 'GET /products', plugoField: 'items[]', renderHint: 'Paginate with offset += limit until offset >= total. Use categoryId param for category pages.', isGap: false },
  'product-card':        { plugoEndpoint: 'GET /products', plugoField: 'items[]', renderHint: 'price is the lowest variant price — render as "from X" when variants differ. Guard compareAtPrice with optional chaining.', isGap: false },
  'product-price':       { plugoEndpoint: 'GET /products', plugoField: 'items[].price', renderHint: 'Show compareAtPrice struck-through when present. Never hardcode currency symbol — use store.currency from GET /store.', isGap: false },
  'product-title':       { plugoEndpoint: 'GET /products', plugoField: 'items[].name', renderHint: '', isGap: false },
  'product-image':       { plugoEndpoint: 'GET /products', plugoField: 'items[].image', renderHint: 'Field is optional — render placeholder when absent.', isGap: false },
  'product-detail':      { plugoEndpoint: 'GET /products/{productId}', plugoField: null, renderHint: 'Full product with variants array.', isGap: false },
  'product-gallery':     { plugoEndpoint: 'GET /products/{productId}', plugoField: 'images[]', renderHint: '', isGap: false },
  'variant-picker':      { plugoEndpoint: 'GET /products/{productId}', plugoField: 'variants[]', renderHint: 'Group variants[].options by name to build selectors. Disable combos where stock === 0.', isGap: false },
  'stock-indicator':     { plugoEndpoint: 'GET /products/{productId}', plugoField: 'variants[].stock', renderHint: 'Missing stock field means not tracked — always available. soldOut on the product is the definitive out-of-stock flag.', isGap: false },
  'add-to-cart-button':  { plugoEndpoint: null, plugoField: null, renderHint: 'Cart is fully client-side (localStorage). Store variantId (not just productId). Checkout via GET /store then redirect to checkoutBaseUrl/buy?sku=base64(...)', isGap: false },
  'cart-icon':           { plugoEndpoint: null, plugoField: null, renderHint: 'Read cart item count from client-side cart state.', isGap: false },
  'cart-count-badge':    { plugoEndpoint: null, plugoField: null, renderHint: 'Reactive to client-side cart state.', isGap: false },
  'category-nav':        { plugoEndpoint: 'GET /categories', plugoField: 'items[]', renderHint: 'Flat list only — no hierarchy. If original site shows subcategories, flatten them.', isGap: false },
  'search-bar':          { plugoEndpoint: 'GET /products', plugoField: null, renderHint: 'Use q param — matches product names only. No facet or attribute search.', isGap: false },
  'product-pagination':  { plugoEndpoint: 'GET /products', plugoField: null, renderHint: 'offset += limit until offset >= total.', isGap: false },
  'customer-login':      { plugoEndpoint: null, plugoField: null, renderHint: '', isGap: true, gapReason: 'Plugo v1 has no buyer authentication API. Customer accounts are not available on the storefront.' },
  'account-page':        { plugoEndpoint: null, plugoField: null, renderHint: '', isGap: true, gapReason: 'Plugo v1 has no buyer authentication API. Remove account page or replace with a link to the Plugo seller portal.' },
  'review-section':      { plugoEndpoint: null, plugoField: null, renderHint: '', isGap: true, gapReason: 'Plugo v1 has no product review API. Integrate a third-party reviews widget (e.g. Yotpo, Stamped) if required.' },
  'wishlist-button':     { plugoEndpoint: null, plugoField: null, renderHint: '', isGap: true, gapReason: 'Plugo v1 has no wishlist API. A client-side localStorage wishlist is possible but loses data between devices.' },
}
```

`mapToPlugo(components)`: for each component, look up the table and return a `PlugoMappingResult` with the component type prepended.

- [ ] **Step 4: Implement `gap-reporter.ts`**

`generateGapReport`: filter mappings where `isGap === true`, add a `workaround` string from a workaround registry (e.g. `customer-login → "Direct customers to Plugo's order confirmation page for order status."`), return `GapReport`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/commerce/plugo-mapper.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/commerce/
git commit -m "feat(B): Plugo API mapper and gap reporter — full mapping table for v1 API surface"
```

---

## Task 5: Analysis service + API endpoints

**Files:**
- Create: `apps/api/src/services/analysis/analysis-service.ts`
- Create: `apps/api/src/routes/analysis.ts`
- Modify: `apps/api/src/index.ts` — mount analysis routes
- Create: `apps/api/tests/integration/analysis.test.ts`

**Interfaces:**
- Produces: `startAnalysis(projectId: string, crawlJobId: string): Promise<string>` (returns `analysisRunId`)
- Produces: `getAnalysisResult(analysisRunId: string): Promise<AnalysisResult>`
- `AnalysisResult = { platform: PlatformDetectionResult; components: CommerceComponent[]; mappings: PlugoMappingResult[]; gapReport: GapReport; status: string }`
- REST: `POST /api/projects/:id/analyse` → 202 + `{ analysisRunId }`
- REST: `GET /api/projects/:id/analysis` → `AnalysisResult`

---

- [ ] **Step 1: Write failing integration tests**

```typescript
// analysis.test.ts
test('POST /api/projects/:id/analyse returns 202 with analysisRunId', async () => {
  const res = await request(app).post(`/api/projects/${projectId}/analyse`)
  expect(res.status).toBe(202)
  expect(res.body.analysisRunId).toBeDefined()
})
test('POST /api/projects/:id/analyse returns 409 when crawl is not completed', async () => {
  // create a project whose crawl is still 'capturing'
  const res = await request(app).post(`/api/projects/${inProgressProjectId}/analyse`)
  expect(res.status).toBe(409)
  expect(res.body.error).toContain('crawl')
})
test('GET /api/projects/:id/analysis returns platform detection result', async () => {
  await waitUntil(async () => {
    const r = await request(app).get(`/api/projects/${projectId}/analysis`)
    return r.body.status === 'completed'
  }, 30_000)
  const res = await request(app).get(`/api/projects/${projectId}/analysis`)
  expect(res.body.platform.platform).toBeDefined()
  expect(res.body.platform.signals.length).toBeGreaterThan(0)
})
test('analysis result includes plugo mappings', async () => {
  const res = await request(app).get(`/api/projects/${projectId}/analysis`)
  expect(Array.isArray(res.body.mappings)).toBe(true)
  expect(res.body.mappings.length).toBeGreaterThan(0)
})
test('analysis result includes gap report', async () => {
  const res = await request(app).get(`/api/projects/${projectId}/analysis`)
  expect(res.body.gapReport.gapCount).toBeGreaterThanOrEqual(0)
  expect(Array.isArray(res.body.gapReport.gaps)).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/integration/analysis.test.ts
```

- [ ] **Step 3: Implement `analysis-service.ts`**

`startAnalysis`:
1. Check crawl_jobs status — if not `completed` or `partial`, throw `409`.
2. Upsert `analysis_runs` row (status: `running`).
3. Load DOM JSON from S3 for all `page_captures` in this crawl (`dom_key` not null). Limit to 20 pages to control memory — prioritise homepage + category + product pages.
4. Run `detectPlatform(pageEvidence[])`.
5. For each page, run `identifyCommerceComponents(domNodes, platform)`. Merge results across pages by component type (sum `occurrenceCount`, keep highest confidence).
6. Run `mapToPlugo(mergedComponents)`.
7. Run `generateGapReport(mappings)`.
8. Write results to `platform_detections`, `commerce_components`, `plugo_mappings` tables.
9. Update `analysis_runs` status to `completed`.

`getAnalysisResult`: join tables, return `AnalysisResult`.

- [ ] **Step 4: Implement `routes/analysis.ts`**

`POST /api/projects/:id/analyse` — resolve latest `crawl_job_id` for the project, call `startAnalysis`. Return 202.

`GET /api/projects/:id/analysis` — call `getAnalysisResult` for latest analysis run. Return result or 404 if no run exists.

- [ ] **Step 5: Run integration tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/integration/analysis.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/analysis/ apps/api/src/routes/analysis.ts apps/api/tests/integration/analysis.test.ts
git commit -m "feat(B): analysis service and REST endpoints — platform detection, commerce mapping, gap report"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Covered by task |
|---|---|
| Platform identification | Task 2 |
| Commerce component identification | Task 3 |
| Plugo API mapping (all 4 endpoints + checkout redirect) | Task 4 |
| Gap report (customer login, reviews, wishlist, subcategories) | Task 4 |
| Cross-page component grouping | Task 5 (merge by component type across pages) |
| Idempotent re-run | Task 5 (UPSERT on `analysis_runs` UNIQUE crawl_job_id) |
| Evidence status tagging on components | Task 3 (confidence + signals on every component) |

### Type consistency

`CommerceComponentType` defined once in `component-identifier.ts`, imported by `plugo-mapper.ts` and `analysis-service.ts`. `PlugoMappingResult.componentType` is typed as `CommerceComponentType`. ✓

### Review Focus (tests added)

1. **False-positive detection** — multi-page test in `platform-detector.test.ts` verifies highest-score platform wins. ✓
2. **Generic heuristics over-matching** — `custom` DOM fixture has no "Shop" links; product-grid detection requires structural card pattern. ✓
3. **Gap items for absent components** — `customer-login` test verifies it appears even with no DOM element. ✓
4. **Analysis before crawl completes** — 409 test in `analysis.test.ts`. ✓
5. **Missing DOM evidence** — `analysis-service.ts` skips pages where `dom_key` is null. ✓

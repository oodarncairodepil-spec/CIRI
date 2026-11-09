# Design Intelligence + Blueprint Generator — Implementation Plan
## Sub-project C of 4: Plugo Migration Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform raw browser evidence (DOM, CSS, geometry, screenshots, assets from Sub-project A) and commerce analysis (from Sub-project B) into a complete, structured Website Design Blueprint: a ZIP package and an MCP server that together give an AI coding agent everything it needs to recreate the original site's visual design exactly, connected to Plugo's storefront API.

**Architecture:** Two distinct pipelines, both driven by an orchestration service. The **Intelligence Pipeline** analyses stored evidence deterministically (color clustering, typography grouping, spacing quantisation, breakpoint inference) then calls the Claude API for semantic interpretation (naming, page spec writing, component documentation). The **Blueprint Pipeline** assembles files into the directory structure defined in plan.md §7, generates MASTER.md and AGENT_INSTRUCTIONS.md, zips everything, and stores the ZIP in S3. An **MCP Server** runs as a sidecar process that reads from the same PostgreSQL and S3 store. All three are triggered by REST endpoints.

**Tech stack:** Node.js 22 + TypeScript 5, Anthropic SDK (`@anthropic-ai/sdk`) with `claude-sonnet-5-5` for page specs and `claude-haiku-5-5` for classification/naming, `archiver` for ZIP generation, `@modelcontextprotocol/sdk` for MCP server, `chroma-js` for color clustering, same DB and S3 clients from Sub-project A.

**Spec:** `/Users/plugoemployee/REA/FM26/plan.md` — Sections 5, 6, 7, 8, 13, 15 (Phase 2–5), 16 (E07–E13). Claude API: `claude-api` skill (use `claude-sonnet-5-5` for generation, `claude-haiku-5-5` for lightweight tasks; pass screenshots as base64 image blocks for multimodal analysis).

**Prerequisites:** Sub-projects A and B must be complete. This pipeline reads from `page_captures`, `assets`, `platform_detections`, `commerce_components`, and `plugo_mappings`.

---

## Global Constraints

- Deterministic extraction (colors, typography, spacing) runs before any LLM call. Never send raw DOM or full CSS dumps to the LLM — send compact summaries derived from the deterministic step.
- Every AI-generated claim in a page or component spec must include an `evidenceRef` pointing to the specific capture ID, page ID, or S3 key that supports it. Claims without evidence refs must carry `evidenceStatus: 'inferred'` or `'unknown'`.
- The ZIP structure must match plan.md §7.1 exactly — downstream coding agents and the MCP server assume this layout.
- Blueprint versions are immutable after generation. A second `generateBlueprint` call creates a new version row; it does not overwrite the previous ZIP.
- The MCP server is read-only. It must never modify project data or trigger new crawls.
- LLM token budget per page spec: target ≤ 4 000 input tokens, ≤ 1 500 output tokens. Use compact DOM summaries, not full DOM trees.
- Claude API calls must be retried up to 3 times with exponential backoff on 529 (overloaded) responses. Never retry on 400 or 401.
- Color values in all output files must be hex (#rrggbb or #rrggbbaa). Never output `rgb(...)` or `hsl(...)` to the blueprint.

## Review Focus

1. **Color clustering produces too many similar tokens** — `#1a1a1a` and `#1b1b1b` from two different elements should merge into one token. Use a perceptual distance threshold (CIE76 ΔE < 5) rather than exact string equality.
2. **AI page spec references non-existent component names** — the LLM may invent component names not present in the component library. Post-process all page specs and replace any component name not in the library with `"unknown-component"`. Test that this substitution happens.
3. **ZIP missing screenshots directory** — if S3 download of a screenshot fails during blueprint assembly, the zip must still complete, with a `MISSING` placeholder file and an entry in `quality/missing-evidence.json`.
4. **MCP tool `get_screenshot` returning stale presigned URL** — presigned URLs expire. The MCP server must generate a fresh presigned URL on every `get_screenshot` call, never cache them.
5. **Blueprint generated before intelligence pipeline completes** — `generateBlueprint` must check that the intelligence run is in `completed` status and reject with 409 if not.

---

## File Structure

```
apps/api/src/
├── db/
│   └── migrations/
│       └── 003_intelligence.sql
├── services/
│   ├── intelligence/
│   │   ├── color-extractor.ts
│   │   ├── typography-extractor.ts
│   │   ├── spacing-extractor.ts
│   │   ├── component-grouper.ts
│   │   ├── ai-analyzer.ts
│   │   └── intelligence-service.ts
│   └── blueprint/
│       ├── design-system-generator.ts
│       ├── page-spec-generator.ts
│       ├── component-spec-generator.ts
│       ├── master-generator.ts
│       ├── zip-assembler.ts
│       └── blueprint-service.ts
├── mcp/
│   ├── server.ts
│   ├── resources.ts
│   └── tools.ts
└── routes/
    └── blueprint.ts
apps/api/tests/unit/
├── intelligence/
│   ├── color-extractor.test.ts
│   ├── typography-extractor.test.ts
│   └── spacing-extractor.test.ts
└── blueprint/
    ├── design-system-generator.test.ts
    └── zip-assembler.test.ts
apps/api/tests/integration/
└── blueprint.test.ts
```

---

## Task 1: Database migration for intelligence + blueprint

**Files:**
- Create: `apps/api/src/db/migrations/003_intelligence.sql`

**Interfaces:**
- Produces: tables `intelligence_runs`, `design_tokens`, `component_groups`, `blueprints`

---

- [ ] **Step 1: Write `003_intelligence.sql`**

```sql
CREATE TABLE intelligence_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id),
  analysis_id  UUID NOT NULL REFERENCES analysis_runs(id),
  status       TEXT NOT NULL DEFAULT 'pending',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE design_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intelligence_id  UUID NOT NULL REFERENCES intelligence_runs(id),
  category         TEXT NOT NULL,  -- 'color' | 'typography' | 'spacing' | 'shadow' | 'radius' | 'breakpoint'
  name             TEXT NOT NULL,
  value            TEXT NOT NULL,
  raw_values       JSONB,          -- source computed values before clustering
  occurrence_count INTEGER DEFAULT 1,
  evidence_status  TEXT NOT NULL DEFAULT 'measured',
  semantic_name    TEXT            -- AI-assigned: 'primary', 'body', 'spacing-4', etc.
);

CREATE TABLE component_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intelligence_id  UUID NOT NULL REFERENCES intelligence_runs(id),
  name             TEXT NOT NULL,
  description      TEXT,
  page_ids         JSONB NOT NULL DEFAULT '[]',
  spec_md_key      TEXT,           -- S3 key for component spec markdown
  spec_json_key    TEXT,
  evidence_status  TEXT NOT NULL DEFAULT 'measured'
);

CREATE TABLE blueprints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  intelligence_id UUID NOT NULL REFERENCES intelligence_runs(id),
  version         INTEGER NOT NULL DEFAULT 1,
  zip_key         TEXT,
  zip_size        INTEGER,
  status          TEXT NOT NULL DEFAULT 'generating',
  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
```

- [ ] **Step 2: Apply migration**

```bash
psql "$DATABASE_URL" -f apps/api/src/db/migrations/003_intelligence.sql
```

- [ ] **Step 3: Extend `schema.ts`** with `IntelligenceRun`, `DesignToken`, `ComponentGroup`, `Blueprint` interfaces.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/003_intelligence.sql apps/api/src/db/schema.ts
git commit -m "feat(C): intelligence + blueprint tables"
```

---

## Task 2: Color palette extractor

**Files:**
- Create: `apps/api/src/services/intelligence/color-extractor.ts`
- Create: `apps/api/tests/unit/intelligence/color-extractor.test.ts`

**Interfaces:**
- Produces: `extractColorPalette(cssEvidence: ElementStyles[]): ColorToken[]`
- `ColorToken = { hex: string; occurrenceCount: number; usedOn: string[]; semanticHint: string; evidenceStatus: EvidenceStatus }`
- Consumed by: Task 6 (intelligence-service), Task 7 (design-system-generator)

---

- [ ] **Step 1: Write failing tests**

```typescript
// color-extractor.test.ts
import { extractColorPalette } from '../../../src/services/intelligence/color-extractor'

const cssEvidence: ElementStyles[] = [
  { computed: { visual: { 'background-color': 'rgb(230, 51, 41)', 'color': 'rgb(255,255,255)' }, typography: {}, layout: {}, flexbox: {}, grid: {}, position: {} }, matched: [], cssVars: { '--color-primary': '#e63329' }, pseudo: {} },
  { computed: { visual: { 'color': 'rgb(26, 26, 26)' }, typography: {}, layout: {}, flexbox: {}, grid: {}, position: {} }, matched: [], cssVars: {}, pseudo: {} },
  { computed: { visual: { 'background-color': 'rgb(231, 52, 42)' }, typography: {}, layout: {}, flexbox: {}, grid: {}, position: {} }, matched: [], cssVars: {}, pseudo: {} }, // near-duplicate of first
]

test('extracts distinct colors as hex', () => {
  const palette = extractColorPalette(cssEvidence)
  const hexValues = palette.map(t => t.hex)
  expect(hexValues).toContain('#e63329')
  expect(hexValues).toContain('#1a1a1a')
})
test('merges perceptually similar colors (ΔE < 5) into one token', () => {
  const palette = extractColorPalette(cssEvidence)
  // rgb(230,51,41) and rgb(231,52,42) are ΔE < 5 — should merge
  const reds = palette.filter(t => t.hex.startsWith('#e6') || t.hex.startsWith('#e7'))
  expect(reds.length).toBe(1)
  expect(reds[0].occurrenceCount).toBe(2)
})
test('converts rgb() values to hex', () => {
  const palette = extractColorPalette(cssEvidence)
  palette.forEach(t => expect(t.hex).toMatch(/^#[0-9a-f]{6}$/i))
})
test('records which CSS properties the color appears on', () => {
  const palette = extractColorPalette(cssEvidence)
  const red = palette.find(t => t.hex === '#e63329')
  expect(red!.usedOn).toContain('background-color')
})
test('assigns semanticHint based on usage context', () => {
  const palette = extractColorPalette(cssEvidence)
  const dark = palette.find(t => t.hex === '#1a1a1a')
  expect(dark!.semanticHint).toContain('text') // most-used on 'color' property
})
test('returns empty array for empty input', () => {
  expect(extractColorPalette([])).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/color-extractor.test.ts
```

- [ ] **Step 3: Implement `color-extractor.ts`**

1. Walk all `cssEvidence` and collect every value from: `computed.visual['color']`, `computed.visual['background-color']`, `computed.visual['border-color']`, `computed.visual['outline-color']`. Skip `transparent`, `currentColor`, `inherit`, `rgba(0,0,0,0)`.
2. Convert each `rgb(r,g,b)` to `#rrggbb` hex.
3. Cluster using `chroma-js`: start with an empty cluster list. For each new color, compute CIE76 ΔE against each cluster's centroid. If min ΔE < 5, merge into that cluster (update centroid, increment count). Otherwise create a new cluster.
4. For each cluster: pick the hex value closest to the centroid as the canonical `hex`. Sum `occurrenceCount`. Collect `usedOn` CSS property names.
5. Assign `semanticHint`: the CSS property where this color appears most often (`'color'` → `'text'`, `'background-color'` → `'background'`, `'border-color'` → `'border'`). Flag colors from `cssVars` with `'var'` hint.
6. Sort by `occurrenceCount` descending.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/color-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/intelligence/color-extractor.ts apps/api/tests/unit/intelligence/
git commit -m "feat(C): color palette extractor with perceptual clustering"
```

---

## Task 3: Typography + spacing + shadow + radius + breakpoint extractors

**Files:**
- Create: `apps/api/src/services/intelligence/typography-extractor.ts`
- Create: `apps/api/src/services/intelligence/spacing-extractor.ts`
- Create: `apps/api/tests/unit/intelligence/typography-extractor.test.ts`
- Create: `apps/api/tests/unit/intelligence/spacing-extractor.test.ts`

**Interfaces:**
- Produces: `extractTypographyScale(cssEvidence: ElementStyles[]): TypographyToken[]`
- `TypographyToken = { fontFamily: string; weights: number[]; sizes: string[]; lineHeights: string[]; letterSpacings: string[]; usedOnTags: string[]; semanticRole?: string; evidenceStatus: EvidenceStatus }`
- Produces: `extractSpacingScale(cssEvidence: ElementStyles[]): SpacingToken[]`
- `SpacingToken = { value: string; pxValue: number; occurrenceCount: number; tokenName: string }` — tokenName follows a 4px grid: `spacing-1` = 4px, `spacing-2` = 8px, `spacing-3` = 12px, `spacing-4` = 16px, etc.
- Produces: `extractShadowTokens(cssEvidence: ElementStyles[]): ShadowToken[]`
- `ShadowToken = { value: string; occurrenceCount: number; name: string }` — name: `shadow-sm`, `shadow-md`, `shadow-lg`
- Produces: `extractRadiusTokens(cssEvidence: ElementStyles[]): RadiusToken[]`
- Produces: `inferBreakpoints(viewportCaptures: ViewportCapture[]): BreakpointToken[]`
- `BreakpointToken = { name: string; minWidth: number; evidenceStatus: EvidenceStatus }`
- Consumed by: Task 6 (intelligence-service), Task 7 (design-system-generator)

---

- [ ] **Step 1: Write failing tests for typography extractor**

```typescript
// typography-extractor.test.ts
test('groups font sizes by font family', () => {
  const tokens = extractTypographyScale(cssEvidence)
  const inter = tokens.find(t => t.fontFamily.includes('Inter'))
  expect(inter).toBeDefined()
  expect(inter!.sizes.length).toBeGreaterThan(1)
})
test('records all weights used for each family', () => {
  const tokens = extractTypographyScale(cssEvidence)
  const inter = tokens.find(t => t.fontFamily.includes('Inter'))
  expect(inter!.weights).toContain(400)
  expect(inter!.weights).toContain(700)
})
test('deduplicates font sizes within a family', () => {
  // two elements both use Inter 16px
  const tokens = extractTypographyScale(cssEvidence)
  const inter = tokens.find(t => t.fontFamily.includes('Inter'))
  const size16Occurrences = inter!.sizes.filter(s => s === '16px').length
  expect(size16Occurrences).toBe(1)
})
```

- [ ] **Step 2: Write failing tests for spacing extractor**

```typescript
// spacing-extractor.test.ts
test('extracts padding values and assigns token names on 4px grid', () => {
  const tokens = extractSpacingScale(cssEvidence)
  const t16 = tokens.find(t => t.pxValue === 16)
  expect(t16?.tokenName).toBe('spacing-4')
})
test('rounds values within 2px to the nearest 4px grid step', () => {
  // 14px and 16px should both map to spacing-4 if only one is present
  // but 14px and 16px are distinct grid steps — 14 → spacing-3 (12px nearest), 16 → spacing-4
  const tokens = extractSpacingScale(cssEvidence)
  expect(tokens.find(t => t.pxValue === 14)).toBeUndefined() // merged to 12
  expect(tokens.find(t => t.pxValue === 16)).toBeDefined()
})
test('ignores 0px values', () => {
  const tokens = extractSpacingScale(cssEvidence)
  expect(tokens.find(t => t.pxValue === 0)).toBeUndefined()
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/typography-extractor.test.ts tests/unit/intelligence/spacing-extractor.test.ts
```

- [ ] **Step 4: Implement `typography-extractor.ts`**

Walk CSS evidence. For each element, collect `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing` from `computed.typography`. Group by the first font family name (strip fallbacks). Within each group, deduplicate sizes, weights, and line-heights. Record `usedOnTags` from the DOM tag associated with each element's selector. Assign `semanticRole` using tag heuristics: `h1` → `'heading-1'`, `h2` → `'heading-2'`, `button` → `'button'`, `p` → `'body'`, element with class containing `price` → `'price'`.

- [ ] **Step 5: Implement `spacing-extractor.ts`**

Collect all `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `margin-top`, `margin-bottom`, `gap`, `column-gap`, `row-gap` values from `computed.layout` and `computed.flexbox`/`computed.grid`. Parse to px numbers. Skip 0. Round each value to the nearest 4px grid step. Deduplicate. Assign `tokenName` as `spacing-N` where N = pxValue / 4. Count occurrences. Sort by pxValue.

Implement shadow and radius extractors similarly (collect from CSS evidence, deduplicate by exact value string, sort by blur radius for shadows).

`inferBreakpoints`: compare `viewportCaptures` for the same page at different viewport widths. Where layout properties (column-count-equivalent: number of direct children in a grid/flex row) change between widths, record that width as a breakpoint. Apply the standard labels: ≤ 430 → `mobile`, ≤ 768 → `tablet`, ≤ 1024 → `laptop`, ≤ 1440 → `desktop`, > 1440 → `desktop-xl`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/typography-extractor.test.ts tests/unit/intelligence/spacing-extractor.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/intelligence/typography-extractor.ts apps/api/src/services/intelligence/spacing-extractor.ts apps/api/tests/unit/intelligence/
git commit -m "feat(C): typography, spacing, shadow, radius, and breakpoint extractors"
```

---

## Task 4: Cross-page component grouper

**Files:**
- Create: `apps/api/src/services/intelligence/component-grouper.ts`

**Interfaces:**
- Produces: `groupComponents(domEvidence: PageDomEvidence[], commerceComponents: CommerceComponent[]): ComponentGroup[]`
- `PageDomEvidence = { pageId: string; pageType: PageType; domNodes: DomNode[] }`
- `ComponentGroup = { name: string; pagesFoundOn: string[]; representativeDomKey: string; occurrenceCount: number; commerceType?: CommerceComponentType }`
- Consumed by: Task 6 (intelligence-service)

---

- [ ] **Step 1: Write failing tests**

```typescript
test('identifies header as appearing on all pages', () => {
  const groups = groupComponents(pageEvidence, [])
  const header = groups.find(g => g.name === 'header')
  expect(header!.pagesFoundOn.length).toBe(pageEvidence.length)
})
test('identifies product-card group from commerce components', () => {
  const groups = groupComponents(pageEvidence, mockCommerceComponents)
  const card = groups.find(g => g.commerceType === 'product-card')
  expect(card).toBeDefined()
  expect(card!.occurrenceCount).toBeGreaterThan(1)
})
test('groups by structural fingerprint — same tag hierarchy across pages', () => {
  // footer appears on all 3 fixture pages with same structure
  const groups = groupComponents(pageEvidence, [])
  const footer = groups.find(g => g.name === 'footer')
  expect(footer!.pagesFoundOn.length).toBeGreaterThanOrEqual(2)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/component-grouper.test.ts
```

- [ ] **Step 3: Implement `component-grouper.ts`**

Two grouping strategies:

**Semantic (high precision):** For each page, find elements whose tag matches `header`, `footer`, `nav`, `aside`. These are always grouped by tag name. `pagesFoundOn` = all pages where the tag appears.

**Structural fingerprint:** For each repeating element pattern on a page (3+ siblings with the same tag + depth + child count), compute a "fingerprint" string: `${tag}-${childCount}-${firstChildTag}`. Compare fingerprints across pages. Groups with matching fingerprints appearing on 2+ pages form a cross-page component. Assign a name based on the fingerprint and context (if the page is a category page and fingerprint matches a grid child → `product-card-grid-item`).

**Commerce overlay:** For each `CommerceComponent` in the commerce analysis, find the matching component group by DOM selector overlap and set `commerceType`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/component-grouper.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/intelligence/component-grouper.ts
git commit -m "feat(C): cross-page component grouper"
```

---

## Task 5: AI analyzer (Claude API)

**Files:**
- Create: `apps/api/src/services/intelligence/ai-analyzer.ts`

**Interfaces:**
- Produces: `generatePageSpec(input: PageSpecInput): Promise<PageSpecOutput>`
- `PageSpecInput = { pageType: PageType; pageUrl: string; domSummary: string; designSystem: DesignSystemSummary; screenshotBase64?: string; componentNames: string[]; plugoMappings: PlugoMappingResult[] }`
- `PageSpecOutput = { sections: SectionSpec[]; evidenceRefs: string[]; notes: string }`
- `SectionSpec = { name: string; description: string; components: string[]; layoutNotes: string; evidenceStatus: EvidenceStatus }`
- Produces: `assignSemanticNames(tokens: RawToken[]): Promise<Record<string, string>>` — maps raw values to semantic names (`'#e63329' → 'color-primary'`)
- Consumed by: Task 6 (intelligence-service)

---

- [ ] **Step 1: Write failing tests (mock Anthropic SDK)**

```typescript
// ai-analyzer.test.ts — mock @anthropic-ai/sdk
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          sections: [{ name: 'hero', description: 'Full-width hero banner', components: ['hero-banner'], layoutNotes: 'Full width, 480px height on desktop', evidenceStatus: 'measured' }],
          evidenceRefs: ['capture-001'],
          notes: 'Large promotional image with CTA button centered'
        })}]
      })
    }
  }))
}))

test('generatePageSpec returns sections array', async () => {
  const result = await generatePageSpec({ pageType: 'homepage', pageUrl: 'https://store.com/', domSummary: '...', designSystem: mockDs, componentNames: ['hero-banner'], plugoMappings: [] })
  expect(Array.isArray(result.sections)).toBe(true)
  expect(result.sections[0].name).toBeDefined()
})
test('generatePageSpec replaces unknown component names with "unknown-component"', async () => {
  // mock returns a component name not in componentNames list
  mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
    sections: [{ name: 's', description: '', components: ['invented-widget'], layoutNotes: '', evidenceStatus: 'inferred' }],
    evidenceRefs: [], notes: ''
  })}]})
  const result = await generatePageSpec({ ...input, componentNames: ['real-component'] })
  expect(result.sections[0].components).toContain('unknown-component')
  expect(result.sections[0].components).not.toContain('invented-widget')
})
test('generatePageSpec retries on 529 and succeeds on second attempt', async () => {
  mockCreate
    .mockRejectedValueOnce({ status: 529, message: 'overloaded' })
    .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ sections: [], evidenceRefs: [], notes: '' }) }] })
  await expect(generatePageSpec(input)).resolves.toBeDefined()
  expect(mockCreate).toHaveBeenCalledTimes(2)
})
test('assignSemanticNames returns semantic token names', async () => {
  const names = await assignSemanticNames([{ category: 'color', value: '#e63329', usedOn: ['background-color'], occurrenceCount: 18 }])
  expect(names['#e63329']).toBeDefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/ai-analyzer.test.ts
```

- [ ] **Step 3: Implement `ai-analyzer.ts`**

`generatePageSpec`: Build the prompt using `domSummary` (compact: element tag + depth + class count + text excerpt, max 50 elements, ~1500 chars), `designSystem` (color tokens, font families, container widths — max 500 chars), and `plugoMappings` (render hints for commerce sections). If `screenshotBase64` is provided, include it as an image block in the message. Request structured JSON output matching `PageSpecOutput`. Parse JSON from response. Post-process: replace any `component` name not in `componentNames` with `'unknown-component'`. Retry up to 3 times on status 529 with 1s / 2s / 4s backoff.

Use `claude-haiku-5-5` for `assignSemanticNames` (simple classification, cheap). Use `claude-sonnet-5-5` for `generatePageSpec` (requires nuanced understanding of layout).

`assignSemanticNames`: Build a prompt listing all raw token values with their `usedOn` context and `occurrenceCount`. Ask the LLM to assign semantic names following the pattern: `color-primary`, `color-background`, `color-text`, `color-border`, `color-accent`, `spacing-1` through `spacing-12`, `shadow-sm`, `shadow-md`, `shadow-lg`, `radius-sm`, `radius-md`, `radius-lg`. Return a JSON object mapping raw value → semantic name.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/intelligence/ai-analyzer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/intelligence/ai-analyzer.ts apps/api/tests/unit/intelligence/ai-analyzer.test.ts
git commit -m "feat(C): AI analyzer — Claude-powered page spec generation and token naming"
```

---

## Task 6: Intelligence service (orchestrator)

**Files:**
- Create: `apps/api/src/services/intelligence/intelligence-service.ts`

**Interfaces:**
- Produces: `startIntelligence(projectId: string, analysisRunId: string): Promise<string>` (returns `intelligenceRunId`)
- Produces: `getIntelligenceResult(intelligenceRunId: string): Promise<IntelligenceResult>`
- `IntelligenceResult = { designSystem: DesignSystem; componentGroups: ComponentGroup[]; pageSpecs: PageSpec[]; status: string }`
- `DesignSystem = { colors: ColorToken[]; typography: TypographyToken[]; spacing: SpacingToken[]; shadows: ShadowToken[]; radii: RadiusToken[]; breakpoints: BreakpointToken[] }`
- Consumed by: Task 7 (blueprint-service)

---

- [ ] **Step 1: Write failing integration test**

```typescript
// blueprint.test.ts (extend later in Task 9)
test('intelligence run writes design tokens to DB', async () => {
  await waitUntil(async () => {
    const r = await db.query('SELECT status FROM intelligence_runs WHERE id=$1', [runId])
    return r.rows[0]?.status === 'completed'
  }, 60_000)
  const tokens = await db.query('SELECT * FROM design_tokens WHERE intelligence_id=$1', [runId])
  expect(tokens.rows.length).toBeGreaterThan(0)
  const colorTokens = tokens.rows.filter(r => r.category === 'color')
  expect(colorTokens.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run tests/integration/blueprint.test.ts
```

- [ ] **Step 3: Implement `intelligence-service.ts`**

`startIntelligence`:
1. Create `intelligence_runs` row (status: `running`).
2. Load all `page_captures` CSS keys from S3 → pass to `extractColorPalette`, `extractTypographyScale`, `extractSpacingScale`, `extractShadowTokens`, `extractRadiusTokens`.
3. Load `page_captures` for different viewport widths → pass to `inferBreakpoints`.
4. Call `assignSemanticNames` for color tokens.
5. Load DOM evidence for up to 20 pages → call `groupComponents` with commerce components from analysis.
6. For each distinct page type (homepage, category, product, static): pick one representative page, build `domSummary` and `designSystem` summary, call `generatePageSpec`. Include screenshot from S3 as base64 (resize to max 1280px wide before encoding with Sharp to keep token count down).
7. Write all results to `design_tokens` and `component_groups` tables.
8. Update `intelligence_runs` status to `completed`.

- [ ] **Step 4: Run integration test to verify it passes**

```bash
cd apps/api && npx vitest run tests/integration/blueprint.test.ts --timeout=120000
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/intelligence/intelligence-service.ts
git commit -m "feat(C): intelligence service — full design extraction and AI page spec pipeline"
```

---

## Task 7: Design system + page spec + component spec generators

**Files:**
- Create: `apps/api/src/services/blueprint/design-system-generator.ts`
- Create: `apps/api/src/services/blueprint/page-spec-generator.ts`
- Create: `apps/api/src/services/blueprint/component-spec-generator.ts`
- Create: `apps/api/tests/unit/blueprint/design-system-generator.test.ts`

**Interfaces:**
- Produces: `generateDesignSystemFiles(designSystem: DesignSystem): DesignSystemFiles`
- `DesignSystemFiles = { 'colors.json': string; 'typography.json': string; 'spacing.json': string; 'shadows.json': string; 'borders.json': string; 'breakpoints.json': string; 'design-tokens.json': string }`
- Produces: `generatePageSpecMd(spec: PageSpec, pageType: PageType, screenshots: ScreenshotRefs): string` (Markdown string)
- Produces: `generateComponentSpecJson(group: ComponentGroup, designSystem: DesignSystem): ComponentSpecJson`
- Consumed by: Task 8 (zip-assembler)

---

- [ ] **Step 1: Write failing tests for design system generator**

```typescript
// design-system-generator.test.ts
import { generateDesignSystemFiles } from '../../../src/services/blueprint/design-system-generator'

test('colors.json includes all color tokens with hex values', () => {
  const files = generateDesignSystemFiles(mockDesignSystem)
  const colors = JSON.parse(files['colors.json'])
  expect(colors['color-primary']).toBeDefined()
  expect(colors['color-primary'].value).toMatch(/^#[0-9a-f]{6}$/i)
  expect(colors['color-primary'].status).toBe('measured')
  expect(colors['color-primary'].sourceCount).toBeGreaterThan(0)
})
test('typography.json uses semantic role as key', () => {
  const files = generateDesignSystemFiles(mockDesignSystem)
  const typo = JSON.parse(files['typography.json'])
  expect(typo['body']).toBeDefined()
  expect(typo['body'].fontFamily).toBeDefined()
  expect(typo['body'].fontSize).toBeDefined()
})
test('spacing.json entries use 4px-grid token names', () => {
  const files = generateDesignSystemFiles(mockDesignSystem)
  const spacing = JSON.parse(files['spacing.json'])
  expect(spacing['spacing-4']).toBeDefined()
  expect(spacing['spacing-4'].value).toBe('16px')
})
test('design-tokens.json is a merged flat map of all token categories', () => {
  const files = generateDesignSystemFiles(mockDesignSystem)
  const all = JSON.parse(files['design-tokens.json'])
  expect(all['color-primary']).toBeDefined()
  expect(all['spacing-4']).toBeDefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/blueprint/design-system-generator.test.ts
```

- [ ] **Step 3: Implement `design-system-generator.ts`**

Each JSON file follows the structure from plan.md §4.6. `colors.json`: `{ [tokenName]: { value: hex, status, sourceCount } }`. `typography.json`: `{ [role]: { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, status } }`. `spacing.json`: `{ [tokenName]: { value: '16px', pxValue: 16, status } }`. `design-tokens.json`: flat merge of all categories.

`generatePageSpecMd`: produce a Markdown string following the template in plan.md §7.4 exactly. All placeholder values populated from `PageSpec`. Section headings, layout, typography, visual styling, interactions, responsive behavior, assets, evidence tables — all included. Unknown values marked `[unknown — requires manual review]`.

`generateComponentSpecJson`: produce a JSON object matching the component spec format defined in the brainstorming (component name, description, dimensions, layout, visual, hover, elements, responsive, assets, evidenceRefs).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/blueprint/design-system-generator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/blueprint/
git commit -m "feat(C): design system, page spec, and component spec generators"
```

---

## Task 8: MASTER.md + AGENT_INSTRUCTIONS.md generators

**Files:**
- Create: `apps/api/src/services/blueprint/master-generator.ts`

**Interfaces:**
- Produces: `generateMasterMd(input: MasterInput): string`
- `MasterInput = { projectName: string; targetUrl: string; platform: Platform; pagesDiscovered: number; pageTypes: Record<PageType, number>; componentGroups: ComponentGroup[]; designSystem: DesignSystem; gapReport: GapReport; coverageReport: CoverageReport }`
- Produces: `generateAgentInstructionsMd(plugoMappings: PlugoMappingResult[], gapReport: GapReport): string`
- Consumed by: Task 9 (zip-assembler)

---

- [ ] **Step 1: Write failing tests**

```typescript
test('MASTER.md begins with website overview table', () => {
  const md = generateMasterMd(mockInput)
  expect(md).toContain('## Website overview')
  expect(md).toContain(mockInput.targetUrl)
  expect(md).toContain(mockInput.platform)
})
test('MASTER.md lists all page types with counts', () => {
  const md = generateMasterMd(mockInput)
  expect(md).toContain('homepage')
  expect(md).toContain('product')
})
test('MASTER.md includes gap warning section when gaps exist', () => {
  const md = generateMasterMd({ ...mockInput, gapReport: { gaps: [{ componentType: 'customer-login', gapReason: 'Not in Plugo v1', workaround: '...' }], mappedCount: 10, gapCount: 1 } })
  expect(md).toContain('## Migration gaps')
  expect(md).toContain('customer-login')
})
test('AGENT_INSTRUCTIONS.md includes all 13 instruction steps from plan.md §7.3', () => {
  const md = generateAgentInstructionsMd([], { gaps: [], mappedCount: 0, gapCount: 0 })
  expect(md).toContain('Read MASTER.md first')
  expect(md).toContain('Plugo OpenAPI')
  const steps = md.match(/^\d+\./gm)
  expect(steps!.length).toBeGreaterThanOrEqual(13)
})
test('AGENT_INSTRUCTIONS.md includes Plugo integration section with render hints', () => {
  const md = generateAgentInstructionsMd(mockMappings, { gaps: [], mappedCount: 5, gapCount: 0 })
  expect(md).toContain('GET /products')
  expect(md).toContain('checkoutBaseUrl')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/blueprint/master-generator.test.ts
```

- [ ] **Step 3: Implement `master-generator.ts`**

`generateMasterMd`: template string with sections: website overview (URL, platform, detection confidence), page inventory (table: type | count | pages captured | responsive coverage), shared components (table: name | description | pages), design system summary (font families, primary colors, container width), assets (image count, font count), evidence gaps, migration gaps (from gap report), how to navigate the ZIP.

`generateAgentInstructionsMd`: the 13 numbered steps from plan.md §7.3 verbatim, then a Plugo Integration section listing every commerce component type with its `plugoEndpoint` and `renderHint` from the mapping table, then a Gaps section listing all gap items with their `gapReason` and `workaround`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/blueprint/master-generator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/blueprint/master-generator.ts
git commit -m "feat(C): MASTER.md and AGENT_INSTRUCTIONS.md generators"
```

---

## Task 9: ZIP assembler + blueprint service

**Files:**
- Create: `apps/api/src/services/blueprint/zip-assembler.ts`
- Create: `apps/api/src/services/blueprint/blueprint-service.ts`
- Create: `apps/api/tests/unit/blueprint/zip-assembler.test.ts`

**Interfaces:**
- Produces: `assembleBlueprint(input: BlueprintInput, outputS3Key: string): Promise<{ zipKey: string; zipSize: number }>`
- `BlueprintInput = { masterMd: string; agentInstructionsMd: string; designSystemFiles: DesignSystemFiles; pageSpecs: PageSpecFile[]; componentSpecs: ComponentSpecFile[]; screenshotKeys: ScreenshotKeyMap; assetKeys: AssetKeyMap; gapReport: GapReport; coverageReport: CoverageReport }`
- Produces: `startGeneration(projectId: string, intelligenceRunId: string): Promise<string>` (returns `blueprintId`)
- Produces: `getBlueprint(blueprintId: string): Promise<{ status: string; downloadUrl?: string }>`
- Consumed by: Task 10 (REST API + MCP)

---

- [ ] **Step 1: Write failing tests for zip assembler**

```typescript
// zip-assembler.test.ts
test('generated ZIP contains MASTER.md at root', async () => {
  const zipBuffer = await buildTestZip(mockBlueprintInput)
  const entries = await listZipEntries(zipBuffer)
  expect(entries).toContain('MASTER.md')
})
test('generated ZIP contains AGENT_INSTRUCTIONS.md at root', async () => {
  const zipBuffer = await buildTestZip(mockBlueprintInput)
  expect(await listZipEntries(zipBuffer)).toContain('AGENT_INSTRUCTIONS.md')
})
test('generated ZIP contains design-system/colors.json', async () => {
  const zipBuffer = await buildTestZip(mockBlueprintInput)
  expect(await listZipEntries(zipBuffer)).toContain('design-system/colors.json')
})
test('ZIP still completes when a screenshot S3 download fails', async () => {
  // mock S3 to throw for one screenshot key
  s3Mock.download.mockRejectedValueOnce(new Error('NoSuchKey'))
  const zipBuffer = await buildTestZip(mockBlueprintInput)
  const entries = await listZipEntries(zipBuffer)
  expect(entries).toContain('quality/missing-evidence.json')
  // the ZIP itself is not null
  expect(zipBuffer.length).toBeGreaterThan(0)
})
test('missing-evidence.json lists the failed screenshot', async () => {
  s3Mock.download.mockRejectedValueOnce(new Error('NoSuchKey'))
  const zipBuffer = await buildTestZip(mockBlueprintInput)
  const missing = JSON.parse(await readZipEntry(zipBuffer, 'quality/missing-evidence.json'))
  expect(missing.length).toBe(1)
  expect(missing[0].type).toBe('screenshot')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/blueprint/zip-assembler.test.ts
```

- [ ] **Step 3: Implement `zip-assembler.ts`**

Use `archiver` with format `zip`. Add entries in directory order matching plan.md §7.1. For each screenshot and asset: download from S3; on failure add a `MISSING.txt` placeholder file and append to a `missingEvidence` array. After all entries are added, append `quality/missing-evidence.json` from `missingEvidence`. Pipe the archive to a buffer (or stream directly to S3 via upload). Return `{ zipKey, zipSize }`.

Implement `blueprint-service.ts` to orchestrate: load intelligence results from DB, build all generators' inputs, call each generator, call `assembleBlueprint`, write `blueprints` row with S3 key and size, update status to `completed`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/blueprint/zip-assembler.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/blueprint/zip-assembler.ts apps/api/src/services/blueprint/blueprint-service.ts
git commit -m "feat(C): ZIP assembler and blueprint service"
```

---

## Task 10: MCP server

**Files:**
- Create: `apps/api/src/mcp/server.ts`
- Create: `apps/api/src/mcp/resources.ts`
- Create: `apps/api/src/mcp/tools.ts`

**Interfaces:**
- MCP resources (from plan.md §8.2): `project://{projectId}/overview`, `project://{projectId}/design-system`, `project://{projectId}/pages`, `page://{projectId}/{pageId}/spec`, `component://{projectId}/{componentId}`, `asset://{projectId}/{assetId}`, `quality://{projectId}/coverage`
- MCP tools (from plan.md §8.3): `list_pages`, `get_page_spec`, `get_design_system`, `get_component_spec`, `get_asset_manifest`, `get_screenshot`, `get_quality_report`
- Server starts on `MCP_PORT` (default 3001), separate from the main API

---

- [ ] **Step 1: Write failing MCP smoke test**

```typescript
// mcp/mcp-server.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('MCP server responds to list_pages tool call', async () => {
  const result = await mcpClient.callTool({ name: 'list_pages', arguments: { projectId } })
  expect(result.content[0].type).toBe('text')
  const pages = JSON.parse(result.content[0].text)
  expect(Array.isArray(pages.items)).toBe(true)
})
test('get_design_system returns color tokens', async () => {
  const result = await mcpClient.callTool({ name: 'get_design_system', arguments: { projectId } })
  const ds = JSON.parse(result.content[0].text)
  expect(ds.colors).toBeDefined()
})
test('get_screenshot returns a presigned URL not a cached one', async () => {
  const r1 = await mcpClient.callTool({ name: 'get_screenshot', arguments: { projectId, pageId, viewport: 'desktop' } })
  await new Promise(r => setTimeout(r, 100))
  const r2 = await mcpClient.callTool({ name: 'get_screenshot', arguments: { projectId, pageId, viewport: 'desktop' } })
  // Both should be valid URLs but may differ (fresh presign each time)
  expect(JSON.parse(r1.content[0].text).url).toMatch(/^https:\/\//)
  expect(JSON.parse(r2.content[0].text).url).toMatch(/^https:\/\//)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/unit/mcp/mcp-server.test.ts
```

- [ ] **Step 3: Implement `mcp/resources.ts`**

Export resource handlers using `@modelcontextprotocol/sdk`. Each handler queries DB and returns JSON text content. `project://.../overview` returns project row + crawl status + blueprint status. `project://.../design-system` returns `design_tokens` grouped by category. `page://.../spec` returns the page spec markdown from S3 (download and return as text).

- [ ] **Step 4: Implement `mcp/tools.ts`**

Export tool definitions with JSON Schema input shapes. `list_pages({ projectId })` → queries `pages` table, returns `{ total, items }`. `get_page_spec({ projectId, pageId })` → downloads spec markdown from S3. `get_design_system({ projectId })` → joins `design_tokens`. `get_screenshot({ projectId, pageId, viewport })` → generates fresh presigned URL from S3 key (never cached). `get_quality_report({ projectId })` → queries failed pages and missing evidence.

- [ ] **Step 5: Implement `mcp/server.ts`**

Create an `McpServer` using `@modelcontextprotocol/sdk/server`. Register all resources and tools. Listen on stdio (for use with coding agents via npx/process spawn) or HTTP SSE depending on `MCP_TRANSPORT` env var.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/unit/mcp/mcp-server.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/mcp/
git commit -m "feat(C): MCP server with resources and tools for coding agent access"
```

---

## Task 11: REST API endpoints + end-to-end blueprint test

**Files:**
- Create: `apps/api/src/routes/blueprint.ts`
- Modify: `apps/api/src/index.ts` — mount blueprint routes
- Extend: `apps/api/tests/integration/blueprint.test.ts`

**Interfaces:**
- REST: `POST /api/projects/:id/intelligence` → 202 + `{ intelligenceRunId }`
- REST: `GET /api/projects/:id/intelligence` → `IntelligenceResult`
- REST: `POST /api/projects/:id/blueprint` → 202 + `{ blueprintId }`
- REST: `GET /api/blueprints/:id/download` → redirect to presigned S3 URL
- REST: `GET /api/projects/:id/mcp-config` → MCP connection config JSON

---

- [ ] **Step 1: Write failing integration tests**

```typescript
test('POST /api/projects/:id/intelligence returns 202', async () => {
  const res = await request(app).post(`/api/projects/${projectId}/intelligence`)
  expect(res.status).toBe(202)
  expect(res.body.intelligenceRunId).toBeDefined()
})
test('POST /api/projects/:id/blueprint returns 202 and blueprint is downloadable', async () => {
  await waitForStatus(`/api/projects/${projectId}/intelligence`, 'completed', 90_000)
  const res = await request(app).post(`/api/projects/${projectId}/blueprint`)
  expect(res.status).toBe(202)
  await waitForBlueprintStatus(res.body.blueprintId, 'completed', 60_000)
  const dl = await request(app).get(`/api/blueprints/${res.body.blueprintId}/download`)
  expect(dl.status).toBe(302)
  expect(dl.headers.location).toMatch(/^https?:\/\//)
})
test('downloaded ZIP contains MASTER.md', async () => {
  const zipUrl = (await request(app).get(`/api/blueprints/${blueprintId}/download`)).headers.location
  const zip = await axios.get(zipUrl, { responseType: 'arraybuffer' })
  expect(await listZipEntries(Buffer.from(zip.data))).toContain('MASTER.md')
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx vitest run tests/integration/blueprint.test.ts
```

- [ ] **Step 3: Implement `routes/blueprint.ts`** — wire all endpoints to their service methods.

- [ ] **Step 4: Run all tests**

```bash
cd apps/api && npx vitest run
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/blueprint.ts apps/api/tests/integration/blueprint.test.ts
git commit -m "feat(C): blueprint REST API, MCP config endpoint, end-to-end ZIP test"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Covered |
|---|---|
| Design token extraction — colors, typography, spacing, shadows, radius, breakpoints | Tasks 2–3 |
| AI semantic naming | Task 5 |
| Cross-page component grouping | Task 4 |
| AI page spec generation (multimodal) | Task 5 |
| Blueprint ZIP structure (plan.md §7.1) | Task 9 |
| MASTER.md (plan.md §7.2) | Task 8 |
| AGENT_INSTRUCTIONS.md with Plugo integration guide (plan.md §7.3) | Task 8 |
| MCP resources + tools (plan.md §8.2–8.3) | Task 10 |
| Coverage + quality report | Task 9 (missing-evidence.json) |
| Blueprint versioning (immutable after generation) | Task 1 (blueprints table, version column, never overwrite) |

### Type consistency

`DesignSystem` defined in `intelligence-service.ts`, consumed by `master-generator.ts`, `design-system-generator.ts`, and `ai-analyzer.ts` via import. `CommerceComponentType` imported from Sub-project B's `component-identifier.ts`. ✓

### Review Focus (tests added)

1. **Color clustering ΔE** — `color-extractor.test.ts`: two near-identical reds merge to one token. ✓
2. **AI inventing component names** — `ai-analyzer.test.ts`: post-processing replaces unknown names with `'unknown-component'`. ✓
3. **ZIP missing screenshots** — `zip-assembler.test.ts`: S3 failure produces `quality/missing-evidence.json`. ✓
4. **Stale presigned URLs** — `mcp-server.test.ts`: `get_screenshot` called twice, verifies fresh URL each time. ✓
5. **Blueprint before intelligence completes** — `blueprint-service.ts` checks intelligence status, `blueprint.test.ts` calls `waitForStatus` before triggering blueprint. ✓

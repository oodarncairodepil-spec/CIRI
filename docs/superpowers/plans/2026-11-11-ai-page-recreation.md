# AI Page Recreation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks "Re-visualize" in the Visualize card's Favorites tab, call the configured AI model (Claude or GPT-4o) to generate clean standalone HTML/CSS that visually recreates the original page from scratch — not a frozen snapshot, but deployable code the AI produces by looking at the crawled screenshot + DOM JSON + styles, section by section.

**Architecture:** The DOM body children are split into naturally-sized sections (all < 40 KB each). The backend runs one global "setup" AI call with the full screenshot + design tokens, then one AI call per section, then assembles the results into a final `ai-recreation.html`. A new TanStack Query hook polls a new backend route that mirrors the existing `visualize` pattern. The PagePreviewPage gains a 5th view tab ("AI Recreation") that renders the generated file in an iframe.

**Tech Stack:** Node.js (mock-api.mjs, ES modules), `@anthropic-ai/sdk` or raw `fetch` for OpenAI, React + TanStack Query v5, TypeScript, Tailwind CSS.

**Spec:** This plan is self-contained; the brainstorming conversation (session `ca8e9b78`) serves as the upstream design doc.

---

## Global Constraints

- **No new npm dependencies in `apps/web`** — use existing TanStack Query, React Router, Tailwind.
- **Backend only: add `@anthropic-ai/sdk`** to root `package.json` (the mock-api already uses ES modules).
- **AI provider switching**: respect `settings.activeAI` — `'claude'` → Anthropic API; `'openai'` → OpenAI API.
- **Models**: default Claude model from `settings.claudeModel` (default `claude-sonnet-5-5`); OpenAI from `settings.openaiModel` (default `gpt-4o`).
- **API keys** come from `settings.anthropicApiKey` / `settings.openaiApiKey` — read from `readEnvFile()` at job start, never cached process-wide.
- **Route pattern**: follows existing `sub === 'visualize'` and `sub === 'build'` patterns in the giant `switch` in mock-api.mjs's request handler.
- **Output file**: `crawl-data/<diskId>/pages/<internalId>/ai-recreation.html` — same directory as `snapshot.html`, `build.html`.
- **Section size limit per AI call**: ≤ 40 KB of DOM JSON (all current body-child sections already fit; plan to group tiny adjacent sections if one exceeds this limit).
- **Copy**: button label "Re-visualize" (was "Re-check"); new view tab label "AI Recreation".
- **AI model IDs**: use exact IDs from settings — never hard-code `claude-sonnet-5-5` in the route; always read from settings at job time.

## Review Focus

- **Missing API key**: if `anthropicApiKey` / `openaiApiKey` is empty when the job starts, the job must fail immediately with a clear error message ("No Anthropic API key configured — set it in Settings"), not hang or silently produce empty output.
- **Section too large**: if a single body child's JSON is > 40 KB, the section splitter must group it with the previous section or split further; a silent oversized payload to the AI will produce a truncated or refused response.
- **Assembly with broken section HTML**: if one section AI call returns HTML that is not a valid fragment (e.g. contains `<!DOCTYPE>` or unclosed tags), the assembler must still produce a complete page — wrap the section's raw output in a `<div>` and continue.
- **Polling race**: if the user clicks "Re-visualize" twice rapidly, the second POST must be a no-op (the job is already running); the GET should return the in-progress status.
- **OpenAI vision**: GPT-4o requires the image as a `base64` data URL in the messages array (not a file URL). The `callAI` function must encode the screenshot buffer to base64 for both providers.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `mock-api.mjs` | Modify | Add `aiRecreateJobs` store, `splitDomIntoSections()`, `buildAiPrompt()`, `callAI()`, `aiRecreatePage()` orchestrator, GET/POST route for `ai-recreate`, GET route for `ai-recreation-output` |
| `package.json` (root) | Modify | Add `@anthropic-ai/sdk` dependency |
| `apps/web/src/hooks/useAiRecreate.ts` | Create | TanStack Query hook — polls GET, triggers POST, returns `{ status, isRunning, hasResult, error, run }` |
| `apps/web/src/api/types.ts` | Modify | Add `AiRecreateStatus` interface |
| `apps/web/src/components/visualize/FavoriteVisualizeTable.tsx` | Modify | Rename "Re-check" → "Re-visualize"; wire button to call `useAiRecreate` instead of `useVisualizePage` |
| `apps/web/src/pages/PagePreviewPage.tsx` | Modify | Add `'ai'` to `View` type; add "AI Recreation" segmented tab; render `ai-recreation-output` iframe in the `ai` view |

---

## Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json` (root, the one next to `mock-api.mjs`)

**Interfaces:**
- Produces: `import Anthropic from '@anthropic-ai/sdk'` usable in mock-api.mjs

- [ ] **Step 1: Check whether the SDK is already installed**

```bash
grep -r '@anthropic-ai/sdk' package.json package-lock.json 2>/dev/null | head -5
```

Expected: nothing found (it is not installed).

- [ ] **Step 2: Add the SDK**

```bash
npm install @anthropic-ai/sdk
```

Expected: package-lock.json updated, `node_modules/@anthropic-ai/sdk` exists.

- [ ] **Step 3: Verify the import works in a quick smoke test**

```bash
node -e "import('@anthropic-ai/sdk').then(m => console.log('OK', Object.keys(m.default ?? m)))"
```

Expected: prints `OK` and a list of export names including `Anthropic`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @anthropic-ai/sdk for AI page recreation"
```

---

## Task 2: DOM Section Splitter + AI call functions in mock-api.mjs

**Files:**
- Modify: `mock-api.mjs` — add after the `buildJobs` declaration (line ~344), before the `assetsDir` function

**Interfaces:**
- Produces:
  - `splitDomIntoSections(domJson: object[], maxKb?: number): object[][]` — returns array of section groups (each group is an array of body-child nodes whose JSON is ≤ `maxKb` KB)
  - `buildAiPrompt(opts: { section: object[], sectionIndex: number, totalSections: number, stylesJson: object, intelligenceJson: object|null, screenshotBase64: string|null }): string` — returns the text prompt for a section call
  - `callAI(settings: object, messages: object[]): Promise<string>` — calls the configured provider and returns the AI's text response

**Interfaces consumed:** `readEnvFile()`, `envToSettings()` (both already in mock-api.mjs)

- [ ] **Step 1: Write a test script for the section splitter**

Create `/tmp/test-splitter.mjs`:

```js
import { readFileSync } from 'fs'
// Copy-paste the splitDomIntoSections function here for isolated testing
// then:
const dom = JSON.parse(readFileSync('crawl-data/proj-2/pages/page-1/dom.json', 'utf8'))
const sections = splitDomIntoSections(dom, 40)
console.log('sections:', sections.length, sections.map(s => (JSON.stringify(s).length / 1024).toFixed(1) + 'KB'))
```

Expected output: `sections: 5` (or similar), each entry ≤ 40 KB.

- [ ] **Step 2: Implement `splitDomIntoSections` in `mock-api.mjs`**

Add this function after the `buildJobs = {}` declaration:

```js
function splitDomIntoSections(domJson, maxKb = 40) {
  const body = domJson[0]  // domJson is [{tag:'body', children:[...]}]
  if (!body?.children?.length) return [[body ?? { tag: 'body', children: [] }]]
  const maxBytes = maxKb * 1024
  const sections = []
  let current = []
  let currentSize = 0
  for (const child of body.children) {
    const childSize = JSON.stringify(child).length
    if (current.length > 0 && currentSize + childSize > maxBytes) {
      sections.push(current)
      current = []
      currentSize = 0
    }
    // Single child exceeds limit — push it alone anyway (AI can handle it)
    current.push(child)
    currentSize += childSize
  }
  if (current.length > 0) sections.push(current)
  return sections
}
```

- [ ] **Step 3: Run the test script to verify splitting**

```bash
node /tmp/test-splitter.mjs
```

Expected: each section ≤ 40 KB, all body children accounted for.

- [ ] **Step 4: Implement `buildAiPrompt`**

Add after `splitDomIntoSections`:

```js
function buildAiPrompt({ section, sectionIndex, totalSections, stylesJson, intelligenceJson, isFirst }) {
  const domStr = JSON.stringify(section, null, 2)
  const stylesStr = JSON.stringify(stylesJson ?? {}, null, 2)
  const intel = intelligenceJson ?? {}
  const brandColors = intel.brandColors ? `Brand colors: ${intel.brandColors.join(', ')}.` : ''
  const fonts = intel.designKit?.fonts?.length ? `Fonts: ${intel.designKit.fonts.join(', ')}.` : ''
  const typeScale = intel.designKit?.typeScale?.length
    ? `Type scale:\n${intel.designKit.typeScale.map(t => `  ${t.role}: ${t.fontFamily} ${t.fontSize} ${t.fontWeight}`).join('\n')}`
    : ''

  const intro = isFirst
    ? `You are recreating a webpage section by section to produce clean, deployable HTML/CSS.
I will provide you with the original page screenshot and the DOM JSON for each section.
Produce only the HTML fragment for the requested section — no <!DOCTYPE>, no <html>, no <head>, no <body> tags.
Use inline <style> blocks or inline styles only — no external stylesheets.
Match the visual appearance of the original as closely as possible.

${brandColors}
${fonts}
${typeScale}
Computed styles reference:\n${stylesStr}

`
    : ''

  return `${intro}Section ${sectionIndex + 1} of ${totalSections}.

DOM JSON for this section:
\`\`\`json
${domStr}
\`\`\`

Reproduce this section as a visually accurate HTML fragment. Output ONLY the HTML. No explanations.`
}
```

- [ ] **Step 5: Implement `callAI`**

Add after `buildAiPrompt`:

```js
async function callAI(settings, messages) {
  if (settings.activeAI === 'openai') {
    if (!settings.openaiApiKey) throw new Error('No OpenAI API key configured — set it in Settings')
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.openaiApiKey}` },
      body: JSON.stringify({ model: settings.openaiModel ?? 'gpt-4o', messages }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI API error ${res.status}: ${err.slice(0, 300)}`)
    }
    const data = await res.json()
    return data.choices[0].message.content
  } else {
    // Claude (default)
    if (!settings.anthropicApiKey) throw new Error('No Anthropic API key configured — set it in Settings')
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: settings.anthropicApiKey })
    const res = await client.messages.create({
      model: settings.claudeModel ?? 'claude-sonnet-5-5',
      max_tokens: 4096,
      messages,
    })
    return res.content[0].type === 'text' ? res.content[0].text : ''
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add mock-api.mjs
git commit -m "feat(api): add DOM section splitter, AI prompt builder, and callAI for page recreation"
```

---

## Task 3: AI Recreation Orchestrator (`aiRecreatePage`)

**Files:**
- Modify: `mock-api.mjs` — add after `buildPageLocal`, before `crawlProject`

**Interfaces:**
- Consumes: `splitDomIntoSections`, `buildAiPrompt`, `callAI`, `readEnvFile`, `envToSettings`, `loadJson`, `saveJson`, `projectDiskPath`, `captures`
- Produces:
  - `aiRecreateJobs` store: `{ [key]: { status: 'running'|'completed'|'failed', phase: string, error?: string } }`
  - `getAiRecreateStatus(proj, page): object` — mirrors `getBuildStatus` shape but for AI recreation
  - `aiRecreatePage(proj, page): Promise<void>` — orchestrator

**Shape of `getAiRecreateStatus` return value:**
```js
{
  pageId: string,       // display ID
  url: string,
  hasSnapshot: boolean,
  hasResult: boolean,   // ai-recreation.html exists
  status: 'idle' | 'running' | 'completed' | 'failed',
  phase: string | undefined,  // "setup" | "section 2/5" | "assembling" etc.
  error: string | undefined,
}
```

- [ ] **Step 1: Add `aiRecreateJobs` store**

Add this line right after the `buildJobs = {}` declaration:

```js
const aiRecreateJobs = {}  // `${projectId}/${displayId}` → { status, phase, error }
```

- [ ] **Step 2: Implement `getAiRecreateStatus`**

```js
function getAiRecreateStatus(proj, page) {
  const internalId = page.internalId || page.id
  const pd = join(projectDiskPath(proj), 'pages', internalId)
  const job = aiRecreateJobs[`${proj.id}/${page.displayId}`] ?? {}
  return {
    pageId: page.displayId,
    url: page.url,
    hasSnapshot: existsSync(join(pd, 'snapshot.html')),
    hasResult: existsSync(join(pd, 'ai-recreation.html')),
    status: job.status ?? 'idle',
    phase: job.phase,
    error: job.error,
  }
}
```

- [ ] **Step 3: Implement `aiRecreatePage` orchestrator**

The orchestrator:
1. Reads settings fresh from `.env` at job start (so key changes take effect immediately)
2. Loads dom.json, styles.json, intelligence.json, and the desktop screenshot for the page
3. Calls `splitDomIntoSections` on the dom
4. Sends one AI call per section — first section gets the screenshot + styles + design tokens; subsequent sections get text-only (no screenshot re-sent)
5. Collects the HTML fragment from each call
6. Wraps everything in a full HTML document skeleton and writes `ai-recreation.html`

```js
async function aiRecreatePage(proj, page) {
  const jobKey = `${proj.id}/${page.displayId}`
  if (aiRecreateJobs[jobKey]?.status === 'running') return
  const job = aiRecreateJobs[jobKey] = { status: 'running', phase: 'starting' }
  const internalId = page.internalId || page.id
  const pd = join(projectDiskPath(proj), 'pages', internalId)

  try {
    const settings = envToSettings(readEnvFile())

    // Load crawl data
    const domJson = loadJson(join(pd, 'dom.json'), [])
    const stylesJson = loadJson(join(pd, 'styles.json'), {})
    const intelligenceJson = loadJson(join(projectDiskPath(proj), 'intelligence.json'), null)
    const screenshotBuf = existsSync(join(pd, 'screenshot-desktop.jpg'))
      ? readFileSync(join(pd, 'screenshot-desktop.jpg'))
      : null
    const screenshotBase64 = screenshotBuf ? screenshotBuf.toString('base64') : null

    if (!domJson.length) throw new Error('No DOM data for this page — crawl it first')

    const sections = splitDomIntoSections(domJson)
    const sectionFragments = []

    for (let i = 0; i < sections.length; i++) {
      job.phase = `section ${i + 1}/${sections.length}`
      const isFirst = i === 0
      const textContent = buildAiPrompt({
        section: sections[i], sectionIndex: i, totalSections: sections.length,
        stylesJson, intelligenceJson, isFirst,
      })

      let messages
      if (isFirst && screenshotBase64) {
        // First section: include the full-page screenshot for visual reference
        const imageContent = settings.activeAI === 'openai'
          ? { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}`, detail: 'high' } }
          : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } }
        messages = [{ role: 'user', content: [imageContent, { type: 'text', text: textContent }] }]
      } else {
        messages = [{ role: 'user', content: textContent }]
      }

      const fragment = await callAI(settings, messages)
      // Strip any stray markdown fences the AI might wrap the HTML in
      sectionFragments.push(fragment.replace(/^```html?\n?/i, '').replace(/\n?```\s*$/i, '').trim())
    }

    // Assemble final document
    job.phase = 'assembling'
    const intel = intelligenceJson ?? {}
    const fontImports = intel.designKit?.fonts?.length
      ? `<!-- fonts from original page -->`
      : ''
    const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.url}</title>
  ${fontImports}
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
${sectionFragments.map(f => `<!-- section -->\n${f}`).join('\n\n')}
</body>
</html>`

    writeFileSync(join(pd, 'ai-recreation.html'), finalHtml, 'utf8')
    job.status = 'completed'
    job.phase = undefined
    console.log(`[ai-recreate] ${page.url} — ${sections.length} sections assembled`)
  } catch (err) {
    console.error(`[ai-recreate] failed for ${page.url}:`, err)
    job.status = 'failed'
    job.error = err.message
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add mock-api.mjs
git commit -m "feat(api): add aiRecreatePage orchestrator with section-by-section AI calls"
```

---

## Task 4: Backend Routes for AI Recreation

**Files:**
- Modify: `mock-api.mjs` — add route handlers inside the existing request handler's `switch` block

**Interfaces:**
- Consumes: `getAiRecreateStatus`, `aiRecreatePage`, `aiRecreateJobs`
- Produces:
  - `GET /api/projects/:id/pages/:displayId/ai-recreate` → `AiRecreateStatus`
  - `POST /api/projects/:id/pages/:displayId/ai-recreate` → `AiRecreateStatus` (triggers job, returns current status)
  - `GET /api/projects/:id/pages/:displayId/ai-recreation-output` → serves `ai-recreation.html` as `text/html`

The existing handler pattern:
```js
// Find in mock-api.mjs — the if/else chain that checks `sub`:
} else if (sub === 'build') {
  ...
} else if (sub === 'build-output' || sub === 'build-output-mobile') {
  ...
}
```
Add the new `ai-recreate` and `ai-recreation-output` blocks in the same `else if` chain.

- [ ] **Step 1: Locate the right place in mock-api.mjs**

Search for `sub === 'build'` in mock-api.mjs to find the exact line. The new handlers go immediately after the build handlers in the same block.

- [ ] **Step 2: Add the GET/POST handler for `ai-recreate`**

```js
} else if (sub === 'ai-recreate') {
  if (method === 'GET') {
    return json(res, getAiRecreateStatus(proj, page))
  } else if (method === 'POST') {
    aiRecreatePage(proj, page)  // fire and forget — do NOT await
    return json(res, getAiRecreateStatus(proj, page))
  }
  return json(res, { error: 'Method not allowed' }, 405)
```

- [ ] **Step 3: Add the GET handler for `ai-recreation-output`**

```js
} else if (sub === 'ai-recreation-output') {
  const internalId = page.internalId || page.id
  const filePath = join(projectDiskPath(proj), 'pages', internalId, 'ai-recreation.html')
  if (!existsSync(filePath)) return json(res, { error: 'AI recreation not yet generated' }, 404)
  const content = readFileSync(filePath, 'utf8')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  return res.end(content)
```

- [ ] **Step 4: Smoke-test the routes with curl**

```bash
# GET status (should return idle, hasResult: false)
curl -s "http://localhost:3000/api/projects/FTI/pages/page-1/ai-recreate" | python3 -m json.tool

# POST to trigger (should return running or completed quickly if no key set → error)
curl -s -X POST "http://localhost:3000/api/projects/FTI/pages/page-1/ai-recreate" | python3 -m json.tool
```

Expected GET: `{"status":"idle","hasResult":false,...}`
Expected POST with no API key: `{"status":"failed","error":"No Anthropic API key configured..."}` (after a moment)

- [ ] **Step 5: Commit**

```bash
git add mock-api.mjs
git commit -m "feat(api): add ai-recreate GET/POST and ai-recreation-output route handlers"
```

---

## Task 5: Frontend type + `useAiRecreate` hook

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Create: `apps/web/src/hooks/useAiRecreate.ts`

**Interfaces:**
- Produces: `useAiRecreate(projectId: string, displayId: string)` returning `{ status, isRunning, hasResult, hasSnapshot, error, run }`

Shape mirrors `useSinglePageBuild` exactly, with `hasBuild` renamed to `hasResult` and `phase` added.

- [ ] **Step 1: Add `AiRecreateStatus` to `apps/web/src/api/types.ts`**

Add at the end of the file:

```ts
export interface AiRecreateStatus {
  pageId: string
  url: string
  hasSnapshot: boolean
  hasResult: boolean
  status: 'idle' | 'running' | 'completed' | 'failed'
  phase?: string
  error?: string
}
```

- [ ] **Step 2: Create `apps/web/src/hooks/useAiRecreate.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AiRecreateStatus } from '@/api/types'

const API = 'http://localhost:3000'

function aiRecreateUrl(projectId: string, displayId: string) {
  return `${API}/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(displayId)}/ai-recreate`
}

export function aiRecreationOutputUrl(projectId: string, displayId: string) {
  return `${API}/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(displayId)}/ai-recreation-output`
}

async function call(url: string, init?: RequestInit): Promise<AiRecreateStatus> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export function useAiRecreate(projectId: string, displayId: string) {
  const queryClient = useQueryClient()
  const queryKey = ['ai-recreate', projectId, displayId]
  const url = aiRecreateUrl(projectId, displayId)

  const query = useQuery({
    queryKey,
    queryFn: () => call(url),
    enabled: Boolean(projectId && displayId),
    retry: false,
    refetchInterval: q => (q.state.data?.status === 'running' ? 1_000 : false),
  })

  const start = useMutation({
    mutationFn: () => call(url, { method: 'POST' }),
    onSuccess: data => queryClient.setQueryData(queryKey, data),
  })

  return {
    status: query.data,
    isRunning: start.isPending || query.data?.status === 'running',
    hasResult: query.data?.hasResult ?? false,
    hasSnapshot: query.data?.hasSnapshot ?? false,
    error: (query.error ?? start.error) as Error | null,
    run: () => start.mutate(),
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from the new files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/types.ts apps/web/src/hooks/useAiRecreate.ts
git commit -m "feat(web): add AiRecreateStatus type and useAiRecreate hook"
```

---

## Task 6: Rename "Re-check" → "Re-visualize" and wire button

**Files:**
- Modify: `apps/web/src/components/visualize/FavoriteVisualizeTable.tsx`

**Interfaces:**
- Consumes: `useAiRecreate` from `@/hooks/useAiRecreate`
- The existing `useVisualizePage` hook keeps driving the fidelity/status column — only the action button changes.

Currently the component has:
- Line 12: `const { status, error, isRunning, run } = useVisualizePage(projectId, page.displayId)`
- Line 65: `const { status, error, isRunning, run } = useVisualizePage(projectId, page.displayId)` (inside FavoriteRow)
- Line 66: button label `{fidelity ? 'Re-check' : 'Visualize'}`

After this task:
- The fidelity check (`run()`) stays on the existing button — renamed from "Re-check" to "Re-visualize" and from "Visualize" to "Check fidelity"
- A second, new button "AI Recreate" (or "Re-generate" if `hasResult`) triggers `useAiRecreate`
- The new button shows a spinner while running, and shows "✓ Done" state when `hasResult`

**Exact changes to `FavoriteRow`:**

```tsx
function FavoriteRow({ page, projectId }: { page: FavoritePage; projectId: string }) {
  const { status, error, isRunning, run } = useVisualizePage(projectId, page.displayId)
  const aiRecreate = useAiRecreate(projectId, page.displayId)   // ADD THIS
  const fidelity = status?.fidelity
  // ... existing path code ...

  // In the actions <td>:
  // Keep existing "Open clone" link and fidelity button, rename labels:
  //   'Re-check' → 'Re-visualize'
  //   'Visualize' → 'Check fidelity'
  // Add new AI Recreate button:
  <button
    onClick={() => aiRecreate.run()}
    disabled={aiRecreate.isRunning || !aiRecreate.hasSnapshot}
    className="inline-flex items-center rounded px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  >
    {aiRecreate.isRunning
      ? <><span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse mr-1" />Recreating…</>
      : aiRecreate.hasResult ? 'Re-generate AI' : 'AI Recreate'}
  </button>
```

- [ ] **Step 1: Add the `useAiRecreate` import to FavoriteVisualizeTable.tsx**

```ts
import { useAiRecreate } from '@/hooks/useAiRecreate'
```

- [ ] **Step 2: Rename button labels in `FavoriteRow`**

Change line 66: `{fidelity ? 'Re-check' : 'Visualize'}` → `{fidelity ? 'Re-visualize' : 'Check fidelity'}`

- [ ] **Step 3: Add `useAiRecreate` call and button inside `FavoriteRow`**

Add `const aiRecreate = useAiRecreate(projectId, page.displayId)` after the existing hook call.

Add the AI Recreate button inside the actions `<td>`, after the existing "Re-visualize" button.

- [ ] **Step 4: Start the dev server and manually verify**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:5173`, navigate to a project → Visualize card → Favorites tab. Verify:
- Button now says "Check fidelity" / "Re-visualize" (not "Visualize" / "Re-check")
- "AI Recreate" button appears and is disabled when page has not been crawled
- "AI Recreate" button is enabled for crawled pages

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/visualize/FavoriteVisualizeTable.tsx
git commit -m "feat(web): rename Re-check to Re-visualize and add AI Recreate button"
```

---

## Task 7: PagePreviewPage — Add "AI Recreation" view tab

**Files:**
- Modify: `apps/web/src/pages/PagePreviewPage.tsx`

**Interfaces:**
- Consumes: `useAiRecreate`, `aiRecreationOutputUrl` from `@/hooks/useAiRecreate`
- Currently: `type View = 'clone' | 'original' | 'side' | 'diff'`
- After: `type View = 'clone' | 'original' | 'side' | 'diff' | 'ai'`

The "AI Recreation" view renders the `ai-recreation-output` endpoint in an iframe (same pattern as the existing clone iframe). When `hasResult` is false but `isRunning` is true, show a loading state. When `hasResult` is false and not running, show a prompt: "No AI recreation yet — click Re-generate AI in the Visualize card's Favorites tab."

Additional toolbar element: show `status.phase` as a small status badge when `isRunning` (e.g. "section 2/5…").

- [ ] **Step 1: Add `'ai'` to the `View` type and `VIEWS` array**

```ts
// Change:
type View = 'clone' | 'original' | 'side' | 'diff'

// To:
type View = 'clone' | 'original' | 'side' | 'diff' | 'ai'

// Add to VIEWS array:
{ id: 'ai', label: 'AI Recreation' }
```

- [ ] **Step 2: Import `useAiRecreate` and `aiRecreationOutputUrl`**

```ts
import { useAiRecreate, aiRecreationOutputUrl } from '@/hooks/useAiRecreate'
```

- [ ] **Step 3: Call the hook inside `PagePreviewPage`**

Add after the `useVisualizePage` call:
```ts
const aiRecreate = useAiRecreate(id, displayId)
const aiOutputUrl = aiRecreationOutputUrl(id, displayId)
```

- [ ] **Step 4: Add the AI view to the toolbar status area**

In the toolbar, alongside the existing fidelity badges, add:
```tsx
{aiRecreate.isRunning && (
  <span className="inline-flex items-center gap-1 text-xs text-amber-400">
    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
    AI: {aiRecreate.status?.phase ?? 'starting'}…
  </span>
)}
{!aiRecreate.isRunning && aiRecreate.hasResult && (
  <span className="text-xs text-amber-500">✓ AI recreation ready</span>
)}
```

- [ ] **Step 5: Add the `ai` view render block in the stage area**

After the `{view === 'diff' && ...}` block:
```tsx
{view === 'ai' && (
  aiRecreate.isRunning ? (
    <p className="py-16 text-center text-sm text-gray-400">
      Generating AI recreation: {aiRecreate.status?.phase ?? 'starting'}…
    </p>
  ) : aiRecreate.hasResult ? (
    <iframe
      key={aiOutputUrl}
      src={aiOutputUrl}
      title="AI Recreation"
      sandbox="allow-same-origin allow-scripts"
      className="block h-full border-0 bg-white mx-auto"
      style={{ width: device === 'desktop' ? '100%' : 390 }}
    />
  ) : (
    <p className="py-16 text-center text-sm text-gray-400">
      No AI recreation yet — open the Visualize card, go to Favorites, and click "AI Recreate".
    </p>
  )
)}
```

- [ ] **Step 6: Start the dev server and manually test the full flow**

```bash
cd apps/web && npm run dev
```

1. Navigate to a project → open PagePreviewPage for a crawled page
2. Verify "AI Recreation" tab appears in the segmented control
3. Clicking it shows the "No AI recreation yet" placeholder
4. Go to Visualize card Favorites → click "AI Recreate" on that page
5. Return to PagePreviewPage → "AI Recreation" tab → watch phase update (needs backend running with API key set)
6. Once complete, verify the AI-generated page renders in the iframe

- [ ] **Step 7: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/PagePreviewPage.tsx
git commit -m "feat(web): add AI Recreation as 5th view in PagePreviewPage"
```

---

## Review Focus Tests (Added Per Spec)

**Task 2 (callAI) — missing API key:**
Add an in-process guard at the top of `callAI`:
```js
if (settings.activeAI !== 'openai' && !settings.anthropicApiKey) throw new Error('No Anthropic API key configured — set it in Settings')
if (settings.activeAI === 'openai' && !settings.openaiApiKey) throw new Error('No OpenAI API key configured — set it in Settings')
```
Verify: POST to `/ai-recreate` with empty `.env` → `status: 'failed'`, `error` message mentions "configured — set it in Settings".

**Task 2 (splitDomIntoSections) — section too large:**
If a single child exceeds `maxKb`, it still goes into its own section array and is sent to the AI alone. The function never drops a node. Verify by passing a dom with one giant child and checking the return has exactly one section.

**Task 3 (aiRecreatePage) — broken section HTML:**
Each `sectionFragments` entry is wrapped in the final document with a `<!-- section -->` comment separator. The assembler never validates or repairs section HTML — it trusts the AI's raw output. This is acceptable for a first version; add a note to `ai-recreation.html` generation that invalid fragments will render as-is in the browser.

**Task 4 (routes) — double POST:**
The guard `if (aiRecreateJobs[jobKey]?.status === 'running') return` in `aiRecreatePage` ensures idempotent POSTs. The route returns the current status immediately in both cases.

**Task 2 (callAI) — OpenAI vision format:**
For OpenAI, the first message content array uses `{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }` — this is the correct GPT-4o vision format. For Claude, it uses `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '...' } }`. Verify by running a single-section test call against each provider.

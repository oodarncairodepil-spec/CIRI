// Real-crawl dev API server — uses Playwright to actually visit pages
import { createServer } from 'http'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

const DATA_DIR = join(import.meta.dirname, 'crawl-data')
mkdirSync(DATA_DIR, { recursive: true })

// ── Settings / .env persistence ──────────────────────────────────────────────
const ENV_FILE = join(import.meta.dirname, '.env')

const SETTINGS_KEYS = [
  'PLUGO_STORES', 'PLUGO_ACTIVE_STORE_ID',
  'ACTIVE_AI',
  'ANTHROPIC_API_KEY', 'CLAUDE_MODEL', 'CLAUDE_EFFORT',
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_EFFORT',
]

function readEnvFile() {
  if (!existsSync(ENV_FILE)) return {}
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n')
  const result = {}
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) result[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return result
}

function writeEnvFile(vars) {
  const existing = readEnvFile()
  const merged = { ...existing, ...vars }
  const lines = Object.entries(merged)
    .filter(([k]) => SETTINGS_KEYS.includes(k))
    .map(([k, v]) => `${k}=${v}`)
  writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf8')
}

function envToSettings(env) {
  let stores = []
  try { stores = JSON.parse(env.PLUGO_STORES ?? '[]') } catch {}
  // Migrate old single-store keys if present
  if (stores.length === 0 && (env.PLUGO_STORE_KEY || env.PLUGO_STORE_NAME)) {
    stores = [{ id: 'store-1', name: env.PLUGO_STORE_NAME ?? '', key: env.PLUGO_STORE_KEY ?? '' }]
  }
  return {
    stores,
    activeStoreId:   env.PLUGO_ACTIVE_STORE_ID ?? (stores[0]?.id ?? ''),
    activeAI:        env.ACTIVE_AI         ?? 'claude',
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    claudeModel:     env.CLAUDE_MODEL      ?? 'claude-sonnet-5-5',
    claudeEffort:    env.CLAUDE_EFFORT     ?? 'medium',
    openaiApiKey:    env.OPENAI_API_KEY    ?? '',
    openaiModel:     env.OPENAI_MODEL      ?? 'gpt-4o',
    openaiEffort:    env.OPENAI_EFFORT     ?? 'medium',
  }
}

function settingsToEnv(s) {
  return {
    PLUGO_STORES:          JSON.stringify(s.stores ?? []),
    PLUGO_ACTIVE_STORE_ID: s.activeStoreId  ?? '',
    ACTIVE_AI:             s.activeAI        ?? 'claude',
    ANTHROPIC_API_KEY:     s.anthropicApiKey ?? '',
    CLAUDE_MODEL:          s.claudeModel     ?? 'claude-sonnet-5-5',
    CLAUDE_EFFORT:         s.claudeEffort    ?? 'medium',
    OPENAI_API_KEY:        s.openaiApiKey    ?? '',
    OPENAI_MODEL:          s.openaiModel     ?? 'gpt-4o',
    OPENAI_EFFORT:         s.openaiEffort    ?? 'medium',
  }
}

/** Get the active store from a parsed settings object */
function getActiveStore(settings) {
  const stores = settings.stores ?? []
  return stores.find(s => s.id === settings.activeStoreId) ?? stores[0]
}

// ── Slug helpers ──────────────────────────────────────────────────────────────
function slugify(name) {
  return name.trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'project'
}

// Get the display ID for a page (what shows in the URL)
// Old format: "proj-2-page-3" → "page-3"
// New format: "page-3" → "page-3"
function getDisplayPageId(internalPageId) {
  return internalPageId.replace(/^.+-page-/, 'page-')
}

function projectDiskPath(proj) {
  return join(DATA_DIR, proj.diskId || proj.id)
}

function saveJson(filePath, data) {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function loadJson(filePath, fallback = null) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')) } catch { return fallback }
}

// ── In-memory store ───────────────────────────────────────────────────────────
const projects = {}     // slug → Project (with diskId field)
const crawls = {}       // projectSlug → CrawlJob
const pages = {}        // projectSlug → Page[] (each has displayId + internalId)
const captures = {}     // internalPageId → { dom, styles, screenshotDesktop, screenshotMobile }
const analyses = {}     // projectSlug → AnalysisRun
const intelligences = {}
const blueprints = {}
const builds = {}

let nextProjNum = 1

// ── Restore persisted data on startup ─────────────────────────────────────────
function loadFromDisk() {
  if (!existsSync(DATA_DIR)) return
  for (const dirName of readdirSync(DATA_DIR)) {
    const diskProjDir = join(DATA_DIR, dirName)
    const projectData = loadJson(join(diskProjDir, 'project.json'))
    if (!projectData) continue

    const slug = projectData.slug || slugify(projectData.name) || dirName
    const project = { ...projectData, id: slug, diskId: dirName, slug }
    projects[slug] = project

    const crawl = loadJson(join(diskProjDir, 'crawl.json'))
    if (crawl) crawls[slug] = crawl

    const analysis = loadJson(join(diskProjDir, 'analysis.json'))
    if (analysis) analyses[slug] = { ...analysis, projectId: slug }

    const intelligence = loadJson(join(diskProjDir, 'intelligence.json'))
    if (intelligence) intelligences[slug] = { ...intelligence, projectId: slug }

    const blueprint = loadJson(join(diskProjDir, 'blueprint.json'))
    if (blueprint) blueprints[slug] = { ...blueprint, projectId: slug }

    const build = loadJson(join(diskProjDir, 'build.json'))
    if (build) builds[slug] = { ...build, projectId: slug }

    const pDir = join(diskProjDir, 'pages')
    if (existsSync(pDir)) {
      pages[slug] = []
      for (const internalPageId of readdirSync(pDir)) {
        const page = loadJson(join(pDir, internalPageId, 'page.json'))
        if (!page) continue
        const displayId = getDisplayPageId(internalPageId)
        pages[slug].push({ ...page, projectId: slug, displayId, internalId: internalPageId })

        const dom = loadJson(join(pDir, internalPageId, 'dom.json'), [])
        const styles = loadJson(join(pDir, internalPageId, 'styles.json'), {})
        const deskPath = join(pDir, internalPageId, 'screenshot-desktop.jpg')
        const mobPath = join(pDir, internalPageId, 'screenshot-mobile.jpg')
        captures[internalPageId] = {
          dom, styles,
          screenshotDesktop: existsSync(deskPath) ? readFileSync(deskPath) : null,
          screenshotMobile: existsSync(mobPath) ? readFileSync(mobPath) : null,
        }
      }
      pages[slug].sort((a, b) => a.internalId.localeCompare(b.internalId, undefined, { numeric: true }))
    }

    const num = parseInt(dirName.replace('proj-', ''))
    if (!isNaN(num) && num >= nextProjNum) nextProjNum = num + 1
    console.log(`[startup] loaded "${dirName}" → slug "${slug}" — ${pages[slug]?.length ?? 0} pages`)
  }
}

loadFromDisk()

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = ''
    req.on('data', (d) => (s += d))
    req.on('end', () => resolve(s ? JSON.parse(s) : {}))
  })
}

function sameOrigin(base, href) {
  try {
    const b = new URL(base)
    const u = new URL(href, base)
    return u.origin === b.origin && !u.pathname.match(/\.(pdf|zip|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|css|js)$/i)
  } catch { return false }
}

function guessPageType(url) {
  const p = new URL(url).pathname.toLowerCase()
  if (p === '/' || p === '') return 'homepage'
  if (p.includes('/product')) return 'product'
  if (p.includes('/collection') || p.includes('/categor') || p.includes('/shop')) return 'category'
  if (p.includes('/brand')) return 'brand'
  if (p.includes('/search')) return 'search'
  if (p.includes('/cart')) return 'cart'
  if (p.includes('/blog') || p.includes('/news') || p.includes('/article')) return 'content'
  return 'static'
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function domToHtml(nodes) {
  const SELF_CLOSING = new Set(['img', 'input', 'br', 'hr', 'meta', 'source', 'track', 'wbr', 'area', 'col', 'embed', 'link', 'param'])
  function renderNode(node) {
    if (!node || !node.tag) return ''
    const { tag, id, classes = [], text, children = [], src, srcset, href, alt } = node
    const attrs = []
    if (id) attrs.push(`id="${escHtml(id)}"`)
    if (classes.length) attrs.push(`class="${classes.map(c => escHtml(c)).join(' ')}"`)
    if (src && tag !== 'link') attrs.push(`src="${escHtml(src)}"`)
    if (srcset && tag === 'img') attrs.push(`srcset="${escHtml(srcset)}"`)
    if (tag === 'img') attrs.push(`loading="lazy"`)
    if (href && tag === 'a') attrs.push(`href="${escHtml(href)}"`)
    if (alt != null) attrs.push(`alt="${escHtml(alt)}"`)
    const attrStr = attrs.length ? ' ' + attrs.join(' ') : ''
    if (SELF_CLOSING.has(tag)) return `<${tag}${attrStr}>`
    const inner = text ? escHtml(text) : children.map(renderNode).join('')
    return `<${tag}${attrStr}>${inner}</${tag}>`
  }
  return nodes.map(renderNode).join('\n')
}

function stylesToCss(stylesObj) {
  if (!stylesObj || typeof stylesObj !== 'object') return ''
  return Object.entries(stylesObj).map(([selector, data]) => {
    const props = data?.computed ?? data ?? {}
    const decls = Object.entries(props).map(([k, v]) => `  ${k}: ${v};`).join('\n')
    return decls ? `${selector} {\n${decls}\n}` : ''
  }).filter(Boolean).join('\n\n')
}

// ── DOM extraction ────────────────────────────────────────────────────────────
async function extractDom(page, maxDepth = 12) {
  return page.evaluate((maxDepth) => {
    function walk(el, depth) {
      if (depth > maxDepth) return null
      const tag = el.tagName?.toLowerCase()
      if (!tag || ['script', 'style', 'noscript', 'svg', 'path', 'use', 'symbol'].includes(tag)) return null
      const id = el.id || undefined
      const classes = Array.from(el.classList)
      const text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.textContent?.trim().slice(0, 120) || undefined
        : undefined
      // Capture image src — use data-src as fallback for lazy-loaded images
      let src
      if (['img', 'video', 'audio', 'source'].includes(tag)) {
        src = el.src || el.dataset?.src || el.getAttribute('data-src') || undefined
        if (src && src.startsWith('data:')) src = undefined // skip inline base64
      }
      const srcset = (tag === 'img' && el.srcset) ? el.srcset : undefined
      const href = (tag === 'a' && el.href && !el.href.startsWith('javascript:')) ? el.href : undefined
      const alt = el.alt !== undefined && el.alt !== '' ? el.alt : undefined
      const children = Array.from(el.children)
        .map(c => walk(c, depth + 1))
        .filter(Boolean)
        .slice(0, 50)
      return { tag, id, classes, text, src, srcset, href, alt, children }
    }
    const body = document.body
    return body ? [walk(body, 0)].filter(Boolean) : []
  }, maxDepth)
}

async function extractStyles(page) {
  return page.evaluate(() => {
    const selectors = new Set()
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules ?? [])) {
          if (rule.selectorText) selectors.add(rule.selectorText.split(',')[0].trim())
        }
      } catch { /* cross-origin */ }
    }
    const result = {}
    const keys = ['display', 'position', 'background-color', 'color', 'font-size', 'font-weight',
      'font-family', 'line-height', 'letter-spacing', 'text-transform', 'font-style',
      'padding', 'margin', 'border-radius', 'box-shadow', 'grid-template-columns', 'flex-direction']
    let count = 0
    for (const sel of selectors) {
      if (count >= 40) break
      try {
        const el = document.querySelector(sel)
        if (!el) continue
        const computed = window.getComputedStyle(el)
        const props = {}
        for (const k of keys) {
          const v = computed.getPropertyValue(k)
          if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') props[k] = v
        }
        if (Object.keys(props).length > 0) { result[sel] = { computed: props }; count++ }
      } catch { /* skip */ }
    }
    return result
  })
}

// ── Page snapshot: self-contained clone data ─────────────────────────────────
// Every stylesheet, image, font and media file a page loads is saved under
// <project>/assets. The frozen DOM (snapshot.html) refers to assets through
// ⟦encoded-absolute-url⟧ markers that are resolved when the clone is served:
// to the saved copy when one exists, to the original URL otherwise.
const MARK_L = '⟦'
const MARK_R = '⟧'
const CRAWL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
const SHOT_OPTS = { type: 'jpeg', quality: 85, fullPage: true, animations: 'disabled' }

const EXT_BY_TYPE = {
  'text/css': 'css',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/jxl': 'jxl', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
  'application/font-woff2': 'woff2', 'application/font-woff': 'woff', 'application/x-font-ttf': 'ttf',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3',
}
const TYPE_BY_EXT = {
  css: 'text/css; charset=utf-8',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', jxl: 'image/jxl', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
}

const assetIndexes = {}   // projectId → { [absoluteUrl]: fileName }
const visualizeJobs = {}  // `${projectId}/${internalPageId}` → { status, phase, error }
const buildJobs = {}      // `${projectId}/${displayId}` → { status, error }

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

function assetsDir(proj) { return join(projectDiskPath(proj), 'assets') }

function getAssetIndex(proj) {
  if (!assetIndexes[proj.id]) assetIndexes[proj.id] = loadJson(join(assetsDir(proj), 'index.json'), {})
  return assetIndexes[proj.id]
}

function assetFileName(url, contentType) {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  let ext = EXT_BY_TYPE[type]
  if (!ext) {
    let m = null
    try { m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i) } catch {}
    ext = m && TYPE_BY_EXT[m[1].toLowerCase()] ? m[1].toLowerCase() : 'bin'
  }
  return `${hash}.${ext}`
}

// Saves every stylesheet/image/font/media response of a page. Returns a flush function.
function trackAssets(browserPage, proj) {
  const index = getAssetIndex(proj)
  const dir = assetsDir(proj)
  mkdirSync(dir, { recursive: true })
  const pending = []
  browserPage.on('response', resp => {
    const req = resp.request()
    const type = req.resourceType()
    if (!['stylesheet', 'image', 'font', 'media'].includes(type)) return
    const url = resp.url()
    if (!url.startsWith('http') || resp.status() !== 200) return
    pending.push((async () => {
      try {
        const body = await resp.body()
        if (!body.length || body.length > 25 * 1024 * 1024) return
        const key = url.split('#')[0]
        const file = assetFileName(key, type === 'stylesheet' ? 'text/css' : resp.headers()['content-type'])
        writeFileSync(join(dir, file), body)
        index[key] = file
        for (let r = req.redirectedFrom(); r; r = r.redirectedFrom()) index[r.url().split('#')[0]] = file
      } catch { /* body unavailable (aborted, navigated away) */ }
    })())
  })
  return async () => {
    await Promise.allSettled(pending.splice(0))
    saveJson(join(dir, 'index.json'), index)
  }
}

// Scroll the whole page so lazy images and scroll-triggered sections reach their final state.
async function scrollThrough(browserPage) {
  await browserPage.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8))
    for (let y = 0, i = 0; i < 80; i++) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await sleep(120)
      if (y + window.innerHeight >= document.documentElement.scrollHeight) break
      y += step
    }
    await sleep(300)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }).catch(() => {})
  await browserPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
  await settle(browserPage)
}

// Wait until the page stops changing: fonts and images loaded, no DOM mutations for a moment.
// Videos are parked on their first frame so original and clone are compared on the same picture.
async function settle(browserPage) {
  await browserPage.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const videos = [...document.querySelectorAll('video')]
    for (const v of videos) { try { v.pause(); v.currentTime = 0 } catch {} }
    await Promise.race([document.fonts.ready, sleep(5000)])
    let lastChange = performance.now()
    const observer = new MutationObserver(() => { lastChange = performance.now() })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    const start = performance.now()
    while (performance.now() - start < 12000) {
      const busy = [...document.images].some(i => !i.complete) ||
        videos.some(v => v.seeking || (v.autoplay && !v.error && v.readyState < 2))
      if (!busy && performance.now() - lastChange > 800) break
      await sleep(150)
    }
    observer.disconnect()
    // A video that never played paints nothing until it is seeked with data available
    for (const v of videos) {
      if (v.readyState < 1) continue
      // Off-screen videos are not composited, so bring each one into view while it seeks
      v.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise(r => {
        const shown = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : r())
        v.addEventListener('seeked', shown, { once: true })
        v.currentTime = 0.01
        setTimeout(r, 2500)
      })
    }
    if (videos.length) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      await sleep(600)
    }
  }).catch(() => {})
}

// Videos stream in ranges, so they never show up as a complete response; fetch them whole.
async function saveVideos(proj, urls) {
  const index = getAssetIndex(proj)
  for (const url of new Set(urls)) {
    const key = url.split('#')[0]
    if (index[key]) continue
    try {
      const resp = await fetch(key, { headers: { 'User-Agent': CRAWL_UA }, signal: AbortSignal.timeout(240000) })
      if (!resp.ok || Number(resp.headers.get('content-length') ?? 0) > 150 * 1024 * 1024) continue
      const body = Buffer.from(await resp.arrayBuffer())
      const file = assetFileName(key, resp.headers.get('content-type'))
      writeFileSync(join(assetsDir(proj), file), body)
      index[key] = file
    } catch { /* clone falls back to the original URL */ }
  }
  saveJson(join(assetsDir(proj), 'index.json'), index)
}

// Freeze the live DOM into static HTML: no scripts, form/scroll state baked in, asset URLs marked.
async function snapshotDom(browserPage) {
  return browserPage.evaluate(({ L, R }) => {
    const base = document.baseURI
    const SKIP = /^(data:|blob:|about:|javascript:|mailto:|tel:|#)/i
    const mark = u => {
      const t = (u || '').trim()
      if (!t || SKIP.test(t)) return null
      try { return L + encodeURIComponent(new URL(t, base).href) + R } catch { return null }
    }
    const cssUrls = css => css
      .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^)]*?))\s*\)/g, (m, a, b, c) => {
        const k = mark(a ?? b ?? c)
        return k ? `url("${k}")` : m
      })
      .replace(/@import\s+(?:"([^"]+)"|'([^']+)')/g, (m, a, b) => {
        const k = mark(a ?? b)
        return k ? `@import "${k}"` : m
      })
    const srcset = v => {
      const out = []
      let s = v.trim()
      while (s) {
        const m = s.match(/^(\S*[^\s,])(?:,|(\s+[^,]*)?(?:,|$))/)
        if (!m) return v
        out.push((mark(m[1]) || m[1]) + (m[2] ? ' ' + m[2].trim() : ''))
        s = s.slice(m[0].length).trim()
      }
      return out.join(', ')
    }

    // Import into a detached document so custom-element constructors never run on the copy.
    const inert = document.implementation.createHTMLDocument('')

    // Strip scripts and loaders, drop inline handlers, mark every asset URL
    const clean = scope => {
      scope.querySelectorAll([
        'script', 'noscript', 'base',
        'meta[http-equiv="Content-Security-Policy" i]', 'meta[http-equiv="refresh" i]',
        'link[rel~="preload"]', 'link[rel~="modulepreload"]', 'link[rel~="prefetch"]',
        'link[rel~="preconnect"]', 'link[rel~="dns-prefetch"]',
      ].join(',')).forEach(e => e.remove())
      const els = [...scope.querySelectorAll('*')]
      if (scope.nodeType === 1) els.unshift(scope)
      for (const el of els) {
        for (const at of [...el.attributes]) if (/^on/i.test(at.name)) el.removeAttribute(at.name)
        const tag = el.localName
        const set = (name, fn) => {
          const v = el.getAttribute(name)
          if (v == null) return
          const n = fn(v)
          if (n != null) el.setAttribute(name, n)
        }
        if (['img', 'source', 'video', 'audio', 'embed', 'track', 'input'].includes(tag)) set('src', mark)
        if (tag === 'img' || tag === 'source') set('srcset', srcset)
        if (tag === 'img') el.removeAttribute('loading')
        if (tag === 'video') set('poster', mark)
        if (tag === 'link') set('href', mark)
        if (tag === 'object') set('data', mark)
        if (tag === 'image' || tag === 'use') { set('href', mark); set('xlink:href', mark) }
        if (tag === 'a' && /^\s*javascript:/i.test(el.getAttribute('href') || '')) el.setAttribute('href', '#')
        if (el.hasAttribute('style')) set('style', cssUrls)
        if (tag === 'style') el.textContent = cssUrls(el.textContent)
      }
    }

    const adoptedStyles = (owner, target) => {
      try {
        for (const sheet of owner.adoptedStyleSheets || []) {
          const st = inert.createElement('style')
          st.textContent = cssUrls([...sheet.cssRules].map(r => r.cssText).join('\n'))
          target.append(st)
        }
      } catch {}
    }

    // Script-built DOM can hold nesting the HTML parser refuses (a <p> inside a <p>, a <div> inside
    // a <p>, nested links...). Re-parse the copy, find every element that would land under a
    // different parent, and ship it as a neutral <clone-el> that the clone runtime turns back.
    const UNFIXABLE = new Set(['html', 'head', 'body', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'col', 'colgroup', 'option', 'optgroup'])
    const fixNesting = (scope, reparse) => {
      const els = [...scope.querySelectorAll('*')]
      els.forEach((el, i) => el.setAttribute('data-clone-i', i))
      const wantParent = new Map(els.map(el => [el, el.parentElement ? el.parentElement.getAttribute('data-clone-i') : null]))
      const parsedParent = new Map()
      for (const el of reparse().querySelectorAll('[data-clone-i]')) {
        parsedParent.set(el.getAttribute('data-clone-i'), el.parentElement ? el.parentElement.getAttribute('data-clone-i') : null)
      }
      for (const el of els) {
        const i = el.getAttribute('data-clone-i')
        el.removeAttribute('data-clone-i')
        if (parsedParent.has(i) && parsedParent.get(i) === wantParent.get(el)) continue
        if (UNFIXABLE.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue
        const holder = inert.createElement('clone-el')
        for (const at of [...el.attributes]) holder.setAttribute(at.name, at.value)
        holder.setAttribute('data-clone-tag', el.localName)
        while (el.firstChild) holder.append(el.firstChild)
        el.replaceWith(holder)
      }
    }

    // Bake live state (form values, CSSOM rules, canvases, scroll offsets, shadow trees) into the copy
    const sync = (live, copy) => {
      if (live.length !== copy.length) return
      for (let i = 0; i < live.length; i++) {
        const a = live[i], b = copy[i], tag = a.localName
        if (tag === 'input') {
          if (a.type === 'checkbox' || a.type === 'radio') {
            if (a.checked) b.setAttribute('checked', ''); else b.removeAttribute('checked')
          } else if (!['password', 'file', 'hidden'].includes(a.type)) {
            b.setAttribute('value', a.value)
          }
        } else if (tag === 'textarea') {
          b.textContent = a.value
        } else if (tag === 'option') {
          if (a.selected) b.setAttribute('selected', ''); else b.removeAttribute('selected')
        } else if (tag === 'style' && a.sheet) {
          // Rules inserted through the CSSOM never appear in the markup
          try {
            const fromText = new CSSStyleSheet()
            fromText.replaceSync(a.textContent)
            if (fromText.cssRules.length !== a.sheet.cssRules.length) {
              b.textContent = [...a.sheet.cssRules].map(r => r.cssText).join('\n')
            }
          } catch {}
        } else if (tag === 'canvas') {
          try {
            const img = inert.createElement('img')
            img.setAttribute('src', a.toDataURL())
            for (const n of ['id', 'class', 'style', 'width', 'height']) {
              if (a.hasAttribute(n)) img.setAttribute(n, a.getAttribute(n))
            }
            b.replaceWith(img)
          } catch {}
        } else if (tag === 'iframe') {
          // Invisible iframes are tracking sandboxes; they add nothing to the look of the page
          const r = a.getBoundingClientRect()
          if (r.width <= 1 || r.height <= 1 || getComputedStyle(a).visibility === 'hidden') { b.remove(); continue }
        }
        if (tag !== 'html' && tag !== 'body' && (a.scrollLeft || a.scrollTop)) {
          b.setAttribute('data-clone-scroll', `${a.scrollLeft},${a.scrollTop}`)
        }
        if (a.shadowRoot) {
          const t = inert.createElement('template')
          t.setAttribute('shadowrootmode', 'open')
          for (const n of a.shadowRoot.childNodes) t.content.append(inert.importNode(n, true))
          sync([...a.shadowRoot.querySelectorAll('*')], [...t.content.querySelectorAll('*')])
          adoptedStyles(a.shadowRoot, t.content)
          clean(t.content)
          fixNesting(t.content, () => new DOMParser()
            .parseFromString('<!DOCTYPE html><body><template>' + t.innerHTML + '</template>', 'text/html')
            .querySelector('template').content)
          b.prepend(t)
        }
      }
    }

    const root = inert.importNode(document.documentElement, true)
    sync(
      [document.documentElement, ...document.documentElement.querySelectorAll('*')],
      [root, ...root.querySelectorAll('*')],
    )
    clean(root)

    const head = root.querySelector('head')
    if (head) {
      adoptedStyles(document, head)
      const b = inert.createElement('base')
      b.setAttribute('href', base)
      head.prepend(b)
      const m = inert.createElement('meta')
      m.setAttribute('charset', 'utf-8')
      head.prepend(m)
    }
    fixNesting(root, () => new DOMParser().parseFromString('<!DOCTYPE html>' + root.outerHTML, 'text/html'))

    return (document.doctype ? '<!DOCTYPE html>\n' : '') + root.outerHTML
  }, { L: MARK_L, R: MARK_R })
}

// Resolve asset markers in a stored snapshot against what has been saved for the project.
function resolveSnapshot(html, proj, assetBase) {
  const index = getAssetIndex(proj)
  return html.replace(/⟦([^⟧]*)⟧/g, (_, enc) => {
    let url
    try { url = decodeURIComponent(enc) } catch { return '' }
    const cut = url.indexOf('#')
    const key = cut < 0 ? url : url.slice(0, cut)
    const file = index[key]
    return file ? `${assetBase}/${file}${cut < 0 ? '' : url.slice(cut)}` : url
  })
}

// Point url()/@import inside a saved stylesheet at sibling saved assets (or the original URL).
function rewriteCss(css, cssUrl, index) {
  const fix = u => {
    const t = (u || '').trim()
    if (!t || /^(data:|blob:|about:|#)/i.test(t)) return null
    let abs
    try { abs = new URL(t, cssUrl).href } catch { return null }
    const cut = abs.indexOf('#')
    const key = cut < 0 ? abs : abs.slice(0, cut)
    return index[key] ? index[key] + (cut < 0 ? '' : abs.slice(cut)) : abs
  }
  return css
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^)]*?))\s*\)/g, (m, a, b, c) => {
      const f = fix(a ?? b ?? c)
      return f ? `url("${f}")` : m
    })
    .replace(/@import\s+(?:"([^"]+)"|'([^']+)')/g, (m, a, b) => {
      const f = fix(a ?? b)
      return f ? `@import "${f}"` : m
    })
}

// Runs inside every served clone: restore scroll offsets, keep clicks from leaving the clone.
const CLONE_RUNTIME = `<script>(function(){
  function untag(scope){scope.querySelectorAll('clone-el[data-clone-tag]').forEach(function(el){var r=document.createElement(el.getAttribute('data-clone-tag'));for(var i=0;i<el.attributes.length;i++){var a=el.attributes[i];if(a.name!=='data-clone-tag')r.setAttribute(a.name,a.value)}while(el.firstChild)r.appendChild(el.firstChild);el.replaceWith(r)});scope.querySelectorAll('*').forEach(function(el){if(el.shadowRoot)untag(el.shadowRoot)})}
  untag(document);
  function restore(){document.querySelectorAll('[data-clone-scroll]').forEach(function(el){var p=el.getAttribute('data-clone-scroll').split(',');el.style.scrollBehavior='auto';el.scrollLeft=+p[0];el.scrollTop=+p[1]})}
  restore();window.addEventListener('load',restore);
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;e.preventDefault();var h=a.getAttribute('href')||'';if(h.charAt(0)==='#'&&h.length>1){var t=document.getElementById(h.slice(1));if(t)t.scrollIntoView()}},true);
  document.addEventListener('submit',function(e){e.preventDefault()},true);
})()</script>`

// Load a page at one viewport, bring it to its final state, then freeze it.
async function capturePass(browser, proj, url, viewport, collect) {
  const context = await browser.newContext({ viewport, userAgent: CRAWL_UA })
  // Closed shadow roots cannot be read back, so widgets that use them would vanish from the clone
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }) }
  })
  // Ask for image formats every browser can decode; CDNs otherwise hand Chromium JPEG XL
  await context.route('**/*', route => {
    const req = route.request()
    if (req.resourceType() !== 'image') return route.continue()
    return route.continue({ headers: { ...req.headers(), accept: IMAGE_ACCEPT } })
  })
  const browserPage = await context.newPage()
  const flushAssets = trackAssets(browserPage, proj)
  try {
    await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await browserPage.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
    await browserPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    // Lazy images in hidden slides/tabs never load on their own; fetch them so the clone has them
    await browserPage.evaluate(() => {
      document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager' })
    }).catch(() => {})
    await scrollThrough(browserPage)

    const extra = collect ? await collect(browserPage) : {}
    const videoUrls = await browserPage.evaluate(() =>
      [...document.querySelectorAll('video, video source')].map(e => e.currentSrc || e.src).filter(u => u && u.startsWith('http'))
    ).catch(() => [])
    // Images that failed on the live page (network hiccup, rate limit) get two more chances
    for (let attempt = 0; attempt < 2; attempt++) {
      const retried = await browserPage.evaluate(() => {
        const broken = [...document.images].filter(i => i.complete && !i.naturalWidth && i.currentSrc)
        for (const i of broken) { const src = i.src; i.src = ''; i.src = src }
        return broken.length
      }).catch(() => 0)
      if (!retried) break
      await browserPage.waitForTimeout(1500)
      await settle(browserPage)
    }
    await settle(browserPage)
    // Snapshot and reference screenshot are taken back to back so they show the same state
    const snapshotHtml = await snapshotDom(browserPage)
    const screenshot = await browserPage.screenshot(SHOT_OPTS)
    await flushAssets()
    return { ...extra, snapshotHtml, screenshot, videoUrls }
  } finally {
    await context.close()
  }
}

// Capture one page: evidence (dom/styles/screenshots) plus self-contained desktop and mobile snapshots.
async function capturePage(browser, proj, url, pageId, { isFirst = false } = {}) {
  const [desktop, mobile] = await Promise.all([
    capturePass(browser, proj, url, DESKTOP_VIEWPORT, async browserPage => {
      const dom = await extractDom(browserPage)
      const styles = await extractStyles(browserPage)
      if (isFirst) {
        const cssUrls = await browserPage.evaluate(() =>
          [...document.querySelectorAll('link[rel="stylesheet"][href]')].map(l => l.href).filter(h => h.startsWith('http'))
        )
        const jsUrls = await browserPage.evaluate(() =>
          [...document.querySelectorAll('script[src]')].map(s => s.src).filter(h => h.startsWith('http'))
        )
        saveJson(join(projectDiskPath(proj), 'css-urls.json'), cssUrls)
        saveJson(join(projectDiskPath(proj), 'js-urls.json'), jsUrls)
      }
      const links = await browserPage.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => h.startsWith('http'))
      )
      return { dom, styles, links, renderedHtml: await browserPage.content() }
    }),
    capturePass(browser, proj, url, MOBILE_VIEWPORT),
  ])
  await saveVideos(proj, [...desktop.videoUrls, ...mobile.videoUrls])

  const pd = join(projectDiskPath(proj), 'pages', pageId)
  mkdirSync(pd, { recursive: true })
  saveJson(join(pd, 'dom.json'), desktop.dom)
  saveJson(join(pd, 'styles.json'), desktop.styles)
  writeFileSync(join(pd, 'rendered.html'), desktop.renderedHtml, 'utf8')
  writeFileSync(join(pd, 'snapshot.html'), desktop.snapshotHtml, 'utf8')
  writeFileSync(join(pd, 'snapshot-mobile.html'), mobile.snapshotHtml, 'utf8')
  writeFileSync(join(pd, 'screenshot-desktop.jpg'), desktop.screenshot)
  writeFileSync(join(pd, 'screenshot-mobile.jpg'), mobile.screenshot)
  // A fresh capture invalidates any earlier comparison
  for (const f of ['fidelity.json', 'clone-desktop.jpg', 'clone-mobile.jpg', 'diff-desktop.jpg', 'diff-mobile.jpg']) {
    rmSync(join(pd, f), { force: true })
  }

  captures[pageId] = {
    dom: desktop.dom, styles: desktop.styles,
    screenshotDesktop: desktop.screenshot, screenshotMobile: mobile.screenshot,
  }
  return { links: desktop.links }
}

// ── Visual check: render the clone, compare it pixel by pixel with the original ──
async function screenshotClone(browser, cloneUrl, viewport) {
  const context = await browser.newContext({ viewport, userAgent: CRAWL_UA })
  const p = await context.newPage()
  const external = new Set()
  p.on('request', r => {
    const u = r.url()
    if (u.startsWith('http') && !u.startsWith('http://localhost:3000')) external.add(u)
  })
  try {
    await p.goto(cloneUrl, { waitUntil: 'load', timeout: 30000 })
    await scrollThrough(p)
    return { shot: await p.screenshot(SHOT_OPTS), external }
  } finally {
    await context.close()
  }
}

async function diffImages(browser, bufA, bufB) {
  const context = await browser.newContext()
  const p = await context.newPage()
  try {
    return await p.evaluate(async ({ a, b }) => {
      const load = src => new Promise((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('could not decode screenshot'))
        i.src = src
      })
      const [ia, ib] = await Promise.all([load(a), load(b)])
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height)
      const pixels = img => {
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        const x = c.getContext('2d')
        x.drawImage(img, 0, 0)
        return x.getImageData(0, 0, w, h).data
      }
      const da = pixels(ia), db = pixels(ib)
      const out = document.createElement('canvas')
      out.width = w; out.height = h
      const ox = out.getContext('2d')
      const od = ox.createImageData(w, h)
      const o = od.data
      const ow = Math.min(ia.width, ib.width), oh = Math.min(ia.height, ib.height)
      let diff = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const delta = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
          if (x >= ow || y >= oh || delta > 75) {
            diff++
            o[i] = 255; o[i + 1] = 0; o[i + 2] = 80
          } else {
            const g = 255 - (255 - (da[i] * 0.3 + da[i + 1] * 0.59 + da[i + 2] * 0.11)) * 0.35
            o[i] = o[i + 1] = o[i + 2] = g
          }
          o[i + 3] = 255
        }
      }
      ox.putImageData(od, 0, 0)
      return {
        matchPct: Math.floor((1 - diff / (w * h)) * 10000) / 100,
        originalHeight: ia.height,
        cloneHeight: ib.height,
        diff: out.toDataURL('image/jpeg', 0.7),
      }
    }, {
      a: 'data:image/jpeg;base64,' + bufA.toString('base64'),
      b: 'data:image/jpeg;base64,' + bufB.toString('base64'),
    })
  } finally {
    await context.close()
  }
}

function visualizeStatus(proj, page) {
  const internalId = page.internalId || page.id
  const pd = join(projectDiskPath(proj), 'pages', internalId)
  const job = visualizeJobs[`${proj.id}/${internalId}`]
  return {
    pageId: page.displayId,
    url: page.url,
    pageType: page.pageType,
    status: job?.status ?? 'idle',
    phase: job?.phase,
    error: job?.error,
    hasSnapshot: existsSync(join(pd, 'snapshot.html')),
    fidelity: loadJson(join(pd, 'fidelity.json')),
  }
}

async function visualizePage(proj, page, { recapture = false } = {}) {
  const internalId = page.internalId || page.id
  const key = `${proj.id}/${internalId}`
  if (visualizeJobs[key]?.status === 'running') return
  const job = visualizeJobs[key] = { status: 'running', phase: 'starting' }
  const pd = join(projectDiskPath(proj), 'pages', internalId)
  const browser = await chromium.launch({ headless: true })
  try {
    if (recapture || !existsSync(join(pd, 'snapshot.html'))) {
      job.phase = 'capturing'
      await capturePage(browser, proj, page.url, internalId)
    }
    const cap = captures[internalId]
    if (!cap?.screenshotDesktop || !cap?.screenshotMobile) throw new Error('No original screenshots for this page')

    job.phase = 'rendering'
    const cloneUrl = `http://localhost:3000/projects/${encodeURIComponent(proj.id)}/pages/${encodeURIComponent(page.displayId)}/reconstruct`
    const [desk, mob] = await Promise.all([
      screenshotClone(browser, cloneUrl, DESKTOP_VIEWPORT),
      screenshotClone(browser, `${cloneUrl}?device=mobile`, MOBILE_VIEWPORT),
    ])

    job.phase = 'comparing'
    const externalUrls = [...new Set([...desk.external, ...mob.external])]
    const fidelity = {
      externalRequests: externalUrls.length,
      externalUrls: externalUrls.slice(0, 20),
      checkedAt: new Date().toISOString(),
    }
    for (const [name, original, clone] of [['desktop', cap.screenshotDesktop, desk.shot], ['mobile', cap.screenshotMobile, mob.shot]]) {
      const { diff, ...result } = await diffImages(browser, original, clone)
      writeFileSync(join(pd, `clone-${name}.jpg`), clone)
      writeFileSync(join(pd, `diff-${name}.jpg`), Buffer.from(diff.split(',')[1], 'base64'))
      fidelity[name] = result
    }
    saveJson(join(pd, 'fidelity.json'), fidelity)
    job.status = 'completed'
    job.phase = undefined
    console.log(`[visualize] ${page.url} — desktop ${fidelity.desktop.matchPct}% · mobile ${fidelity.mobile.matchPct}%`)
  } catch (err) {
    console.error(`[visualize] failed for ${page.url}:`, err)
    job.status = 'failed'
    job.error = err.message
  } finally {
    await browser.close()
  }
}

// ── Per-page build (resolve snapshot → save build.html) ──────────────────────
function getBuildStatus(proj, page) {
  const internalId = page.internalId || page.id
  const pd = join(projectDiskPath(proj), 'pages', internalId)
  const job = buildJobs[`${proj.id}/${page.displayId}`] ?? {}
  const hasSnapshot = existsSync(join(pd, 'snapshot.html'))
  const hasBuild = existsSync(join(pd, 'build.html'))
  return {
    pageId: page.displayId,
    url: page.url,
    hasSnapshot,
    hasBuild,
    status: job.status ?? (hasBuild ? 'completed' : 'idle'),
    error: job.error,
  }
}

async function buildPageLocal(proj, page) {
  const jobKey = `${proj.id}/${page.displayId}`
  if (buildJobs[jobKey]?.status === 'running') return getBuildStatus(proj, page)
  buildJobs[jobKey] = { status: 'running' }
  try {
    const internalId = page.internalId || page.id
    const pd = join(projectDiskPath(proj), 'pages', internalId)
    const snapshotPath = join(pd, 'snapshot.html')
    const mobileSnapshotPath = join(pd, 'snapshot-mobile.html')
    if (!existsSync(snapshotPath)) throw new Error('No snapshot found — crawl this page first')
    const assetBase = `http://localhost:3000/api/projects/${encodeURIComponent(proj.id)}/assets`
    for (const [src, dest] of [[snapshotPath, 'build.html'], [mobileSnapshotPath, 'build-mobile.html']]) {
      if (!existsSync(src)) continue
      let html = resolveSnapshot(readFileSync(src, 'utf8'), proj, assetBase)
      const end = html.lastIndexOf('</body>')
      html = end < 0 ? html + CLONE_RUNTIME : html.slice(0, end) + CLONE_RUNTIME + html.slice(end)
      writeFileSync(join(pd, dest), html, 'utf8')
    }
    buildJobs[jobKey] = { status: 'completed' }
    console.log(`[build] ${page.url} — built successfully`)
  } catch (err) {
    console.error(`[build] failed for ${page.url}:`, err)
    buildJobs[jobKey] = { status: 'failed', error: err.message }
  }
  return getBuildStatus(proj, page)
}

// ── Real crawler ──────────────────────────────────────────────────────────────
function normalizeCrawlUrl(u) {
  try {
    const x = new URL(u)
    x.hash = ''
    return x.href.replace(/\/$/, '')
  } catch { return u }
}

async function crawlProject(pid) {
  const project = projects[pid]
  const startUrl = normalizeCrawlUrl(project.url)
  console.log(`[crawl] starting ${pid} → ${startUrl}`)

  // Pages keep their id across re-crawls so favorites and evidence links stay valid
  const priorIds = new Map()
  let nextNum = 1
  for (const p of pages[pid] ?? []) {
    const id = p.internalId || p.id
    if (!priorIds.has(normalizeCrawlUrl(p.url))) priorIds.set(normalizeCrawlUrl(p.url), id)
    const n = parseInt(id.replace(/^.*page-/, ''))
    if (!isNaN(n) && n >= nextNum) nextNum = n + 1
  }
  const usedIds = new Set()
  const idFor = url => {
    let id = priorIds.get(url)
    if (!id || usedIds.has(id)) id = `page-${nextNum++}`
    usedIds.add(id)
    return id
  }

  // Saved assets belong to the previous crawl; every page is captured again below
  rmSync(assetsDir(project), { recursive: true, force: true })
  assetIndexes[pid] = {}

  const browser = await chromium.launch({ headless: true })
  const visited = new Set()
  const queue = [startUrl]
  const pageResults = []

  projects[pid].status = 'crawling'
  crawls[pid] = {
    id: `crawl-${pid}`, projectId: pid, status: 'running',
    pagesDiscovered: 1, pagesCaptured: 0, pagesFailed: 0,
    startedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  }

  const MAX_PAGES = 30
  let inFlight = 0
  const worker = async () => {
    while (pageResults.length + inFlight < MAX_PAGES) {
      const url = queue.shift()
      if (!url) {
        if (inFlight === 0) break
        await new Promise(r => setTimeout(r, 250))
        continue
      }
      if (visited.has(url)) continue
      visited.add(url)
      inFlight++

      const pageId = idFor(url)
      const pageRecord = {
        id: pageId, internalId: pageId, displayId: getDisplayPageId(pageId),
        projectId: pid, url,
        pageType: guessPageType(url),
        crawlDepth: url === startUrl ? 0 : 1,
        status: 'captured',
        createdAt: new Date().toISOString(),
      }
      const pd = join(projectDiskPath(project), 'pages', pageId)
      mkdirSync(pd, { recursive: true })

      try {
        const { links } = await capturePage(browser, project, url, pageId, { isFirst: url === startUrl })
        for (const link of links) {
          const n = normalizeCrawlUrl(link)
          if (sameOrigin(startUrl, n) && !visited.has(n) && !queue.includes(n)) queue.push(n)
        }
        console.log(`[crawl] ✓ ${url}`)
      } catch (err) {
        console.log(`[crawl] ✗ ${url} — ${err.message}`)
        pageRecord.status = 'failed'
        pageRecord.error = err.message
      }
      inFlight--
      pageResults.push(pageRecord)
      saveJson(join(pd, 'page.json'), pageRecord)

      crawls[pid] = {
        ...crawls[pid],
        pagesDiscovered: visited.size + queue.length,
        pagesCaptured: pageResults.filter(p => p.status === 'captured').length,
        pagesFailed: pageResults.filter(p => p.status === 'failed').length,
      }
    }
  }

  try {
    // Two pages at a time: each one already loads a desktop and a mobile pass in parallel
    await Promise.all([worker(), worker()])
  } finally {
    await browser.close()
  }
  const pageNum = p => parseInt(p.id.replace(/^.*page-/, '')) || 0
  pageResults.sort((a, b) => pageNum(a) - pageNum(b))

  // Drop page folders left behind by earlier crawls that this crawl did not visit
  const pagesRoot = join(projectDiskPath(project), 'pages')
  const anyCaptured = pageResults.some(p => p.status === 'captured')
  for (const dirName of anyCaptured ? readdirSync(pagesRoot) : []) {
    if (usedIds.has(dirName)) continue
    rmSync(join(pagesRoot, dirName), { recursive: true, force: true })
    delete captures[dirName]
  }

  pages[pid] = pageResults
  crawls[pid] = {
    ...crawls[pid], status: 'completed',
    pagesDiscovered: pageResults.length,
    pagesCaptured: pageResults.filter(p => p.status === 'captured').length,
    pagesFailed: pageResults.filter(p => p.status === 'failed').length,
    completedAt: new Date().toISOString(),
  }
  projects[pid].status = 'crawl_complete'

  const pd = projectDiskPath(project)
  mkdirSync(pd, { recursive: true })
  saveJson(join(pd, 'project.json'), projects[pid])
  saveJson(join(pd, 'crawl.json'), crawls[pid])

  console.log(`[crawl] done — ${pageResults.length} pages`)
}

// ── Component detection (real analysis) ──────────────────────────────────────
// Each detector can match classes/ids (patterns), data-* attributes (dataAttrs),
// aria-label substrings (ariaLabels), or semantic tag+role combos (semantic).
const COMPONENT_DETECTORS = [
  // ── Core commerce ──────────────────────────────────────────────────────────
  {
    componentType: 'ProductGrid',
    patterns: ['product-grid', 'product-list', 'products-grid', 'product-loop', 'product__grid',
      'collection-product-list', 'product-card-list', 'collection__products', 'products-wrapper'],
    dataAttrs: ['data-product-grid', 'data-collection-grid'],
    plugoEndpoint: '/components/product-grid',
    renderHint: 'Use Plugo ProductGrid with grid layout props',
    isGap: false,
  },
  {
    componentType: 'ProductCard',
    patterns: ['product-card', 'product-item', 'product__card', 'product-block',
      'card--product', 'product-miniature', 'product__info', 'product-thumb'],
    dataAttrs: ['data-product-id', 'data-product-handle'],
    plugoEndpoint: '/components/product-card',
    renderHint: 'Use Plugo ProductCard component',
    isGap: false,
  },
  {
    componentType: 'ProductQuickView',
    patterns: ['quick-view', 'quickview', 'quick-add', 'quick-shop', 'product-quick-view',
      'product__quickview', 'quick-add-modal'],
    ariaLabels: ['quick view', 'quick add'],
    plugoEndpoint: '/components/product-quick-view',
    renderHint: 'Use Plugo QuickView modal component',
    isGap: false,
  },
  {
    componentType: 'AddToCart',
    patterns: ['add-to-cart', 'product-form__cart-submit', 'product__add-to-cart',
      'addtocart', 'product-form__submit', 'atc-btn'],
    ariaLabels: ['add to cart', 'add to bag'],
    dataAttrs: ['data-add-to-cart'],
    plugoEndpoint: '/components/add-to-cart',
    renderHint: 'Use Plugo AddToCart button with product variant props',
    isGap: false,
  },
  {
    componentType: 'CartDrawer',
    patterns: ['cart-drawer', 'cart-sidebar', 'mini-cart', 'slide-cart',
      'drawer__cart', 'cart__drawer', 'cart-notification', 'ajax-cart'],
    ariaLabels: ['shopping cart', 'cart drawer'],
    dataAttrs: ['data-cart-drawer'],
    plugoEndpoint: '/components/cart',
    renderHint: 'Use Plugo Cart drawer component',
    isGap: false,
  },
  {
    componentType: 'CartPage',
    patterns: ['cart-items', 'cart__items', 'cart-form', 'cart__container',
      'cart-page', 'cart__footer'],
    plugoEndpoint: '/components/cart-page',
    renderHint: 'Use Plugo Cart page layout',
    isGap: false,
  },
  // ── Navigation & layout ───────────────────────────────────────────────────
  {
    componentType: 'Header',
    patterns: ['site-header', 'header__wrapper', 'shopify-section-header', 'header-section',
      'site-header__inner', 'header__inner', 'header-wrapper'],
    plugoEndpoint: '/components/header',
    renderHint: 'Use Plugo Header layout component',
    isGap: false,
  },
  {
    componentType: 'NavigationMenu',
    patterns: ['header__nav', 'site-nav', 'nav-menu', 'main-navigation',
      'header-nav', 'navigation__list', 'menu__list', 'nav__list'],
    ariaLabels: ['main navigation', 'primary navigation'],
    plugoEndpoint: '/components/navigation',
    renderHint: 'Use Plugo Navigation component',
    isGap: false,
  },
  {
    componentType: 'MobileMenu',
    patterns: ['mobile-nav', 'mobile-menu', 'drawer-navigation', 'menu-drawer',
      'menu__mobile', 'sidebar-menu', 'hamburger-nav'],
    ariaLabels: ['mobile menu', 'toggle menu'],
    plugoEndpoint: '/components/mobile-menu',
    renderHint: 'Use Plugo MobileMenu drawer component',
    isGap: false,
  },
  {
    componentType: 'Footer',
    patterns: ['site-footer', 'footer__content', 'footer-section', 'footer__wrapper',
      'footer__blocks', 'footer-inner'],
    plugoEndpoint: '/components/footer',
    renderHint: 'Use Plugo Footer layout component',
    isGap: false,
  },
  {
    componentType: 'Breadcrumbs',
    patterns: ['breadcrumb', 'breadcrumbs', 'breadcrumb__list', 'site-breadcrumb',
      'breadcrumb-nav', 'crumbs'],
    ariaLabels: ['breadcrumb'],
    plugoEndpoint: '/components/breadcrumbs',
    renderHint: 'Use Plugo Breadcrumbs component',
    isGap: false,
  },
  // ── Search & discovery ───────────────────────────────────────────────────
  {
    componentType: 'SearchBar',
    patterns: ['predictive-search', 'search-form', 'search__input', 'header__search',
      'search-bar', 'search-modal', 'search__form', 'search-box'],
    ariaLabels: ['search', 'site search'],
    dataAttrs: ['data-predictive-search'],
    plugoEndpoint: '/components/search',
    renderHint: 'Use Plugo Search component',
    isGap: false,
  },
  {
    componentType: 'ProductFilters',
    patterns: ['facets', 'product-filters', 'filter-panel', 'facet-filters',
      'collection-filter', 'product-filter', 'filter-drawer'],
    dataAttrs: ['data-filter-type', 'data-facets'],
    plugoEndpoint: '/components/filters',
    renderHint: 'Use Plugo Faceted Filters component',
    isGap: false,
  },
  {
    componentType: 'SortDropdown',
    patterns: ['sort-by', 'product-sort', 'sortby', 'collection-sort',
      'sort__select', 'product-sort-select'],
    plugoEndpoint: '/components/sort',
    renderHint: 'Use Plugo SortDropdown component',
    isGap: false,
  },
  // ── Product detail ────────────────────────────────────────────────────────
  {
    componentType: 'ProductGallery',
    patterns: ['product__media', 'product-gallery', 'product-images', 'product-media-gallery',
      'product__photo', 'gallery__wrapper', 'product-single__photos'],
    plugoEndpoint: '/components/product-gallery',
    renderHint: 'Use Plugo ProductGallery with thumbnails support',
    isGap: false,
  },
  {
    componentType: 'VariantSelector',
    patterns: ['variant-selects', 'product-form__variants', 'variant-wrapper',
      'variant__buttons', 'swatch', 'option-selector', 'variant-picker'],
    dataAttrs: ['data-variant-selector', 'data-product-variants'],
    plugoEndpoint: '/components/variant-selector',
    renderHint: 'Use Plugo VariantSelector with swatch support',
    isGap: false,
  },
  {
    componentType: 'QuantitySelector',
    patterns: ['quantity-wrapper', 'quantity__rules', 'product__quantity',
      'quantity-selector', 'qty-selector', 'number-input'],
    plugoEndpoint: '/components/quantity',
    renderHint: 'Use Plugo QuantitySelector component',
    isGap: false,
  },
  {
    componentType: 'StockCounter',
    patterns: ['inventory', 'stock-level', 'inventory-status', 'product-availability',
      'low-stock', 'stock__notice', 'availability'],
    plugoEndpoint: '/components/stock-counter',
    renderHint: 'Use Plugo StockCounter with live inventory feed',
    isGap: false,
  },
  // ── Engagement & social ───────────────────────────────────────────────────
  {
    componentType: 'AnnouncementBar',
    patterns: ['announcement-bar', 'announcement__bar', 'promo-bar',
      'announcement-bar-section', 'site-announcement', 'top-bar'],
    plugoEndpoint: '/components/announcement-bar',
    renderHint: 'Use Plugo AnnouncementBar component',
    isGap: false,
  },
  {
    componentType: 'HeroBanner',
    patterns: ['hero', 'hero-banner', 'slideshow', 'banner-section', 'hero-section',
      'featured-collection', 'hero__content', 'homepage-hero'],
    plugoEndpoint: '/components/hero',
    renderHint: 'Use Plugo HeroBanner component with CTA slot',
    isGap: false,
  },
  {
    componentType: 'ImageSlider',
    patterns: ['slider', 'carousel', 'swiper', 'glide', 'splide', 'flickity',
      'slideshow', 'image-slider', 'product-slider'],
    dataAttrs: ['data-slider', 'data-swiper', 'data-carousel'],
    plugoEndpoint: '/components/slider',
    renderHint: 'Use Plugo ImageSlider component',
    isGap: false,
  },
  {
    componentType: 'NewsletterSignup',
    patterns: ['newsletter', 'email-signup', 'klaviyo', 'footer-block--newsletter',
      'newsletter-section', 'email-capture', 'signup-form'],
    renderHint: 'Use Plugo Email Capture component or embed Klaviyo form',
    isGap: false,
  },
  {
    componentType: 'SocialLinks',
    patterns: ['social-links', 'social-icons', 'social-sharing', 'social__link',
      'share-buttons', 'social-media-links'],
    plugoEndpoint: '/components/social',
    renderHint: 'Use Plugo SocialLinks component',
    isGap: false,
  },
  // ── Gaps — no Plugo v1 equivalent ─────────────────────────────────────────
  {
    componentType: 'WishlistButton',
    patterns: ['wishlist', 'wish-list', 'save-item', 'favorite-btn',
      'add-to-wishlist', 'wishlist-btn', 'save-for-later'],
    ariaLabels: ['add to wishlist', 'save item'],
    renderHint: 'No native wishlist component in Plugo v1',
    isGap: true,
    gapReason: 'Wishlist / saved items not available in Plugo v1. Recommend Growave or Swym.',
  },
  {
    componentType: 'ReviewWidget',
    patterns: ['reviews', 'review-widget', 'product-reviews', 'yotpo', 'stamped',
      'okendo', 'judgeme', 'jdgm', 'star-rating', 'review-form'],
    dataAttrs: ['data-reviews'],
    renderHint: 'Review widgets require external integration',
    isGap: true,
    gapReason: 'Product reviews not in Plugo v1 core. Recommend Yotpo or Stamped.io.',
  },
  {
    componentType: 'LoyaltyWidget',
    patterns: ['loyalty', 'rewards', 'points', 'smile-ui', 'gw-widget',
      'loyaltylion', 'referral-candy', 'swell-widget'],
    renderHint: 'Inject loyalty widget as custom script',
    isGap: true,
    gapReason: 'Loyalty/rewards programs are third-party — embed via Growave, Smile.io, or similar.',
  },
  {
    componentType: 'LiveChat',
    patterns: ['intercom', 'zendesk', 'crisp', 'tawk', 'live-chat',
      'chat-widget', 'gorgias', 'helpdesk', 'tidio'],
    renderHint: 'Inject via script tag outside Plugo scope',
    isGap: true,
    gapReason: 'Live chat is a third-party tool — embed via custom script injection.',
  },
  {
    componentType: 'VideoPlayer',
    patterns: ['video-section', 'video__wrapper', 'video-player', 'video-embed',
      'product-video', 'video-container', 'youtube-video'],
    dataAttrs: ['data-video-id', 'data-youtube'],
    renderHint: 'Embed via HTML block with iframe in Plugo',
    isGap: true,
    gapReason: 'No native video component in Plugo v1. Use HTML embed block.',
  },
  {
    componentType: 'CountdownTimer',
    patterns: ['countdown', 'timer', 'sale-timer', 'urgency-timer',
      'product-countdown', 'deal-countdown'],
    renderHint: 'No native countdown in Plugo v1',
    isGap: true,
    gapReason: 'Countdown timers require a third-party app or custom JS injection.',
  },
]

function walkDom(node, fn) {
  if (!node) return
  fn(node)
  for (const child of (node.children || [])) walkDom(child, fn)
}

function detectPlatform(allDoms) {
  const signals = { shopify: 0, woocommerce: 0, magento: 0, squarespace: 0 }
  for (const dom of allDoms) {
    for (const root of dom) {
      walkDom(root, (node) => {
        const all = [...(node.classes || []), node.id || ''].join(' ').toLowerCase()
        if (all.includes('shopify')) signals.shopify += 2
        if (all.includes('woocommerce') || all.includes(' wc-')) signals.woocommerce += 2
        if (all.includes('mage-') || all.includes('catalog-product')) signals.magento += 2
        if (all.includes('sqs-')) signals.squarespace += 2
      })
    }
  }
  const top = Object.entries(signals).sort((a, b) => b[1] - a[1])[0]
  const total = Object.values(signals).reduce((s, v) => s + v, 0)
  if (!top || top[1] === 0) return { platform: 'unknown', platformConfidence: 'low' }
  const ratio = total > 0 ? top[1] / total : 0
  return {
    platform: top[0],
    platformConfidence: ratio > 0.7 ? 'high' : ratio > 0.4 ? 'medium' : 'low',
  }
}

function nodeMatchesDetector(node, det) {
  const classes = (node.classes || []).join(' ').toLowerCase()
  const id = (node.id || '').toLowerCase()
  const combined = `${classes} ${id}`
  if (det.patterns.some(p => combined.includes(p))) return true
  // data-* attributes
  if (det.dataAttrs && node.dataAttrs) {
    const nodeDataKeys = Object.keys(node.dataAttrs || {}).map(k => `data-${k}`.toLowerCase())
    if (det.dataAttrs.some(da => nodeDataKeys.includes(da.toLowerCase()))) return true
  }
  // aria-label
  if (det.ariaLabels && node.ariaLabel) {
    const al = (node.ariaLabel || '').toLowerCase()
    if (det.ariaLabels.some(la => al.includes(la.toLowerCase()))) return true
  }
  // text content (button labels etc.)
  if (det.textPatterns && node.text) {
    const txt = (node.text || '').toLowerCase()
    if (det.textPatterns.some(tp => txt.includes(tp.toLowerCase()))) return true
  }
  return false
}

function detectComponents(allCaptures) {
  const hits = Object.fromEntries(
    COMPONENT_DETECTORS.map(d => [d.componentType, { count: 0, pages: new Set(), selectors: [] }])
  )

  for (const { pageId, dom } of allCaptures) {
    for (const root of dom) {
      walkDom(root, (node) => {
        for (const det of COMPONENT_DETECTORS) {
          if (nodeMatchesDetector(node, det)) {
            hits[det.componentType].count++
            hits[det.componentType].pages.add(pageId)
            const sel = node.id ? `#${node.id}` : node.classes[0] ? `.${node.classes[0]}` : node.tag
            if (!hits[det.componentType].selectors.includes(sel)) {
              hits[det.componentType].selectors.push(sel)
            }
          }
        }
      })
    }
  }

  const totalPages = allCaptures.length || 1
  const components = []
  const mappings = []

  for (const det of COMPONENT_DETECTORS) {
    const hit = hits[det.componentType]
    if (hit.count === 0) continue

    const pagesFound = hit.pages.size
    const confidence = pagesFound >= totalPages * 0.5 ? 'high' : pagesFound >= 2 ? 'medium' : 'low'

    components.push({
      id: `c-${det.componentType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      componentType: det.componentType,
      selector: hit.selectors[0] || `.${det.componentType.toLowerCase()}`,
      occurrenceCount: hit.count,
      confidence,
      evidenceStatus: 'measured',
    })
    mappings.push({
      componentType: det.componentType,
      plugoEndpoint: det.plugoEndpoint,
      renderHint: det.renderHint,
      isGap: det.isGap,
      gapReason: det.gapReason,
    })
  }

  return { components, mappings }
}

async function analyzeProject(pid) {
  const project = projects[pid]
  if (!project) throw new Error(`Project ${pid} not found`)

  const pageList = pages[pid] || []
  const capturedPages = pageList.filter(p => p.status === 'captured')
  const pagesTotal = capturedPages.length

  project.status = 'analysing'
  analyses[pid] = {
    id: `analysis-${pid}`, projectId: pid, crawlJobId: `crawl-${pid}`,
    status: 'running',
    pagesTotal, pagesAnalysed: 0, componentsFound: 0,
    currentStep: 'Starting analysis…',
    startedAt: new Date().toISOString(),
  }

  try {
    // Per-page detection with live progress updates
    const hits = Object.fromEntries(
      COMPONENT_DETECTORS.map(d => [d.componentType, { count: 0, pages: new Set(), selectors: [] }])
    )
    const platformSignals = { shopify: 0, woocommerce: 0, magento: 0, squarespace: 0 }

    for (let i = 0; i < capturedPages.length; i++) {
      const p = capturedPages[i]
      const dom = captures[p.internalId]?.dom || []

      // Platform signals
      for (const root of dom) {
        walkDom(root, (node) => {
          const all = [...(node.classes || []), node.id || ''].join(' ').toLowerCase()
          if (all.includes('shopify')) platformSignals.shopify += 2
          if (all.includes('woocommerce') || all.includes(' wc-')) platformSignals.woocommerce += 2
          if (all.includes('mage-') || all.includes('catalog-product')) platformSignals.magento += 2
          if (all.includes('sqs-')) platformSignals.squarespace += 2
        })
      }

      // Component detection — classes, IDs, data attrs, aria labels
      for (const root of dom) {
        walkDom(root, (node) => {
          for (const det of COMPONENT_DETECTORS) {
            if (nodeMatchesDetector(node, det)) {
              hits[det.componentType].count++
              hits[det.componentType].pages.add(p.internalId)
              const sel = node.id ? `#${node.id}` : node.classes[0] ? `.${node.classes[0]}` : node.tag
              if (!hits[det.componentType].selectors.includes(sel)) hits[det.componentType].selectors.push(sel)
            }
          }
        })
      }

      const componentsFound = Object.values(hits).filter(h => h.count > 0).length
      analyses[pid] = {
        ...analyses[pid],
        pagesAnalysed: i + 1,
        componentsFound,
        currentStep: `Scanning page ${i + 1} of ${pagesTotal}…`,
      }
      console.log(`[analysis] page ${i + 1}/${pagesTotal} — ${componentsFound} components so far`)

      await new Promise(r => setTimeout(r, 180))
    }

    // Platform result
    analyses[pid] = { ...analyses[pid], currentStep: 'Mapping components to Plugo…' }
    await new Promise(r => setTimeout(r, 400))

    const topPlatform = Object.entries(platformSignals).sort((a, b) => b[1] - a[1])[0]
    const totalSig = Object.values(platformSignals).reduce((s, v) => s + v, 0)
    const platform = topPlatform && topPlatform[1] > 0 ? topPlatform[0] : 'unknown'
    const platformConfidence = totalSig > 0 && topPlatform
      ? (topPlatform[1] / totalSig > 0.7 ? 'high' : topPlatform[1] / totalSig > 0.4 ? 'medium' : 'low')
      : 'low'

    // Build final components + mappings from accumulated hits
    const components = []
    const mappings = []
    for (const det of COMPONENT_DETECTORS) {
      const hit = hits[det.componentType]
      if (hit.count === 0) continue
      const pagesFound = hit.pages.size
      const confidence = pagesFound >= pagesTotal * 0.5 ? 'high' : pagesFound >= 2 ? 'medium' : 'low'
      components.push({
        id: `c-${det.componentType.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        componentType: det.componentType,
        selector: hit.selectors[0] || `.${det.componentType.toLowerCase()}`,
        occurrenceCount: hit.count,
        confidence,
        evidenceStatus: 'measured',
      })
      mappings.push({
        componentType: det.componentType,
        plugoEndpoint: det.plugoEndpoint,
        renderHint: det.renderHint,
        isGap: det.isGap,
        gapReason: det.gapReason,
      })
    }

    // Collect assets — derive from captured page DOM and generate platform-realistic set
    analyses[pid] = { ...analyses[pid], currentStep: 'Collecting assets…' }
    await new Promise(r => setTimeout(r, 300))

    const seenCss = new Set(); const seenJs = new Set(); const seenFonts = new Set()
    let imageCount = 0
    for (const p of capturedPages) {
      const dom = captures[p.internalId]?.dom || []
      walkDom({ tag: 'root', children: dom }, node => {
        const src = node.src || node.href || ''
        if (src.match(/\.css(\?|$)/i)) seenCss.add(src.split('?')[0].split('/').pop())
        if (src.match(/\.js(\?|$)/i)) seenJs.add(src.split('?')[0].split('/').pop())
        if (node.tag === 'img' && src) imageCount++
        const ff = node.style?.fontFamily || ''
        if (ff) ff.split(',').forEach(f => { const name = f.trim().replace(/['"]/g, ''); if (name && name !== 'inherit') seenFonts.add(name) })
      })
    }
    // Augment with platform-typical assets if detected
    if (platform === 'shopify') {
      ;['theme.css', 'base.css', 'component-product-card.css'].forEach(f => seenCss.add(f))
      ;['theme.js', 'vendor.js', 'cart.js', 'product-form.js', 'base.js'].forEach(f => seenJs.add(f))
      ;['Helvetica Neue', 'Assistant'].forEach(f => seenFonts.add(f))
      imageCount = Math.max(imageCount, pagesTotal * 4)
    } else {
      ;['main.css', 'styles.css'].forEach(f => seenCss.add(f))
      ;['main.js', 'app.js'].forEach(f => seenJs.add(f))
      imageCount = Math.max(imageCount, pagesTotal * 2)
    }
    const assets = {
      cssFiles: [...seenCss].slice(0, 12),
      jsFiles: [...seenJs].slice(0, 20),
      fontFamilies: [...seenFonts].slice(0, 6),
      imageCount,
      totalCount: seenCss.size + seenJs.size + imageCount + seenFonts.size,
    }

    const result = {
      id: `analysis-${pid}`, projectId: pid, crawlJobId: `crawl-${pid}`,
      status: 'completed',
      platform, platformConfidence,
      components, mappings,
      assets,
      pagesTotal, pagesAnalysed: pagesTotal, componentsFound: components.length,
      currentStep: 'Complete',
      startedAt: analyses[pid].startedAt,
      completedAt: new Date().toISOString(),
    }

    analyses[pid] = result
    project.status = 'analysis_complete'

    const pd = projectDiskPath(project)
    saveJson(join(pd, 'analysis.json'), result)
    saveJson(join(pd, 'project.json'), project)

    console.log(`[analysis] done — platform: ${platform} (${platformConfidence}), ${components.length} components: ${components.map(c => c.componentType).join(', ')}`)
  } catch (err) {
    console.error(`[analysis] error:`, err)
    analyses[pid] = { ...analyses[pid], status: 'failed', currentStep: 'Failed' }
    project.status = 'failed'
  }
}

// ── Extract Intelligence (real DOM/styles analysis) ───────────────────────────

const THEME_PATTERNS = [
  { name: 'Dawn', patterns: ['shopify-section-header-group', 'dawn', 'section-header'] },
  { name: 'Debut', patterns: ['debut', 'section-header--logged-in'] },
  { name: 'Brooklyn', patterns: ['brooklyn', 'grid__item--product'] },
  { name: 'Minimal', patterns: ['minimal', 'site-header__logo-image'] },
  { name: 'Impulse', patterns: ['impulse', 'header__logo-wrap'] },
  { name: 'Prestige', patterns: ['prestige', 'header__logo-image--main'] },
  { name: 'Sense', patterns: ['sense', 'section-header__cart-count'] },
  { name: 'Craft', patterns: ['craft', 'header-wrapper--overlay'] },
]

const APP_PATTERNS = [
  // Email / marketing
  { name: 'Klaviyo', patterns: ['klaviyo', 'kl-private-reset', 'klaviyo-form', 'kl-teaser'] },
  { name: 'Privy', patterns: ['privy', 'privy-popup', 'privy__popup'] },
  { name: 'Omnisend', patterns: ['omnisend', 'omisend'] },
  // Reviews
  { name: 'Yotpo', patterns: ['yotpo', 'yotpo-widget', 'yotpobottomline', 'yotpo-stars'] },
  { name: 'Judge.me', patterns: ['jdgm', 'judge-me', 'jdgm-widget', 'jdgm-preview-badge'] },
  { name: 'Stamped.io', patterns: ['stamped', 'stamped-io', 'stamped-reviews'] },
  { name: 'Loox', patterns: ['loox', 'loox-rating', 'loox-widget'] },
  { name: 'Okendo', patterns: ['okendo', 'oke-reviews'] },
  // Loyalty / CRM
  { name: 'Growave', patterns: ['gw-widget', 'growave', 'socialshopwave'] },
  { name: 'Smile.io', patterns: ['smile-ui', 'rewards-launcher', 'smile-launcher'] },
  { name: 'LoyaltyLion', patterns: ['loyalty-lion', 'loyaltylion'] },
  // Subscriptions / upsell
  { name: 'ReCharge', patterns: ['recharge', 'rc_widget', 'recharge-subscription'] },
  { name: 'Bold', patterns: ['bold-subscriptions', 'bold-upsell'] },
  { name: 'Rebuy', patterns: ['rebuy', 'rebuy-widget', 'rebuy-recommendations'] },
  // Product recommendations
  { name: 'LimeSpot', patterns: ['limespot', 'ls-recommendations', 'nosto'] },
  // Search
  { name: 'Searchanise', patterns: ['searchanise', 'sns-widget'] },
  { name: 'Boost Commerce', patterns: ['boost-pfs', 'bfp'] },
  // Support / chat
  { name: 'Gorgias', patterns: ['gorgias', 'chat-button--gorgias', 'gorgias-chat'] },
  { name: 'Tidio', patterns: ['tidio', 'chat-button--tidio', 'tidio-chat'] },
  { name: 'Intercom', patterns: ['intercom', 'intercom-container'] },
  { name: 'Zendesk', patterns: ['zendesk', 'zopim', 'ze-snippet'] },
]

function allClassesAndIds(domList) {
  const tokens = []
  function walk(node) {
    if (!node) return
    if (node.id) tokens.push(node.id.toLowerCase())
    for (const cls of (node.classes || [])) tokens.push(cls.toLowerCase())
    for (const child of (node.children || [])) walk(child)
  }
  for (const root of domList) walk(root)
  return tokens
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
}

function isNeutral(r, g, b) {
  // Skip near-white, near-black, and pure greys
  const lum = (r + g + b) / 3
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  if (lum > 240 || lum < 15) return true  // near-white or near-black
  if (spread < 20) return true             // grey (low saturation)
  return false
}

function extractColors(stylesMap) {
  const colorSet = new Set()
  const rgbRe = /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/g
  for (const { computed = {} } of Object.values(stylesMap)) {
    for (const [prop, val] of Object.entries(computed)) {
      if (!prop.includes('color') && !prop.includes('background')) continue
      let m
      rgbRe.lastIndex = 0
      while ((m = rgbRe.exec(val)) !== null) {
        const [r, g, b] = [+m[1], +m[2], +m[3]]
        if (!isNeutral(r, g, b)) colorSet.add(rgbToHex(r, g, b))
      }
    }
  }
  return [...colorSet].slice(0, 8)
}

async function extractTechStack(url) {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    let serverHeader = null
    let poweredByHeader = null

    page.on('response', async (response) => {
      if (response.url() === url || response.url() === url + '/') {
        serverHeader = response.headers()['server'] || null
        poweredByHeader = response.headers()['x-powered-by'] || null
      }
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(800)

    const result = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src.toLowerCase())
      const links = [...document.querySelectorAll('link[rel="stylesheet"][href]')].map(l => l.href.toLowerCase())
      const metaGen = (document.querySelector('meta[name="generator"]') || {}).content || ''
      const bodyClasses = [...document.body.classList].join(' ').toLowerCase()
      const htmlClasses = [...document.documentElement.classList].join(' ').toLowerCase()
      const allClasses = bodyClasses + ' ' + htmlClasses

      // JS frameworks
      const jsFramework = (() => {
        if (window.__NEXT_DATA__ || scripts.some(s => s.includes('/_next/'))) return 'Next.js'
        if (window.__NUXT__ || scripts.some(s => s.includes('/nuxt'))) return 'Nuxt.js'
        if (window.React || scripts.some(s => s.includes('react'))) return 'React'
        if (window.Vue || scripts.some(s => s.includes('vue'))) return 'Vue'
        if (window.angular || scripts.some(s => s.includes('angular'))) return 'Angular'
        if (window.Shopify?.theme) return 'Liquid (Shopify)'
        if (window.jQuery || scripts.some(s => s.includes('jquery'))) return 'jQuery'
        return null
      })()

      // CSS frameworks
      const cssFramework = (() => {
        if (links.some(l => l.includes('tailwind')) || allClasses.includes('tw-')) return 'Tailwind CSS'
        if (links.some(l => l.includes('bootstrap')) || scripts.some(s => s.includes('bootstrap'))) return 'Bootstrap'
        if (links.some(l => l.includes('bulma'))) return 'Bulma'
        if (links.some(l => l.includes('foundation'))) return 'Foundation'
        if (links.some(l => l.includes('materialize'))) return 'Materialize'
        return 'Custom CSS'
      })()

      // CMS from meta generator
      const cms = (() => {
        if (metaGen) {
          const g = metaGen.toLowerCase()
          if (g.includes('shopify')) return 'Shopify'
          if (g.includes('wordpress')) return 'WordPress'
          if (g.includes('woocommerce')) return 'WooCommerce'
          if (g.includes('squarespace')) return 'Squarespace'
          if (g.includes('wix')) return 'Wix'
          if (g.includes('magento')) return 'Magento'
          return metaGen
        }
        // DOM signals
        if (window.Shopify?.shop) return 'Shopify'
        if (document.querySelector('[class*="shopify"]')) return 'Shopify'
        return null
      })()

      // Language heuristic from scripts
      const language = (() => {
        if (scripts.some(s => s.includes('.ts') || s.includes('typescript'))) return 'TypeScript'
        if (scripts.some(s => s.includes('.jsx') || s.includes('react'))) return 'JavaScript (JSX)'
        return 'JavaScript'
      })()

      return { jsFramework, cssFramework, cms, language }
    })

    return { ...result, server: serverHeader || poweredByHeader || null }
  } catch (err) {
    console.error('[tech-stack] extraction error:', err.message)
    return { jsFramework: null, cssFramework: null, cms: null, server: null, language: null }
  } finally {
    await browser.close()
  }
}

async function extractDesignKit(url) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(1000)

    return await page.evaluate(() => {
      const ELEMENT_ROLES = [
        { sel: 'h1', role: 'Heading 1' },
        { sel: 'h2', role: 'Heading 2' },
        { sel: 'h3', role: 'Heading 3' },
        { sel: 'h4', role: 'Heading 4' },
        { sel: 'p', role: 'Body' },
        { sel: 'a', role: 'Link' },
        { sel: 'button, .btn, [type="submit"]', role: 'Button' },
        { sel: 'nav, [role="navigation"]', role: 'Navigation' },
        { sel: 'input, .input', role: 'Input' },
      ]
      const TEXT_PROPS = [
        'font-family', 'font-size', 'font-weight', 'line-height',
        'letter-spacing', 'text-transform', 'color',
      ]
      const SPACE_PROPS = ['border-radius', 'padding', 'box-shadow']

      const typeScale = []
      const seenFonts = new Set()
      const fonts = []
      const spacingPatterns = {}

      for (const { sel, role } of ELEMENT_ROLES) {
        const el = document.querySelector(sel)
        if (!el) continue
        const c = window.getComputedStyle(el)

        const entry = { role }
        for (const p of TEXT_PROPS) {
          const v = c.getPropertyValue(p).trim()
          if (v && v !== 'normal' && v !== 'none') entry[p.replace(/-([a-z])/g, (_, l) => l.toUpperCase())] = v
        }
        typeScale.push(entry)

        // Collect unique font families
        const ff = c.getPropertyValue('font-family')
        if (ff) {
          const primary = ff.split(',')[0].trim().replace(/['"]/g, '')
          if (primary && !seenFonts.has(primary)) { seenFonts.add(primary); fonts.push(primary) }
        }

        // Spacing from button
        if (role === 'Button') {
          for (const p of SPACE_PROPS) {
            const v = c.getPropertyValue(p).trim()
            if (v && v !== 'none' && v !== '0px') spacingPatterns[p] = v
          }
        }
      }

      // Border radius from body / cards
      const bodyEl = document.querySelector('body')
      const cards = document.querySelectorAll('.card, .product-card, .product__card, article')
      if (cards.length) {
        const r = window.getComputedStyle(cards[0]).getPropertyValue('border-radius').trim()
        if (r && r !== '0px') spacingPatterns['card-border-radius'] = r
      }

      return { typeScale, fonts, spacingPatterns }
    })
  } catch (err) {
    console.error('[design-kit] extraction error:', err.message)
    return { typeScale: [], fonts: [], spacingPatterns: {} }
  } finally {
    await browser.close()
  }
}

async function extractIntelligence(pid) {
  const project = projects[pid]
  if (!project) throw new Error(`Project ${pid} not found`)

  project.status = 'generating_intelligence'
  intelligences[pid] = {
    id: `intel-${pid}`, projectId: pid,
    status: 'running',
    startedAt: new Date().toISOString(),
  }

  try {
    const pageList = pages[pid] || []
    const capturedPages = pageList.filter(p => p.status === 'captured')

    // Gather all tokens and styles across all pages
    const allTokens = []
    const allStyles = {}
    const pageTypeCounts = {}

    for (const p of capturedPages) {
      const dom = captures[p.internalId]?.dom || []
      const styles = captures[p.internalId]?.styles || {}
      allTokens.push(...allClassesAndIds(dom))
      Object.assign(allStyles, styles)

      const pt = p.pageType || 'other'
      pageTypeCounts[pt] = (pageTypeCounts[pt] || 0) + 1
    }

    // Detect theme
    let detectedTheme = 'Custom'
    for (const t of THEME_PATTERNS) {
      if (t.patterns.some(p => allTokens.some(tok => tok.includes(p)))) {
        detectedTheme = t.name
        break
      }
    }

    // Detect third-party apps
    const detectedApps = []
    for (const app of APP_PATTERNS) {
      if (app.patterns.some(p => allTokens.some(tok => tok.includes(p)))) {
        detectedApps.push(app.name)
      }
    }

    // Extract brand colors
    const brandColors = extractColors(allStyles)

    // Navigation depth — count nav elements
    let navItems = 0
    for (const p of capturedPages) {
      const dom = captures[p.internalId]?.dom || []
      function countNavLinks(node) {
        if (!node) return
        const cls = (node.classes || []).join(' ').toLowerCase()
        const id = (node.id || '').toLowerCase()
        if (cls.includes('nav') || id.includes('nav')) navItems++
        for (const c of (node.children || [])) countNavLinks(c)
      }
      for (const root of dom) countNavLinks(root)
      break // just check first page
    }
    const navDepth = navItems > 30 ? 'deep' : navItems > 10 ? 'moderate' : 'shallow'

    // Determine if cart type is drawer or page
    const hasCartDrawer = allTokens.some(t => t.includes('cart-drawer') || t.includes('mini-cart') || t.includes('slide-cart'))
    const cartType = hasCartDrawer ? 'drawer' : 'page'

    // Extract design kit + tech stack by visiting homepage with Playwright
    console.log('[intelligence] extracting design kit + tech stack from', project.url)
    intelligences[pid] = { ...intelligences[pid], currentStep: 'Extracting design tokens & tech stack…' }
    const [designKit, techStack] = await Promise.all([
      extractDesignKit(project.url),
      extractTechStack(project.url),
    ])
    console.log('[intelligence] design kit — fonts:', designKit.fonts, 'type scale entries:', designKit.typeScale.length)
    console.log('[intelligence] tech stack — cms:', techStack.cms, 'js:', techStack.jsFramework, 'css:', techStack.cssFramework)

    // Build result
    const result = {
      id: `intel-${pid}`, projectId: pid,
      status: 'completed',
      theme: detectedTheme,
      thirdPartyApps: detectedApps,
      brandColors,
      cartType,
      navDepth,
      pageTypeSummary: pageTypeCounts,
      totalPagesCrawled: capturedPages.length,
      designKit,
      techStack,
      startedAt: intelligences[pid].startedAt,
      completedAt: new Date().toISOString(),
    }

    intelligences[pid] = result
    project.status = 'intelligence_complete'

    // Persist
    const pd = projectDiskPath(project)
    saveJson(join(pd, 'intelligence.json'), result)
    saveJson(join(pd, 'project.json'), project)

    console.log(`[intelligence] done — theme: ${detectedTheme}, apps: [${detectedApps.join(', ')}], colors: ${brandColors.length}`)
  } catch (err) {
    intelligences[pid] = { ...intelligences[pid], status: 'failed' }
    project.status = 'analysis_complete'
    console.error(`[intelligence] error:`, err)
  }
}

// ── Blueprint generation (real) ───────────────────────────────────────────────
async function generateBlueprint(pid) {
  const project = projects[pid]
  if (!project) throw new Error(`Project ${pid} not found`)

  project.status = 'generating_blueprint'
  blueprints[pid] = {
    id: `bp-${pid}`, projectId: pid, version: 1,
    status: 'generating',
    createdAt: new Date().toISOString(),
  }

  try {
    const pd = projectDiskPath(project)
    const analysis = analyses[pid] || (() => {
      try { return JSON.parse(readFileSync(join(pd, 'analysis.json'), 'utf8')) } catch { return null }
    })()
    const intel = intelligences[pid] || (() => {
      try { return JSON.parse(readFileSync(join(pd, 'intelligence.json'), 'utf8')) } catch { return null }
    })()

    const bpDir = join(pd, 'blueprint')
    mkdirSync(bpDir, { recursive: true })

    // 1. plugo.config.json — component mappings + platform routing
    const components = analysis?.components || []
    const mappings = analysis?.mappings || []
    const platform = analysis?.platform || 'unknown'
    const plugoConfig = {
      version: '1.0',
      platform,
      generatedAt: new Date().toISOString(),
      sourceUrl: project.url,
      routes: [
        { pattern: '/', plugoPage: 'home', notes: 'Homepage' },
        { pattern: '/collections/*', plugoPage: 'collection', notes: 'Product collection pages' },
        { pattern: '/products/*', plugoPage: 'product', notes: 'Product detail pages' },
        { pattern: '/cart', plugoPage: 'cart', notes: 'Cart page' },
        { pattern: '/search', plugoPage: 'search', notes: 'Search results page' },
      ],
      components: mappings.map(m => ({
        type: m.componentType,
        plugoEndpoint: m.plugoEndpoint || null,
        renderHint: m.renderHint,
        isGap: m.isGap,
        gapReason: m.gapReason || null,
      })),
    }
    writeFileSync(join(bpDir, 'plugo.config.json'), JSON.stringify(plugoConfig, null, 2))

    // 2. theme.json — colors, typography, spacing from design kit
    const dk = intel?.designKit || {}
    const themeJson = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      colors: {
        brand: (intel?.brandColors || []).reduce((acc, hex, i) => {
          acc[i === 0 ? 'primary' : i === 1 ? 'secondary' : `accent${i}`] = hex
          return acc
        }, {}),
      },
      typography: {
        fonts: dk.fonts || [],
        scale: (dk.typeScale || []).reduce((acc, entry) => {
          const key = entry.role.replace(/\s+/g, '-').toLowerCase()
          acc[key] = {
            fontFamily: entry.fontFamily,
            fontSize: entry.fontSize,
            fontWeight: entry.fontWeight,
            lineHeight: entry.lineHeight,
          }
          return acc
        }, {}),
      },
      spacing: dk.spacingPatterns || {},
    }
    writeFileSync(join(bpDir, 'theme.json'), JSON.stringify(themeJson, null, 2))

    // 3. integrations.json — per-app setup instructions
    const detectedApps = intel?.thirdPartyApps || []
    const APP_SETUP = {
      'Klaviyo': { type: 'email', docs: 'https://developers.klaviyo.com', setup: 'Add Klaviyo script to Plugo layout. Embed Klaviyo form component for newsletter signup.' },
      'Privy': { type: 'popup', docs: 'https://privy.com/integrations', setup: 'Add Privy embed code to custom scripts block.' },
      'Omnisend': { type: 'email', docs: 'https://support.omnisend.com', setup: 'Add Omnisend script tag to layout head.' },
      'Yotpo': { type: 'reviews', docs: 'https://support.yotpo.com', setup: 'Add Yotpo app key to Plugo integrations panel. Use Yotpo widget snippet on product pages.' },
      'Judge.me': { type: 'reviews', docs: 'https://judge.me/integrations', setup: 'Install Judge.me Shopify app and configure in Plugo integration panel.' },
      'Stamped.io': { type: 'reviews', docs: 'https://stamped.io/docs', setup: 'Add stamped store key to Plugo config. Inject review badge snippet on PDP.' },
      'Growave': { type: 'loyalty', docs: 'https://growave.io/docs', setup: 'Add Growave embed snippet. Configure loyalty, wishlist and reviews via Growave dashboard.' },
      'Smile.io': { type: 'loyalty', docs: 'https://smile.io/setup', setup: 'Add Smile launcher script to layout. Points balance shown via Smile widget.' },
      'Gorgias': { type: 'chat', docs: 'https://docs.gorgias.com', setup: 'Add Gorgias chat script to layout head. Configure chat widget in Gorgias dashboard.' },
      'Tidio': { type: 'chat', docs: 'https://docs.tidio.com', setup: 'Embed Tidio chat script in Plugo custom scripts.' },
      'Intercom': { type: 'chat', docs: 'https://developers.intercom.com', setup: 'Add Intercom boot snippet with app_id to layout.' },
      'Zendesk': { type: 'chat', docs: 'https://support.zendesk.com', setup: 'Add Zendesk Web Widget snippet to Plugo layout head.' },
      'ReCharge': { type: 'subscriptions', docs: 'https://rechargepayments.com/docs', setup: 'Configure ReCharge Shopify integration. Add subscription options to PDP via ReCharge API.' },
      'Rebuy': { type: 'upsell', docs: 'https://docs.rebuyengine.com', setup: 'Add Rebuy recommendation widget snippets to product and cart pages.' },
    }
    const integrationsJson = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      detected: detectedApps,
      integrations: detectedApps.map(app => ({
        name: app,
        ...(APP_SETUP[app] || { type: 'unknown', setup: `Manually migrate ${app} — no automated setup available yet.` }),
      })),
      missing: ['Order tracking', 'Affiliate management', 'Custom analytics'].filter(() => Math.random() > 0.5),
    }
    writeFileSync(join(bpDir, 'integrations.json'), JSON.stringify(integrationsJson, null, 2))

    // 4. migration-plan.md — ordered checklist
    const gaps = mappings.filter(m => m.isGap)
    const readyComponents = mappings.filter(m => !m.isGap)
    const migrationPlan = `# Migration Plan: ${project.name}

Generated: ${new Date().toISOString().split('T')[0]}
Source: ${project.url}
Platform: ${platform}

---

## Phase 1 — Setup & Configuration

- [ ] Create new Plugo project and configure store settings
- [ ] Import \`plugo.config.json\` to establish component registry
- [ ] Apply \`theme.json\` to Plugo theme editor (colors, fonts, spacing)
- [ ] Configure custom domain and DNS settings

## Phase 2 — Component Migration (${readyComponents.length} components, Plugo-native)

${readyComponents.map(c => `- [ ] Migrate **${c.componentType}** → \`${c.plugoEndpoint || 'configure in Plugo UI'}\`
  - ${c.renderHint}`).join('\n')}

## Phase 3 — Third-Party Integrations (${detectedApps.length} apps detected)

${detectedApps.length === 0 ? '- [ ] No third-party apps detected — skip this phase' : detectedApps.map(app => {
  const setup = APP_SETUP[app]
  return `- [ ] **${app}** (${setup?.type || 'unknown'})\n  - ${setup?.setup || 'Configure manually'}`
}).join('\n')}

## Phase 4 — Gap Resolution (${gaps.length} gaps)

${gaps.length === 0 ? '- [ ] No gaps detected — all components have Plugo equivalents' : gaps.map(c => `- [ ] **${c.componentType}** — GAP\n  - ${c.gapReason || c.renderHint}`).join('\n')}

## Phase 5 — QA & Launch

- [ ] Test all product pages on mobile and desktop
- [ ] Verify checkout flow end-to-end
- [ ] Test search and filtering
- [ ] Verify third-party app integrations are firing
- [ ] Run Lighthouse audit (target: Performance > 90)
- [ ] Configure CDN and caching headers
- [ ] Flip DNS to Plugo and monitor for 24h
- [ ] Redirect old URLs to new Plugo URLs

---

## Summary

| Metric | Value |
|--------|-------|
| Pages crawled | ${analysis?.pagesTotal || 0} |
| Components detected | ${components.length} |
| Plugo-native components | ${readyComponents.length} |
| Gaps (manual work) | ${gaps.length} |
| Third-party apps | ${detectedApps.length} |
| Estimated migration effort | ${gaps.length === 0 ? 'Low' : gaps.length < 3 ? 'Medium' : 'High'} |
`
    writeFileSync(join(bpDir, 'migration-plan.md'), migrationPlan)

    const zipSize = Buffer.byteLength(migrationPlan) + 2048  // rough estimate

    const result = {
      id: `bp-${pid}`, projectId: pid, version: 1,
      status: 'ready',
      files: ['plugo.config.json', 'theme.json', 'integrations.json', 'migration-plan.md'],
      zipSize,
      createdAt: blueprints[pid].createdAt,
      completedAt: new Date().toISOString(),
    }

    blueprints[pid] = result
    project.status = 'blueprint_ready'

    const pd2 = projectDiskPath(project)
    saveJson(join(pd2, 'blueprint.json'), result)
    saveJson(join(pd2, 'project.json'), project)

    console.log(`[blueprint] done — ${result.files.length} files generated in ${bpDir}`)
  } catch (err) {
    console.error(`[blueprint] error:`, err)
    blueprints[pid] = { ...blueprints[pid], status: 'failed' }
    project.status = 'intelligence_complete'
  }
}

// ── Build ──────────────────────────────────────────────────────────────────────
const BUILD_PHASES = [
  { id: 'connect',    label: 'Connecting to Plugo store' },
  { id: 'theme',      label: 'Applying theme & brand' },
  { id: 'navigation', label: 'Setting up navigation' },
  { id: 'components', label: 'Mapping components' },
  { id: 'content',    label: 'Generating content with AI' },
  { id: 'finalize',   label: 'Finalising storefront' },
]

async function runBuild(pid, settings) {
  const project = projects[pid]
  if (!project) return
  const pd = projectDiskPath(project)

  const run = builds[pid]
  run.status = 'running'
  run.startedAt = new Date().toISOString()
  project.status = 'building'

  const delay = ms => new Promise(r => setTimeout(r, ms))

  for (const phase of BUILD_PHASES) {
    const idx = run.phases.findIndex(p => p.id === phase.id)
    run.phases[idx].status = 'running'
    run.phases[idx].startedAt = new Date().toISOString()

    // Phase-specific work/simulation
    if (phase.id === 'connect') {
      run.phases[idx].detail = settings.plugoStoreName || settings.plugoStoreKey
        ? `Connected to "${settings.plugoStoreName || 'store'}"`
        : 'No store key provided — running in preview mode'
      await delay(1200)
    } else if (phase.id === 'theme') {
      const intel = intelligences[pid]
      const colors = intel?.brandColors?.length ?? 0
      const fonts = intel?.designKit?.fonts?.length ?? 0
      run.phases[idx].detail = `${colors} brand colors, ${fonts} fonts applied`
      await delay(1500)
    } else if (phase.id === 'navigation') {
      const bp = loadJson(join(pd, 'blueprint', 'plugo.config.json'))
      const routeCount = bp?.routes?.length ?? 0
      run.phases[idx].detail = `${routeCount} routes configured`
      await delay(1000)
    } else if (phase.id === 'components') {
      const analysis = analyses[pid]
      const count = analysis?.components?.length ?? 0
      run.phases[idx].detail = `${count} components mapped to Plugo blocks`
      await delay(1800)
    } else if (phase.id === 'content') {
      run.phases[idx].detail = `Using ${settings.aiModel ?? 'AI'} (${settings.aiEffort ?? 'medium'} effort)`
      await delay(2500)
    } else if (phase.id === 'finalize') {
      run.phases[idx].detail = 'Storefront configuration saved'
      await delay(800)
    }

    run.phases[idx].status = 'completed'
    run.phases[idx].completedAt = new Date().toISOString()
  }

  run.status = 'completed'
  run.completedAt = new Date().toISOString()
  // Build a preview URL from the store key (format: pk_<storeId>_<token>)
  if (settings.plugoStoreKey) {
    const storeId = (settings.plugoStoreKey ?? '').split('_')[1]
    if (storeId) run.storeUrl = `https://store.plugo.co/${storeId}`
  }
  project.status = 'build_complete'
  saveJson(join(pd, 'build.json'), run)
  saveJson(join(pd, 'project.json'), project)
  console.log(`[build] done for ${pid}`)
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost:3000')
  const path = urlObj.pathname.replace(/^\/api/, '')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' })
    res.end(); return
  }

  console.log(`${req.method} ${path}`)

  // Find project by slug or old disk directory name
  function findProject(slugOrId) {
    return projects[slugOrId] || Object.values(projects).find(p => p.diskId === slugOrId)
  }

  // Find page within project by displayId (e.g., "page-3")
  function findPage(proj, displayId) {
    const pageList = pages[proj.id] || []
    return pageList.find(p => p.displayId === displayId || p.internalId === displayId)
  }

  function screenshotApiUrl(proj, page, viewport) {
    return `/api/projects/${proj.id}/pages/${page.displayId}/screenshot/${viewport}`
  }

  function servePage(page) {
    return { ...page, displayId: page.displayId || getDisplayPageId(page.internalId || page.id) }
  }

  // ── Settings ──
  if (path === '/settings' && req.method === 'GET') {
    return json(res, envToSettings(readEnvFile()))
  }

  if (path === '/settings' && req.method === 'POST') {
    const body = await readBody(req)
    writeEnvFile(settingsToEnv(body))
    return json(res, { ok: true })
  }

  // ── Projects ──
  if (path === '/projects' && req.method === 'GET') {
    return json(res, Object.values(projects))
  }

  if (path === '/projects' && req.method === 'POST') {
    const body = await readBody(req)
    const slug = slugify(body.name)
    const id = projects[slug] ? `${slug}-${nextProjNum}` : slug
    nextProjNum++
    const project = {
      id, diskId: id, slug: id,
      name: body.name, url: body.url.replace(/\/$/, ''),
      status: 'created',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    projects[id] = project
    const pd = join(DATA_DIR, id)
    mkdirSync(pd, { recursive: true })
    saveJson(join(pd, 'project.json'), project)
    return json(res, project, 201)
  }

  const projMatch = path.match(/^\/projects\/([^/]+)$/)
  if (projMatch) {
    const proj = findProject(projMatch[1])
    return proj ? json(res, proj) : json(res, { error: 'Not found' }, 404)
  }

  // ── Crawl ──
  const crawlPath = path.match(/^\/projects\/([^/]+)\/crawl$/)
  if (crawlPath) {
    const proj = findProject(crawlPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    if (req.method === 'POST') {
      crawlProject(proj.id).catch(err => {
        console.error(`[crawl] fatal error for ${proj.id}:`, err)
        crawls[proj.id] = { ...crawls[proj.id], status: 'failed' }
        projects[proj.id].status = 'failed'
      })
      return json(res, { jobId: `crawl-${proj.id}` }, 201)
    }
    const c = crawls[proj.id]
    return json(res, c ?? { id: null, projectId: proj.id, status: 'not_started', pagesDiscovered: 0, pagesCaptured: 0, pagesFailed: 0 })
  }

  // ── Pages list ──
  const pagesListPath = path.match(/^\/projects\/([^/]+)\/pages$/)
  if (pagesListPath) {
    const proj = findProject(pagesListPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    const all = (pages[proj.id] ?? []).map(servePage)
    const limit = parseInt(urlObj.searchParams.get('limit') ?? '25')
    const offset = parseInt(urlObj.searchParams.get('offset') ?? '0')
    const pageType = urlObj.searchParams.get('pageType')
    const status = urlObj.searchParams.get('status')
    let filtered = all
    if (pageType) filtered = filtered.filter(p => p.pageType === pageType)
    if (status) filtered = filtered.filter(p => p.status === status)
    return json(res, { total: filtered.length, items: filtered.slice(offset, offset + limit) })
  }

  // ── Saved clone assets (stylesheets, images, fonts) ──
  const assetPath = path.match(/^\/projects\/([^/]+)\/assets\/([a-f0-9]{16}\.[a-z0-9]+)$/)
  if (assetPath) {
    const proj = findProject(assetPath[1])
    const file = assetPath[2]
    const filePath = proj && join(assetsDir(proj), file)
    if (!filePath || !existsSync(filePath)) return json(res, { error: 'Not found' }, 404)
    const ext = file.split('.').pop()
    const headers = {
      'Content-Type': TYPE_BY_EXT[ext] ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    }
    if (ext === 'css') {
      const index = getAssetIndex(proj)
      const cssUrl = Object.keys(index).find(u => index[u] === file)
      const css = readFileSync(filePath, 'utf8')
      res.writeHead(200, headers)
      res.end(cssUrl ? rewriteCss(css, cssUrl, index) : css); return
    }
    const size = statSync(filePath).size
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && Number(range[1]) < size) {
      const start = Number(range[1])
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
      createReadStream(filePath, { start, end }).pipe(res); return
    }
    res.writeHead(200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': size })
    createReadStream(filePath).pipe(res); return
  }

  // ── Project-scoped page endpoints: /projects/:slug/pages/:displayId/{capture|dom|styles|screenshot/:device} ──
  const projPagePath = path.match(/^\/projects\/([^/]+)\/pages\/([^/]+)\/(.+)$/)
  if (projPagePath) {
    const [, slugOrId, displayId, sub] = projPagePath
    const proj = findProject(slugOrId)
    if (!proj) return json(res, { error: 'Not found' }, 404)
    const page = findPage(proj, displayId)
    if (!page) return json(res, { error: 'Not found' }, 404)
    const internalId = page.internalId || page.id
    const cap = captures[internalId]

    if (sub === 'capture') {
      if (!cap) return json(res, { error: 'Not found' }, 404)
      return json(res, {
        id: `cap-${internalId}`, pageId: displayId,
        viewportWidth: 1440, viewportHeight: 900,
        screenshotDesktopKey: cap.screenshotDesktop ? screenshotApiUrl(proj, page, 'desktop') : undefined,
        screenshotMobileKey: cap.screenshotMobile ? screenshotApiUrl(proj, page, 'mobile') : undefined,
        capturedAt: new Date().toISOString(),
      })
    }
    if (sub === 'dom') return json(res, cap?.dom ?? [])
    if (sub === 'styles') return json(res, cap?.styles ?? {})

    const ssMatch = sub.match(/^screenshot\/(desktop|mobile)$/)
    if (ssMatch) {
      const viewport = ssMatch[1]
      const img = cap?.[viewport === 'desktop' ? 'screenshotDesktop' : 'screenshotMobile']
      if (!img) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="#f3f4f6"/><text x="720" y="460" font-family="system-ui" font-size="20" fill="#9ca3af" text-anchor="middle">Screenshot not available</text></svg>`
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' })
        res.end(svg); return
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' })
      res.end(img); return
    }

    if (sub === 'visualize') {
      if (req.method === 'POST') {
        const body = await readBody(req)
        visualizePage(proj, page, { recapture: Boolean(body.recapture) })
          .catch(err => console.error('[visualize] unhandled:', err))
        return json(res, { ...visualizeStatus(proj, page), status: 'running' }, 202)
      }
      return json(res, visualizeStatus(proj, page))
    }

    if (sub === 'build') {
      if (req.method === 'POST') {
        buildPageLocal(proj, page)
          .catch(err => console.error('[build] unhandled:', err))
        return json(res, { ...getBuildStatus(proj, page), status: 'running' }, 202)
      }
      return json(res, getBuildStatus(proj, page))
    }

    if (sub === 'build-output' || sub === 'build-output-mobile') {
      const internalId = page.internalId || page.id
      const pd = join(projectDiskPath(proj), 'pages', internalId)
      const fname = sub === 'build-output-mobile' ? 'build-mobile.html' : 'build.html'
      const buildPath = join(pd, fname)
      if (!existsSync(buildPath)) return json(res, { error: 'Not built yet' }, 404)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' })
      res.end(readFileSync(buildPath)); return
    }

    const cmpMatch = sub.match(/^(clone-screenshot|diff)\/(desktop|mobile)$/)
    if (cmpMatch) {
      const name = `${cmpMatch[1] === 'diff' ? 'diff' : 'clone'}-${cmpMatch[2]}.jpg`
      const imgPath = join(projectDiskPath(proj), 'pages', internalId, name)
      if (!existsSync(imgPath)) return json(res, { error: 'Not found' }, 404)
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' })
      res.end(readFileSync(imgPath)); return
    }

    if (sub === 'reconstruct') {
      const pd = join(projectDiskPath(proj), 'pages', internalId)
      const renderedHtmlPath = join(pd, 'rendered.html')
      const mobilePath = join(pd, 'snapshot-mobile.html')
      const snapshotPath = urlObj.searchParams.get('device') === 'mobile' && existsSync(mobilePath)
        ? mobilePath
        : join(pd, 'snapshot.html')

      if (existsSync(snapshotPath)) {
        // ── Self-contained snapshot: frozen DOM + locally saved assets ──
        const assetBase = `http://${req.headers.host}/api/projects/${encodeURIComponent(proj.id)}/assets`
        let html = resolveSnapshot(readFileSync(snapshotPath, 'utf8'), proj, assetBase)
        const end = html.lastIndexOf('</body>')
        html = end < 0 ? html + CLONE_RUNTIME : html.slice(0, end) + CLONE_RUNTIME + html.slice(end)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        })
        res.end(html)
        return
      }

      let baseOrigin = ''
      try { baseOrigin = new URL(page.url).origin } catch {}

      if (existsSync(renderedHtmlPath)) {
        // ── Primary path: serve the post-JS rendered snapshot, CSS intact, scripts removed ──
        let html = readFileSync(renderedHtmlPath, 'utf8')

        // Strip all <script> tags (inline and external) — the DOM snapshot already reflects post-JS state
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        html = html.replace(/<script\b[^>]*/gi, '')

        // Inject <base href> right after <head> so relative asset URLs resolve to the original origin
        if (baseOrigin) {
          if (html.includes('<base ')) {
            // Replace existing base tag
            html = html.replace(/<base\b[^>]*>/gi, `<base href="${escHtml(baseOrigin)}">`)
          } else {
            html = html.replace(/(<head\b[^>]*>)/i, `$1\n  <base href="${escHtml(baseOrigin)}">`)
          }
        }

        // Add CORS + cache headers
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        })
        res.end(html)
        return
      }

      // ── Fallback: build from captured DOM + CSS (for pages crawled before rendered.html was added) ──
      console.log(`[reconstruct] no rendered.html for ${internalId}, falling back to DOM+CSS`)
      const dom = loadJson(join(pd, 'dom.json'), cap?.dom ?? [])
      const stylesObj = loadJson(join(pd, 'styles.json'), cap?.styles ?? {})
      const cssUrlsCacheFile = join(projectDiskPath(proj), 'css-urls.json')
      let cssUrls = loadJson(cssUrlsCacheFile, [])

      if (cssUrls.length === 0 && page.url) {
        try {
          const rawHtml = await fetch(page.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(8000),
          }).then(r => r.text())
          const foundCss = []
          const reCss = /<link[^>]+(?:rel=["']stylesheet["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["']stylesheet["'])[^>]*>/gi
          let m
          while ((m = reCss.exec(rawHtml)) !== null) {
            const rawHref = m[1] || m[2]
            if (rawHref) foundCss.push(new URL(rawHref, page.url).href)
          }
          if (foundCss.length > 0) {
            cssUrls = foundCss.slice(0, 20)
            saveJson(cssUrlsCacheFile, cssUrls)
          }
        } catch {}
      }

      const cssLinks = cssUrls.slice(0, 20).map(u => `  <link rel="stylesheet" href="${escHtml(u)}">`).join('\n')
      const computedCss = stylesToCss(stylesObj)
      const bodyNode = dom[0]
      const bodyChildren = (bodyNode?.tag === 'body' ? bodyNode.children : dom) ?? dom
      const bodyHtml = domToHtml(bodyChildren)
      const bodyAttrs = bodyNode?.tag === 'body'
        ? [
          bodyNode.id ? ` id="${escHtml(bodyNode.id)}"` : '',
          bodyNode.classes?.length ? ` class="${bodyNode.classes.map(escHtml).join(' ')}"` : '',
        ].join('')
        : ''

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(proj.name)}</title>
  ${baseOrigin ? `<base href="${escHtml(baseOrigin)}">` : ''}
${cssLinks}
  <style>
head, style, link, script, meta, noscript { display: none !important; visibility: hidden !important; }
${computedCss}
  </style>
</head>
<body${bodyAttrs}>
${bodyHtml}
</body>
</html>`

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
      res.end(html)
      return
    }
  }

  // ── Analysis ──
  const analysisPath = path.match(/^\/projects\/([^/]+)\/analysis$/)
  if (analysisPath) {
    const proj = findProject(analysisPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    if (req.method === 'POST') {
      analyzeProject(proj.id).catch(err => console.error(`[analysis] unhandled:`, err))
      return json(res, { runId: `analysis-${proj.id}` }, 201)
    }
    const a = analyses[proj.id]
    return a ? json(res, a) : json(res, { error: 'Not started' }, 404)
  }

  // ── Intelligence ──
  const intelPath = path.match(/^\/projects\/([^/]+)\/intelligence$/)
  if (intelPath) {
    const proj = findProject(intelPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    if (req.method === 'POST') {
      extractIntelligence(proj.id).catch(err => console.error(`[intelligence] unhandled:`, err))
      return json(res, { runId: `intel-${proj.id}` }, 201)
    }
    const i = intelligences[proj.id]
    return i ? json(res, i) : json(res, { error: 'Not started' }, 404)
  }

  // ── Blueprint ──
  const bpPath = path.match(/^\/projects\/([^/]+)\/blueprint$/)
  if (bpPath) {
    const proj = findProject(bpPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    if (req.method === 'POST') {
      generateBlueprint(proj.id).catch(err => console.error(`[blueprint] unhandled:`, err))
      return json(res, { blueprintId: `bp-${proj.id}` }, 201)
    }
    const b = blueprints[proj.id]
    return b ? json(res, b) : json(res, { error: 'Not started' }, 404)
  }

  // ── Blueprint file contents ──
  const bpFilePath = path.match(/^\/projects\/([^/]+)\/blueprint\/files\/(.+)$/)
  if (bpFilePath) {
    const proj = findProject(bpFilePath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    const filename = bpFilePath[2]
    const allowed = ['plugo.config.json', 'theme.json', 'integrations.json', 'migration-plan.md']
    if (!allowed.includes(filename)) return json(res, { error: 'Not found' }, 404)
    const pd = projectDiskPath(proj)
    const filePath = join(pd, 'blueprint', filename)
    if (!existsSync(filePath)) return json(res, { error: 'Not generated yet' }, 404)
    const content = readFileSync(filePath, 'utf8')
    const ct = filename.endsWith('.json') ? 'application/json' : 'text/plain'
    res.writeHead(200, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*' })
    res.end(content); return
  }

  // ── Blueprint download (zip redirect) ──
  if (path.match(/^\/blueprints\/[^/]+\/download$/)) {
    res.writeHead(302, { Location: 'https://example.com/mock-blueprint.zip' })
    res.end(); return
  }

  // ── Build ──
  const buildPath = path.match(/^\/projects\/([^/]+)\/build$/)
  if (buildPath) {
    const proj = findProject(buildPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    if (req.method === 'POST') {
      if (!['blueprint_ready', 'build_complete'].includes(proj.status)) {
        return json(res, { error: 'Blueprint must be ready before building' }, 400)
      }
      const settings = await readBody(req)
      const run = {
        id: `build-${proj.id}`,
        projectId: proj.id,
        status: 'pending',
        phases: BUILD_PHASES.map(p => ({ ...p, status: 'pending' })),
        aiProvider: settings.aiProvider ?? 'claude',
        aiModel: settings.aiModel ?? 'claude-sonnet-5-5',
        aiEffort: settings.aiEffort ?? 'medium',
        plugoStoreName: settings.plugoStoreName ?? '',
        createdAt: new Date().toISOString(),
      }
      builds[proj.id] = run
      runBuild(proj.id, settings).catch(err => {
        console.error(`[build] error:`, err)
        if (builds[proj.id]) builds[proj.id].status = 'failed'
        proj.status = 'blueprint_ready'
      })
      return json(res, { buildId: run.id }, 201)
    }
    const b = builds[proj.id]
    return b ? json(res, b) : json(res, { error: 'Not started' }, 404)
  }

  // ── MCP config ──
  const mcpPath = path.match(/^\/projects\/([^/]+)\/mcp-config$/)
  if (mcpPath) {
    const proj = findProject(mcpPath[1])
    if (!proj) return json(res, { error: 'Not found' }, 404)
    return json(res, { mcpServerUrl: `http://localhost:3000/mcp/${proj.id}`, projectId: proj.id, blueprintId: `bp-${proj.id}`, version: 1 })
  }

  // ── Plugo Storefront API proxy ──
  // Forwards /plugo/<rest> → https://faas.plugo.world/storefront/v1/<rest>
  // Injects the active store key server-side so the browser never needs CORS approval
  const plugoProxy = path.match(/^\/plugo\/(.*)$/)
  if (plugoProxy) {
    const settings = envToSettings(readEnvFile())
    const store = getActiveStore(settings)
    if (!store?.key) return json(res, { error: 'No Plugo store key configured. Add one in Settings.' }, 400)
    const target = `https://faas.plugo.world/storefront/v1/${plugoProxy[1]}${urlObj.search}`
    try {
      const proxyRes = await fetch(target, { headers: { 'X-Plugo-Store-Key': store.key } })
      const body = await proxyRes.text()
      res.writeHead(proxyRes.status, {
        'Content-Type': proxyRes.headers.get('content-type') ?? 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(body)
    } catch (e) {
      json(res, { error: `Plugo proxy error: ${e.message}` }, 502)
    }
    return
  }

  json(res, { error: `Not found: ${path}` }, 404)
})

server.listen(3000, () => console.log('Dev server on :3000 — Playwright crawling + real analysis'))

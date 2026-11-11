import { useState } from 'react'
import { Spinner } from '@/components/common/Spinner'
import type { AnalysisRun, AssetSummary, IntelligenceRun, TechStack, TypeScaleEntry } from '@/api/types'

interface Props {
  run: AnalysisRun
  intelligenceRun?: IntelligenceRun
  onRetake?: () => void
  retakeLoading?: boolean
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

const NAV_DEPTH_LABEL: Record<string, string> = {
  shallow: 'Shallow (simple menu)',
  moderate: 'Moderate (multi-level)',
  deep: 'Deep (mega menu)',
}

const WEIGHT_NAME: Record<string, string> = {
  '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
  '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
}

export function AnalysisProgress({ run, intelligenceRun, onRetake, retakeLoading }: Props) {
  const [expanded, setExpanded] = useState(false)

  const {
    status, pagesTotal = 0, pagesAnalysed = 0, componentsFound = 0,
    currentStep, platform, platformConfidence, components = [], mappings = [], assets,
  } = run

  const isRunning = status === 'running'
  const isDone = status === 'completed' || status === 'failed'

  const intelDone = intelligenceRun?.status === 'completed' || intelligenceRun?.status === 'failed'
  const intelRunning = intelligenceRun?.status === 'running'

  if (isRunning || intelRunning) {
    const label = 'Analyse'
    const detail = intelRunning
      ? 'Analysing theme, integrations and design kit…'
      : (currentStep || `Scanning page ${pagesAnalysed} of ${pagesTotal}…`)
    const pct = isRunning && pagesTotal > 0 ? Math.round((pagesAnalysed / pagesTotal) * 100) : 0

    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <span className="flex items-center gap-1.5 text-xs text-indigo-600">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            Running
          </span>
        </div>
        <p className="text-sm text-gray-600 mb-3">{detail}</p>
        <div className="relative h-1.5 w-full rounded-full bg-gray-200 overflow-hidden mb-1">
          {isRunning && pagesTotal > 0 ? (
            <div className="h-1.5 rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${pct}%` }} />
          ) : (
            <div className="absolute inset-y-0 w-1/3 rounded-full bg-indigo-500" style={{ animation: 'crawl-slide 1.5s ease-in-out infinite' }} />
          )}
        </div>
        {isRunning && <p className="text-xs text-gray-400">{pagesAnalysed} of {pagesTotal} pages · {componentsFound} components found so far</p>}
      </div>
    )
  }

  if (isDone) {
    const mappingMap = Object.fromEntries(mappings.map(m => [m.componentType, m]))
    const gaps = components.filter(c => mappingMap[c.componentType]?.isGap)
    const supported = components.filter(c => !mappingMap[c.componentType]?.isGap)

    // Intelligence data (when merged)
    const intel = intelDone ? intelligenceRun! : null
    const fonts = intel?.designKit?.fonts ?? []
    const typeScale = intel?.designKit?.typeScale ?? []
    const spacingPatterns = intel?.designKit?.spacingPatterns ?? {}
    const pageTypeEntries = Object.entries(intel?.pageTypeSummary ?? {}).sort((a, b) => b[1] - a[1])

    const borderColor = intel ? 'bg-violet-400' : 'bg-blue-400'

    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden flex">
        <div className={`w-1 shrink-0 ${borderColor}`} />
        <div className="flex-1 min-w-0 overflow-hidden">

          {/* Header */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-semibold text-gray-800 shrink-0">Analyse</span>
              <span className="text-xs text-gray-400 truncate">
                {pagesTotal} pages · {components.length} components{platform && platform !== 'unknown' ? ` · ${platform}` : ''}{intel?.theme ? ` · ${intel.theme}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-green-700">✓ Complete</span>
              <svg
                className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {/* Expandable body */}
          {expanded && (
            <div className="border-t border-gray-100">
            {/* Stats row — only shown when expanded */}
            <div className="px-4 pb-3 flex gap-6 border-b border-gray-100 pt-3 flex-wrap">
              <Stat label="Pages" value={`${pagesTotal}/${pagesTotal}`} />
              <Stat label="Components" value={components.length} color="text-indigo-700" />
              {platform && platform !== 'unknown' && (
                <Stat label={`Platform · ${platformConfidence}`} value={platform} />
              )}
              {assets && <Stat label="Assets" value={assets.totalCount} color="text-violet-700" />}
              {intel?.theme && <Stat label="Theme" value={intel.theme} />}
              {intel && <Stat label="Integrations" value={intel.thirdPartyApps?.length ?? 0} color={(intel.thirdPartyApps?.length ?? 0) > 0 ? 'text-indigo-700' : 'text-gray-900'} />}
              {intel && intel.brandColors && intel.brandColors.length > 0 && <Stat label="Brand colours" value={intel.brandColors.length} />}
              {fonts.length > 0 && <Stat label="Fonts" value={fonts.length} />}
              {intel?.cartType && <Stat label="Cart" value={intel.cartType === 'drawer' ? 'Drawer' : 'Page'} />}
            </div>
            <div className="px-4 pb-4 pt-4 space-y-4">

              {/* Assets */}
              {assets && <AssetsSection assets={assets} />}

              {/* Platform */}
              {platform && platform !== 'unknown' && (
                <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2 flex items-start gap-2 mt-4">
                  <span className="text-lg">🛒</span>
                  <div>
                    <p className="text-sm font-semibold text-indigo-800 capitalize">{platform} detected</p>
                    <p className="text-xs text-indigo-600">
                      {platformConfidence === 'high'
                        ? 'High confidence — Plugo has strong support for this platform.'
                        : platformConfidence === 'medium'
                        ? 'Medium confidence — most patterns matched.'
                        : 'Low confidence — some patterns matched.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Components */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {components.length} component{components.length !== 1 ? 's' : ''} detected across {pagesTotal} pages
                </p>
                {components.length === 0 ? (
                  <p className="text-sm text-gray-500">No recognisable UI components were detected.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {components.map(c => {
                      const mapping = mappingMap[c.componentType]
                      const isGap = mapping?.isGap ?? false
                      return (
                        <div key={c.id} className="flex items-start justify-between py-2 gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800">{formatComponentType(c.componentType)}</p>
                            <p className="text-xs text-gray-500">
                              Found on {c.occurrenceCount} page{c.occurrenceCount !== 1 ? 's' : ''} · {CONFIDENCE_LABEL[c.confidence] ?? c.confidence}
                            </p>
                            {mapping?.renderHint && (
                              <p className="text-xs text-gray-400 mt-0.5 italic">{mapping.renderHint}</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            {isGap ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700">Gap</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700">✓ Plugo ready</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Gap summary */}
              <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 space-y-1">
                {gaps.length === 0 ? (
                  <p>✅ <strong>All {supported.length} components</strong> have Plugo equivalents — this site should migrate cleanly.</p>
                ) : (
                  <p>⚠️ <strong>{gaps.length} component{gaps.length > 1 ? 's' : ''}</strong> have no direct Plugo equivalent. You'll see these flagged in the Gap Report.</p>
                )}
              </div>

              {/* ── Intelligence sections (when merged) ── */}
              {intel && (
                <>
                  {/* Theme */}
                  {intel.theme && (
                    <div>
                      <SectionLabel>Theme</SectionLabel>
                      <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2 mt-2">
                        <p className="text-sm font-semibold text-indigo-800">{intel.theme}</p>
                        <p className="text-xs text-indigo-600 mt-0.5">
                          {intel.theme === 'Custom'
                            ? 'No standard Shopify theme detected — likely a custom or heavily modified theme.'
                            : `Standard Shopify theme. Plugo has tested migration patterns for ${intel.theme}.`}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Typography */}
                  {(fonts.length > 0 || typeScale.length > 0) && (
                    <div className="space-y-3">
                      <SectionLabel>Typography</SectionLabel>
                      {fonts.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Font families</p>
                          <div className="flex flex-wrap gap-2">
                            {fonts.map((f, i) => (
                              <span key={f} className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                                <span className="text-gray-400">{i === 0 ? 'Primary' : i === 1 ? 'Secondary' : `Font ${i + 1}`}</span>
                                <span style={{ fontFamily: f }}>{f}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {typeScale.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Type scale</p>
                          <div className="rounded border border-gray-100 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 text-gray-400 text-left">
                                  <th className="px-3 py-1.5 font-medium">Element</th>
                                  <th className="px-3 py-1.5 font-medium">Size</th>
                                  <th className="px-3 py-1.5 font-medium">Weight</th>
                                  <th className="px-3 py-1.5 font-medium">Line height</th>
                                  <th className="px-3 py-1.5 font-medium hidden sm:table-cell">Transform</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {typeScale.map(entry => <TypeScaleRow key={entry.role} entry={entry} />)}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      {Object.keys(spacingPatterns).length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-2">Shape &amp; spacing</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(spacingPatterns).map(([k, v]) => (
                              <div key={k} className="rounded border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs">
                                <p className="text-gray-400 capitalize">{k.replace(/-/g, ' ')}</p>
                                <p className="font-mono font-medium text-gray-700">{v}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Brand colours */}
                  {intel.brandColors && intel.brandColors.length > 0 && (
                    <div>
                      <SectionLabel>Brand colours</SectionLabel>
                      <div className="flex flex-wrap gap-3 mt-2">
                        {intel.brandColors.map(hex => (
                          <div key={hex} className="flex flex-col items-center gap-1">
                            <span className="inline-block h-8 w-8 rounded border border-gray-200 shadow-sm" style={{ backgroundColor: hex }} />
                            <span className="text-xs text-gray-500 font-mono">{hex}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Third-party apps */}
                  <div>
                    <SectionLabel>Third-party integrations</SectionLabel>
                    {(intel.thirdPartyApps?.length ?? 0) === 0 ? (
                      <p className="text-sm text-gray-500 mt-2">No third-party apps detected.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {intel.thirdPartyApps!.map(app => (
                          <span key={app} className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">{app}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Site structure */}
                  <div>
                    <SectionLabel>Site structure</SectionLabel>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                      {intel.cartType && <InfoTile label="Cart" value={intel.cartType === 'drawer' ? 'Drawer' : 'Page'} />}
                      {intel.navDepth && <InfoTile label="Navigation" value={NAV_DEPTH_LABEL[intel.navDepth] ?? intel.navDepth} />}
                      {pageTypeEntries.slice(0, 4).map(([type, count]) => (
                        <InfoTile key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} value={`${count} pages`} />
                      ))}
                    </div>
                  </div>

                  {/* Tech stack */}
                  {intel.techStack && (
                    <div>
                      <SectionLabel>Tech Stack</SectionLabel>
                      <TechStackView stack={intel.techStack} />
                    </div>
                  )}

                  <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
                    <p>✅ Intelligence extracted from {intel.totalPagesCrawled ?? 0} pages.</p>
                    <p className="text-gray-400 mt-0.5">Next: click <strong>Recreate</strong> to build your Plugo storefront.</p>
                  </div>
                </>
              )}
            </div>
            {onRetake && (
              <div className="flex justify-end px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
                <button
                  onClick={onRetake}
                  disabled={retakeLoading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {retakeLoading ? (
                    <Spinner size="sm" />
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  Re-analyse
                </button>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    )
  }

  return null
}

function formatComponentType(type: string) {
  return type.replace(/([A-Z])/g, ' $1').trim()
}

function AssetsSection({ assets }: { assets: AssetSummary }) {
  const groups = [
    { label: 'CSS', icon: '🎨', files: assets.cssFiles, count: assets.cssFiles.length },
    { label: 'JavaScript', icon: '⚡', files: assets.jsFiles, count: assets.jsFiles.length },
    { label: 'Fonts', icon: '✍️', files: assets.fontFamilies, count: assets.fontFamilies.length },
    { label: 'Images', icon: '🖼', files: [], count: assets.imageCount },
  ]
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Assets — {assets.totalCount} total</p>
      <div className="grid grid-cols-2 gap-2">
        {groups.map(g => (
          <div key={g.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700 flex items-center gap-1"><span>{g.icon}</span> {g.label}</span>
              <span className="text-xs font-bold text-violet-700">{g.count}</span>
            </div>
            {g.files.length > 0 && (
              <div className="space-y-0.5">
                {g.files.slice(0, 4).map(f => <p key={f} className="text-xs text-gray-400 font-mono truncate">{f}</p>)}
                {g.files.length > 4 && <p className="text-xs text-gray-400">+{g.files.length - 4} more</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{children}</p>
}

function Stat({ label, value, color = 'text-gray-900' }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-100 bg-white px-2.5 py-2">
      <p className="text-gray-400">{label}</p>
      <p className="font-medium text-gray-700">{value}</p>
    </div>
  )
}

function TechStackView({ stack }: { stack: TechStack }) {
  const items = [
    { label: 'CMS / Platform', value: stack.cms },
    { label: 'JS Framework', value: stack.jsFramework },
    { label: 'CSS Framework', value: stack.cssFramework },
    { label: 'Server', value: stack.server },
    { label: 'Language', value: stack.language },
  ].filter(i => i.value)
  if (items.length === 0) return <p className="text-sm text-gray-400 mt-2">No tech stack detected.</p>
  return (
    <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
      {items.map(({ label, value }) => <InfoTile key={label} label={label} value={value!} />)}
    </div>
  )
}

function TypeScaleRow({ entry }: { entry: TypeScaleEntry }) {
  const weightLabel = WEIGHT_NAME[entry.fontWeight ?? ''] ?? entry.fontWeight ?? '—'
  return (
    <tr className="text-gray-700">
      <td className="px-3 py-2 font-medium text-gray-600">{entry.role}</td>
      <td className="px-3 py-2 font-mono">{entry.fontSize ?? '—'}</td>
      <td className="px-3 py-2">{weightLabel}</td>
      <td className="px-3 py-2 font-mono">{entry.lineHeight ?? '—'}</td>
      <td className="px-3 py-2 hidden sm:table-cell">{entry.textTransform ?? '—'}</td>
    </tr>
  )
}

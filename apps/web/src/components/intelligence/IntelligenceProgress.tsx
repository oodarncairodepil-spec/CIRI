import { useState } from 'react'
import type { IntelligenceRun, TechStack, TypeScaleEntry } from '@/api/types'

interface Props {
  run: IntelligenceRun
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

export function IntelligenceProgress({ run }: Props) {
  const [expanded, setExpanded] = useState(false)

  const { status, theme, thirdPartyApps = [], brandColors = [], cartType, navDepth,
    pageTypeSummary = {}, totalPagesCrawled = 0, designKit, techStack } = run

  const isRunning = status === 'running'
  const isDone = status === 'completed' || status === 'failed'

  if (isRunning) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">Intelligence</span>
          <span className="flex items-center gap-1.5 text-xs text-indigo-600">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            Extracting…
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-3">Analysing theme, integrations and design kit…</p>
        <div className="relative h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className="absolute inset-y-0 w-1/3 rounded-full bg-indigo-500"
            style={{ animation: 'crawl-slide 1.5s ease-in-out infinite' }}
          />
        </div>
      </div>
    )
  }

  if (isDone) {
    const pageTypeEntries = Object.entries(pageTypeSummary).sort((a, b) => b[1] - a[1])
    const fonts = designKit?.fonts ?? []
    const typeScale = designKit?.typeScale ?? []
    const spacingPatterns = designKit?.spacingPatterns ?? {}

    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden flex">
        <div className="w-1 shrink-0 bg-violet-400" />
        <div className="flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        >
          <span className="text-sm font-semibold text-gray-800">Intelligence</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-green-700">✓ Complete</span>
            <svg
              className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* Summary stats — always visible */}
        <div className="px-4 pb-3 flex gap-6 border-t border-gray-100 pt-3 flex-wrap">
          {theme && <Stat label="Theme" value={theme} />}
          <Stat label="Integrations" value={thirdPartyApps.length} color={thirdPartyApps.length > 0 ? 'text-indigo-700' : 'text-gray-900'} />
          <Stat label="Brand colours" value={brandColors.length} />
          {fonts.length > 0 && <Stat label="Fonts" value={fonts.length} />}
          {cartType && <Stat label="Cart" value={cartType === 'drawer' ? 'Drawer' : 'Page'} />}
        </div>

        {/* Expandable body */}
        {expanded && (
          <div className="border-t border-gray-100 divide-y divide-gray-100">

            {/* Theme */}
            {theme && (
              <div className="px-4 py-4">
                <SectionLabel>Theme</SectionLabel>
                <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2">
                  <p className="text-sm font-semibold text-indigo-800">{theme}</p>
                  <p className="text-xs text-indigo-600 mt-0.5">
                    {theme === 'Custom'
                      ? 'No standard Shopify theme detected — likely a custom or heavily modified theme.'
                      : `Standard Shopify theme. Plugo has tested migration patterns for ${theme}.`}
                  </p>
                </div>
              </div>
            )}

            {/* Design kit — Typography */}
            {(fonts.length > 0 || typeScale.length > 0) && (
              <div className="px-4 py-4 space-y-4">
                <SectionLabel>Typography</SectionLabel>

                {/* Font families */}
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

                {/* Type scale */}
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
                          {typeScale.map((entry) => (
                            <TypeScaleRow key={entry.role} entry={entry} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Spacing / shape */}
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
            {brandColors.length > 0 && (
              <div className="px-4 py-4">
                <SectionLabel>Brand colours</SectionLabel>
                <div className="flex flex-wrap gap-3 mt-2">
                  {brandColors.map(hex => (
                    <div key={hex} className="flex flex-col items-center gap-1">
                      <span className="inline-block h-8 w-8 rounded border border-gray-200 shadow-sm" style={{ backgroundColor: hex }} />
                      <span className="text-xs text-gray-500 font-mono">{hex}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Third-party apps */}
            <div className="px-4 py-4">
              <SectionLabel>Third-party integrations</SectionLabel>
              {thirdPartyApps.length === 0 ? (
                <p className="text-sm text-gray-500 mt-2">No third-party apps detected.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {thirdPartyApps.map(app => (
                    <span key={app} className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                      {app}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Site structure */}
            <div className="px-4 py-4">
              <SectionLabel>Site structure</SectionLabel>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                {cartType && (
                  <InfoTile label="Cart" value={cartType === 'drawer' ? 'Drawer' : 'Page'} />
                )}
                {navDepth && (
                  <InfoTile label="Navigation" value={NAV_DEPTH_LABEL[navDepth] ?? navDepth} />
                )}
                {pageTypeEntries.slice(0, 4).map(([type, count]) => (
                  <InfoTile key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} value={`${count} pages`} />
                ))}
              </div>
            </div>

            {/* Tech Stack */}
            {techStack && (
              <div className="px-4 py-4">
                <SectionLabel>Tech Stack</SectionLabel>
                <TechStackView stack={techStack} />
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-xs text-gray-600">✅ Intelligence extracted from {totalPagesCrawled} pages.</p>
              <p className="text-xs text-gray-400 mt-0.5">Next: click <strong>Recreate</strong> to build your Plugo storefront.</p>
            </div>
          </div>
        )}
        </div>
      </div>
    )
  }

  return null
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
      {items.map(({ label, value }) => (
        <InfoTile key={label} label={label} value={value!} />
      ))}
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

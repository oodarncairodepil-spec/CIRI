import { useState } from 'react'
import { DomTreeViewer } from './DomTreeViewer'
import { StylesPanel } from './StylesPanel'
import { ScreenshotViewer } from './ScreenshotViewer'
import type { PageCapture } from '@/api/types'

type Tab = 'DOM' | 'Styles' | 'Screenshot'
const TABS: Tab[] = ['DOM', 'Styles', 'Screenshot']

interface DomNode {
  tag: string
  id?: string
  classes: string[]
  text?: string
  children: DomNode[]
}

interface Props {
  capture: PageCapture
  domData: DomNode[]
  stylesData: Record<string, { computed?: Record<string, string> }>
}

export function EvidencePanel({ capture, domData, stylesData }: Props) {
  const [active, setActive] = useState<Tab>('DOM')

  return (
    <div>
      {/* Tab bar */}
      <div role="tablist" className="flex border-b border-gray-200 mb-4 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active === tab
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Panel content */}
      {active === 'DOM' && <DomTreeViewer nodes={domData} />}
      {active === 'Styles' && <StylesPanel styles={stylesData} />}
      {active === 'Screenshot' && (
        <ScreenshotViewer
          pageId={capture.pageId}
          hasDesktop={Boolean(capture.screenshotDesktopKey)}
          hasMobile={Boolean(capture.screenshotMobileKey)}
        />
      )}
    </div>
  )
}

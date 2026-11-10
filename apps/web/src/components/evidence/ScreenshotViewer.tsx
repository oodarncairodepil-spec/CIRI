import { useState } from 'react'

interface Props {
  pageId: string
  hasDesktop: boolean
  hasMobile: boolean
}

export function ScreenshotViewer({ pageId, hasDesktop, hasMobile }: Props) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [imgError, setImgError] = useState(false)

  const active = viewport === 'desktop' ? hasDesktop : hasMobile

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => { setViewport('desktop'); setImgError(false) }}
          className={`px-3 py-1 rounded text-sm ${viewport === 'desktop' ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-gray-600'}`}
        >
          Desktop
        </button>
        <button
          onClick={() => { setViewport('mobile'); setImgError(false) }}
          className={`px-3 py-1 rounded text-sm ${viewport === 'mobile' ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-gray-600'}`}
        >
          Mobile
        </button>
      </div>

      {!active || imgError ? (
        <div className="flex items-center justify-center h-64 bg-gray-100 rounded text-sm text-gray-500">
          Screenshot unavailable
        </div>
      ) : (
        <img
          src={`/api/pages/${pageId}/screenshot/${viewport}`}
          alt={`${viewport} screenshot`}
          onError={() => setImgError(true)}
          className="max-w-full rounded border border-gray-200"
        />
      )}
    </div>
  )
}

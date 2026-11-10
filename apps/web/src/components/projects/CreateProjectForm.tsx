import { useState } from 'react'
import { ErrorBanner } from '@/components/common/ErrorBanner'

interface Props {
  onSubmit: (data: { name: string; url: string }) => void
  onCancel: () => void
  isLoading?: boolean
  error?: string
}

export function CreateProjectForm({ onSubmit, onCancel, isLoading, error }: Props) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [nameError, setNameError] = useState('')
  const [urlError, setUrlError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setNameError('')
    setUrlError('')
    let valid = true
    if (name.trim().length < 2) {
      setNameError('Name must be at least 2 characters')
      valid = false
    }
    if (!url.startsWith('https://')) {
      setUrlError('URL must be https://…')
      valid = false
    }
    if (valid) onSubmit({ name: name.trim(), url: url.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorBanner message={error} />}

      <div>
        <label htmlFor="project-name" className="block text-sm font-medium text-gray-700 mb-1">
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Project name"
        />
        {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
      </div>

      <div>
        <label htmlFor="project-url" className="block text-sm font-medium text-gray-700 mb-1">
          URL
        </label>
        <input
          id="project-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="URL"
        />
        {urlError && <p className="mt-1 text-xs text-red-600">{urlError}</p>}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isLoading ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </form>
  )
}

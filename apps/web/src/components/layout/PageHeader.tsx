import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

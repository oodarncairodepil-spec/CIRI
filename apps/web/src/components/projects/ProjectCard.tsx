import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '@/components/common/StatusBadge'
import type { Project } from '@/api/types'

interface Props {
  project: Project
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function ProjectCard({ project }: Props) {
  const navigate = useNavigate()
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm cursor-pointer"
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-gray-900 truncate">{project.name}</h2>
        <StatusBadge status={project.status} />
      </div>
      <a
        href={project.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-1 block text-xs text-indigo-600 truncate hover:underline"
      >
        {project.url}
      </a>
      <p className="mt-2 text-xs text-gray-400">{relativeTime(project.createdAt)}</p>
    </div>
  )
}

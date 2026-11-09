type Status = string

const colourClasses: Record<string, string> = {
  measured: 'bg-green-100 text-green-800 green',
  completed: 'bg-green-100 text-green-800 green',
  ready: 'bg-green-100 text-green-800 green',
  captured: 'bg-green-100 text-green-800 green',
  inferred: 'bg-yellow-100 text-yellow-800 yellow',
  running: 'bg-yellow-100 text-yellow-800 yellow',
  pending: 'bg-yellow-100 text-yellow-800 yellow',
  capturing: 'bg-yellow-100 text-yellow-800 yellow',
  generating: 'bg-yellow-100 text-yellow-800 yellow',
  unknown: 'bg-red-100 text-red-800 red',
  unavailable: 'bg-red-100 text-red-800 red',
  failed: 'bg-red-100 text-red-800 red',
  not_applicable: 'bg-gray-100 text-gray-700 grey',
  discovered: 'bg-gray-100 text-gray-700 grey',
  created: 'bg-gray-100 text-gray-700 grey',
}

const DEFAULT_CLASSES = 'bg-gray-100 text-gray-700'

interface Props {
  status: Status
}

export function StatusBadge({ status }: Props) {
  const classes = colourClasses[status] ?? DEFAULT_CLASSES
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

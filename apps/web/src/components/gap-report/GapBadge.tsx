interface Props {
  isGap: boolean
}

export function GapBadge({ isGap }: Props) {
  return isGap ? (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">Gap</span>
  ) : (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">Available</span>
  )
}

interface Props {
  message: string
  onDismiss?: () => void
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div className="flex items-start gap-3 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-800 text-sm">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-500 hover:text-red-700 font-medium leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  )
}

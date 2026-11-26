interface LoadingViewProps {
  label: string
}

/** Centered status message used while a view loads or completes. */
export default function LoadingView({ label }: LoadingViewProps) {
  return (
    <div className="view">
      <p className="loading">{label}</p>
    </div>
  )
}

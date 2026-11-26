interface SessionMeterProps {
  label: string
  current: number
  total: number
}

/** Step counter and progress bar shown above a session card. */
export default function SessionMeter({ label, current, total }: SessionMeterProps) {
  const progress = total ? (current / total) * 100 : 0

  return (
    <div className="session-meter">
      <div className="session-meter-head">
        <span className="session-meter-mode">
          <span className="session-meter-dot" aria-hidden="true" />
          {label}
        </span>
        <span className="session-meter-count">
          {current}
          <span className="session-meter-total">/ {total}</span>
        </span>
      </div>
      <div
        className="session-meter-track"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-label={`${label} progress`}
      >
        <span className="session-meter-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

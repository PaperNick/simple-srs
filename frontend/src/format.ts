/** Accuracy as a whole percentage, defaulting to 100% when nothing was answered. */
export function formatAccuracy(correct: number, total: number): string {
  const accuracy = total ? Math.round((correct / total) * 100) : 100
  return `${accuracy}%`
}

/** Compact duration, e.g. "45s", "2m 05s", or "1h 15m 30s". */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }
  return `${seconds}s`
}

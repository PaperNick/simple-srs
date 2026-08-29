/**
 * Centralized keyboard shortcuts for the app.
 *
 * Every shortcut can be overridden with a Vite env var (must be VITE_-prefixed to be exposed to the client), e.g.:
 *   VITE_KEY_PLAY_AUDIO=space   (or "Spacebar")
 *   VITE_KEY_EXPAND_DETAILS=x
 *
 * Keys are matched case-insensitively against event.key, so values like 'p', 'P', 'Enter', ' ' (space) all work.
 */

const env = (import.meta.env || {}) as Record<string, string | undefined>

/** Resolve a shortcut value from a VITE_ env variable, falling back to a default. */
function key(name: string, fallback: string): string {
  return String(env['VITE_KEY_' + name] || fallback).toLowerCase()
}

export const SHORTCUTS = {
  playAudio: key('PLAY_AUDIO', 'p'),
  expandDetails: key('EXPAND_DETAILS', 'e'),
  submit: 'Enter',
  reveal: 'Enter',
  next: 'Enter',
} as const

/** Whether a keyboard event matches the given shortcut (case-insensitive). */
export function isShortcut(event: { key: string }, shortcut: string): boolean {
  return String(event.key).toLowerCase() === shortcut.toLowerCase()
}

/** Return a friendly label for a shortcut key (e.g. " " -> "Space"). */
export function shortcutLabel(shortcut: string): string {
  const labels: Record<string, string> = { ' ': 'Space', spacebar: 'Space', enter: 'Enter' }
  return labels[shortcut.toLowerCase()] || shortcut
}

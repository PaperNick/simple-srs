/**
 * Centralized keyboard shortcuts for the app.
 *
 * Every shortcut can be overridden with a Vite env var (must be VITE_-prefixed to be exposed to the client), e.g.:
 *   VITE_KEY_PLAY_AUDIO=space   (or "Spacebar")
 *   VITE_KEY_EXPAND_DETAILS=x
 *
 * Keys are matched case-insensitively against event.key, so values like 'p', 'P', 'Enter', ' ' (space) all work.
 */

const env = import.meta.env || {}

/**
 * Resolve a shortcut value from a VITE_ env variable, falling back to a default
 * and lowercasing the result.
 *
 * @param {string} name Suffix of the VITE_KEY_<name> variable.
 * @param {string} fallback Default key.
 * @returns {string} The effective shortcut key.
 */
function key(name, fallback) {
  return String(env['VITE_KEY_' + name] || fallback).toLowerCase()
}

export const SHORTCUTS = {
  playAudio: key('PLAY_AUDIO', 'p'),
  expandDetails: key('EXPAND_DETAILS', 'e'),
  submit: 'Enter',
  reveal: 'Enter',
  next: 'Enter',
}

/**
 * Whether a keyboard event matches the given shortcut (case-insensitive).
 *
 * @param {KeyboardEvent} event The keydown event.
 * @param {string} shortcut The configured shortcut key.
 * @returns {boolean} True on a match.
 */
export function isShortcut(event, shortcut) {
  return String(event.key).toLowerCase() === shortcut.toLowerCase()
}

/**
 * Return a friendly label for a shortcut key (e.g. " " -> "Space").
 *
 * @param {string} shortcut The configured shortcut key.
 * @returns {string} The display label.
 */
export function shortcutLabel(shortcut) {
  const labels = { ' ': 'Space', spacebar: 'Space', enter: 'Enter' }
  return labels[shortcut.toLowerCase()] || shortcut
}

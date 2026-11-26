import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHORTCUTS, isShortcut, shortcutLabel } from './shortcuts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('isShortcut', () => {
  it('matches keys case-insensitively', () => {
    expect(isShortcut({ key: 'P' }, 'p')).toBe(true)
    expect(isShortcut({ key: 'Enter' }, 'Enter')).toBe(true)
    expect(isShortcut({ key: ' ' }, ' ')).toBe(true)
  })

  it('rejects non-matching keys', () => {
    expect(isShortcut({ key: 'x' }, 'p')).toBe(false)
    expect(isShortcut({ key: 'Enter' }, 'Escape')).toBe(false)
  })
})

describe('shortcutLabel', () => {
  it('maps special keys to friendly labels', () => {
    expect(shortcutLabel(' ')).toBe('Space')
    expect(shortcutLabel('Spacebar')).toBe('Space')
    expect(shortcutLabel('enter')).toBe('Enter')
  })

  it('returns unknown keys unchanged', () => {
    expect(shortcutLabel('q')).toBe('q')
  })
})

describe('SHORTCUTS', () => {
  it('lowercases an env override', async () => {
    vi.stubEnv('VITE_KEY_PLAY_AUDIO', 'J')
    vi.resetModules()

    const { SHORTCUTS: reloaded } = await import('./shortcuts')

    expect(reloaded.playAudio).toBe('j')
  })

  it('falls back to the default when the override is empty', async () => {
    vi.stubEnv('VITE_KEY_PLAY_AUDIO', '')
    vi.resetModules()

    const { SHORTCUTS: reloaded } = await import('./shortcuts')

    expect(reloaded.playAudio).toBe('p')
  })

  it('pins the hard-coded action keys', () => {
    expect(SHORTCUTS.submit).toBe('Enter')
    expect(SHORTCUTS.reveal).toBe('Enter')
    expect(SHORTCUTS.next).toBe('Enter')
  })
})

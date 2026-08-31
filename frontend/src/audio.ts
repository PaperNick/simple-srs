import { useEffect } from 'react'
import type { Card } from '@shared/types'

/** Unified audio access: each item carries its own `audio` path. */
let audioElement: HTMLAudioElement | null = null

/** Return the audio source URL for an item, or null when it has none. */
export function itemAudioSrc(item: Card | null): string | null {
  if (!item) {
    return null
  }
  return item.audio || null
}

/**
 * Try to play an item's audio, returning whether playback was started. A single
 * hidden <audio> element is reused so the browser actually loads the file.
 */
export function playItemAudio(item: Card | null): boolean {
  const source = itemAudioSrc(item)
  if (!source) {
    return false
  }

  if (!audioElement) {
    audioElement = new Audio()
    audioElement.preload = 'auto'
    audioElement.style.display = 'none'
    document.body.appendChild(audioElement)
  }

  audioElement.src = source
  audioElement.play().catch(() => {})
  return true
}

/** Play an item's audio whenever `enabled` flips true (used for auto-play). */
export function useAutoplay(item: Card | null, enabled: boolean): void {
  useEffect(() => {
    if (enabled) {
      playItemAudio(item)
    }
  }, [item, enabled])
}

import { itemAudioSrc, playItemAudio } from '../audio'
import type { Card } from '@shared/types'

interface PlayAudioButtonProps {
  item: Card
}

/**
 * A speaker button that plays the item's audio. Renders nothing when the item
 * has no audio, so callers can place it unconditionally on audio-enabled cards.
 */
export default function PlayAudioButton({ item }: PlayAudioButtonProps) {
  if (!itemAudioSrc(item)) {
    return null
  }
  return (
    <button
      type="button"
      className="banner-audio-btn"
      aria-label="Play audio"
      onClick={() => playItemAudio(item)}
    >
      🔊
    </button>
  )
}

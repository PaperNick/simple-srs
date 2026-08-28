/**
 * Unified audio access: each item carries its own `audio` path. Falls back to nothing if the item has no audio.
 */

let audioElement = null

/**
 * Return the audio source URL for an item, or null when it has none.
 *
 * @param {object|null} item The card item.
 * @returns {string|null} The audio URL.
 */
export function itemAudioSrc(item) {
  if (!item) {
    return null
  }
  return item.audio || null
}

/**
 * Try to play an item's audio, returning whether playback was started. A single
 * hidden <audio> element is reused so the browser actually loads the file.
 *
 * @param {object|null} item The card item.
 * @returns {boolean} True when playback was attempted.
 */
export function playItemAudio(item) {
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

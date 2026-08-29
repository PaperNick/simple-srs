import { SHORTCUTS, shortcutLabel } from '../shortcuts'

/**
 * Render the inline keyboard shortcut hints (expand + audio) for the answer
 * screen, using the currently configured keys.
 */
export default function ShortcutHints() {
  return (
    <span className="shortcut-hint">
      <span>
        <kbd>{shortcutLabel(SHORTCUTS.expandDetails)}</kbd> expand
      </span>
      <span>
        <kbd>{shortcutLabel(SHORTCUTS.playAudio)}</kbd> audio
      </span>
    </span>
  )
}

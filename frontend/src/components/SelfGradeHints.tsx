import { SHORTCUTS, shortcutLabel } from '../shortcuts'

/**
 * Render the keyboard hints for a self-grade card's accept/reject buttons.
 * Mirrors ShortcutHints so the before-answering screen shows the keys.
 */
export default function SelfGradeHints() {
  return (
    <span className="shortcut-hint">
      <span>
        <kbd>{shortcutLabel(SHORTCUTS.missedIt)}</kbd> Missed it
      </span>
      <span>
        <kbd>{shortcutLabel(SHORTCUTS.gotIt)}</kbd> Got it
      </span>
    </span>
  )
}

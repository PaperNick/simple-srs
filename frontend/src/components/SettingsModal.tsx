import type { ReactNode } from 'react'
import type { Theme } from '@shared/types'

interface ThemeOption {
  value: Theme
  label: string
  thumb: 'light' | 'dark' | 'split'
}

interface OptionCardProps {
  selected: boolean
  label: string
  preview: ReactNode
  onClick: () => void
}

interface WindowThumbProps {
  theme: 'light' | 'dark' | 'split'
}

interface AudioToggleProps {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

interface SettingsModalProps {
  open: boolean
  theme: Theme
  autoplayLesson: boolean
  autoplayReview: boolean
  onSelectTheme: (theme: Theme) => void
  onSetAutoplayLesson: (autoplay: boolean) => void
  onSetAutoplayReview: (autoplay: boolean) => void
  onClose: () => void
}

/** A selectable option card with an icon, label, and preview thumbnail. */
function OptionCard({ selected, label, preview, onClick }: OptionCardProps) {
  return (
    <button
      type="button"
      className={`option-card ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <div className="option-head">
        <span className="option-label">{label}</span>
      </div>
      {preview}
    </button>
  )
}

/** A mini mock window used as a preview thumbnail. */
function WindowThumb({ theme }: WindowThumbProps) {
  return (
    <div className={`window-thumb ${theme}`}>
      <div className="window-bar">
        <span />
        <span />
        <span />
      </div>
      <div className="window-body">
        <div className="window-sidebar" />
        <div className="window-content">
          <div className="window-line w-75" />
          <div className="window-line w-50" />
          <div className="window-pills">
            <span className="window-pill red" />
            <span className="window-pill green" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** A labelled auto-play toggle */
function AudioToggle({ title, description, checked, onChange }: AudioToggleProps) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <span className="toggle-title">{title}</span>
        <span className="toggle-subtitle">{description}</span>
      </div>
      <button
        type="button"
        className={`toggle-switch ${checked ? 'checked' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: 'System', thumb: 'split' },
  { value: 'light', label: 'Light', thumb: 'light' },
  { value: 'dark', label: 'Dark', thumb: 'dark' },
]

/**
 * Global app settings presented in a modal. Themes are selectable cards with a
 * preview thumbnail, while audio is split into a Lesson and a Review toggle.
 */
export default function SettingsModal({
  open,
  theme,
  autoplayLesson,
  autoplayReview,
  onSelectTheme,
  onSetAutoplayLesson,
  onSetAutoplayReview,
  onClose,
}: SettingsModalProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2 className="modal-title">Settings</h2>
          <button className="modal-close" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-section">
          <p className="modal-intro">Choose a default theme</p>
          <div className="option-grid">
            {THEME_OPTIONS.map(option => (
              <OptionCard
                key={option.value}
                selected={theme === option.value}
                label={option.label}
                preview={<WindowThumb theme={option.thumb} />}
                onClick={() => onSelectTheme(option.value)}
              />
            ))}
          </div>
        </div>

        <div className="modal-section">
          <div className="toggle-group">
            <AudioToggle
              title="Auto-play audio · Lesson"
              description="Play each card's audio as soon as you reveal it."
              checked={autoplayLesson}
              onChange={onSetAutoplayLesson}
            />
            <AudioToggle
              title="Auto-play audio · Review"
              description="Play a Review card's audio after you answer it. Only on Reading cards that have audio."
              checked={autoplayReview}
              onChange={onSetAutoplayReview}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

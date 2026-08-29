import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

interface AnswerInputProps {
  inputRef?: RefObject<HTMLInputElement>
  value?: string
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  actionLabel?: string
  onAction?: () => void
  actionHidden?: boolean
}

/**
 * Text input with an embedded trailing action button, used for the answer entry
 * on the practice and review cards. The button sits inside the input's right
 * edge so the "Check" action is tightly coupled to the answer field.
 */
export default function AnswerInput({
  inputRef,
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
  autoFocus,
  actionLabel,
  onAction,
  actionHidden = false,
}: AnswerInputProps) {
  return (
    <div className="answer-input-wrap">
      <input
        ref={inputRef}
        className="answer-input"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck="false"
      />
      {!actionHidden && (
        <button className="submit-btn" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  )
}

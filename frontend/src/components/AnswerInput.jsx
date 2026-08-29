/**
 * Text input with an embedded trailing action button, used for the answer entry
 * on the practice and review cards. The button sits inside the input's right
 * edge so the "Check" action is tightly coupled to the answer field.
 *
 * @param {object} props
 * @param {React.RefObject} [props.inputRef] Ref forwarded to the input.
 * @param {string} [props.value] Controlled value (omit for uncontrolled inputs).
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} [props.onChange]
 * @param {(event: React.KeyboardEvent<HTMLInputElement>) => void} [props.onKeyDown]
 * @param {string} [props.placeholder] Input placeholder text.
 * @param {boolean} [props.disabled] Disable the input.
 * @param {boolean} [props.autoFocus] Autofocus the input on mount.
 * @param {string} [props.actionLabel] Text for the embedded button.
 * @param {() => void} [props.onAction] Click handler for the embedded button.
 * @param {boolean} [props.actionHidden] Hide the embedded button.
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
}) {
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

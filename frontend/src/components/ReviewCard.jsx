import { useEffect, useRef, useState } from 'react'
import { reviewAnswer } from '../api.js'
import { playItemAudio } from '../audio.js'
import { SHORTCUTS, isShortcut } from '../shortcuts.js'
import { ItemDetails } from './LessonCard.jsx'
import ShortcutHints from './ShortcutHints.jsx'

/**
 * Show a single review card: grade the typed answer, then continue or re-queue
 * the item. Supports meaning and reading prompts.
 *
 * @param {{ item: object, onMissed: Function, onNext: Function }} props
 *   The item being reviewed and callbacks for a miss / moving on.
 */
export default function ReviewCard({ item, onMissed, onNext }) {
  const [phase, setPhase] = useState('input') // 'input' | 'result'
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)
  const isMeaning = item.question_type === 'meaning'
  const label = isMeaning ? 'Vocabulary Meaning' : 'Vocabulary Reading'
  const placeholder = isMeaning ? 'Type the meaning…' : 'Type the reading…'
  const expected = cardItem => (isMeaning ? cardItem.meaning : cardItem.readings.join(', '))

  const submit = async value => {
    if (!value || !value.trim()) {
      if (inputRef.current) {
        inputRef.current.focus()
      }
      return
    }
    try {
      const response = await reviewAnswer(item.id, value, item.question_type)
      setResult({
        correct: response.correct,
        expected: response.expected || expected(item),
        item: response.item,
      })
      setPhase('result')
      if (!response.correct) {
        onMissed()
      }
    } catch (_) {
      setResult({ correct: false, expected: expected(item), item })
      setPhase('result')
      onMissed()
    }
  }

  const skip = () => {
    setResult({ correct: false, expected: expected(item), item })
    setPhase('result')
    onMissed()
  }

  const onKey = event => {
    if (phase === 'input' && isShortcut(event, SHORTCUTS.submit)) {
      submit(event.target.value)
    }
    if (phase === 'result' && isShortcut(event, SHORTCUTS.next)) {
      onNext()
    }
  }

  // On the result screen the input is disabled, so let SHORTCUTS.next (Enter) elsewhere act as "Continue".
  useEffect(() => {
    const handler = event => {
      if (!isShortcut(event, SHORTCUTS.next) || phase !== 'result') {
        return
      }
      event.preventDefault()
      onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, onNext])

  // Focus the input on each new item so you can type right away.
  useEffect(() => {
    if (phase === 'input' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [phase])

  // "p" plays the word audio once the card has been answered.
  useEffect(() => {
    const handler = event => {
      if (!isShortcut(event, SHORTCUTS.playAudio)) {
        return
      }
      if (phase !== 'result') {
        return
      }
      playItemAudio(item)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, item])

  const correct = result ? result.correct : false
  const cardClass = phase === 'result' ? (correct ? 'result-correct' : 'result-incorrect') : ''

  return (
    <div className={`card ${cardClass} type-${isMeaning ? 'meaning' : 'reading'}`}>
      <div className="banner">
        <div className="banner-char">{item.characters}</div>
      </div>
      <div className="subtitle-bar">{label}</div>

      {phase === 'result' && (
        <div className={`result-bar ${correct ? 'green' : 'red'}`}>{result.expected}</div>
      )}

      <div className="answer-zone">
        <input
          ref={inputRef}
          className="answer-input"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          placeholder={placeholder}
          disabled={phase === 'result'}
          onKeyDown={onKey}
        />
        {phase === 'input' && (
          <button className="submit-btn" onClick={() => submit(inputRef.current.value)}>
            Check
          </button>
        )}
      </div>

      {phase === 'result' && (
        <ItemDetails item={result.item} defaultOpen={isMeaning ? 'meaning' : 'reading'} />
      )}

      <div className="action-row">
        {phase === 'input' ? (
          <button className="skip-btn" onClick={skip}>
            Skip
          </button>
        ) : (
          <ShortcutHints />
        )}
        {phase === 'result' && (
          <button className="next-btn" onClick={onNext}>
            Continue
          </button>
        )}
      </div>
    </div>
  )
}

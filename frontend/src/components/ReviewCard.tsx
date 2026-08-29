import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { reviewAnswer } from '../api'
import { playItemAudio } from '../audio'
import { SHORTCUTS, isShortcut } from '../shortcuts'
import AnswerInput from './AnswerInput'
import { ItemDetails } from './LessonCard'
import ShortcutHints from './ShortcutHints'
import type { Card, ReviewCard as ReviewCardType } from '@shared/types'

interface Result {
  correct: boolean
  expected: string
  item: Card
}

interface ReviewCardProps {
  item: ReviewCardType
  onMissed: () => void
  onNext: () => void
}

/**
 * Show a single review card: grade the typed answer, then continue or re-queue
 * the item. Supports meaning and reading prompts.
 */
export default function ReviewCard({ item, onMissed, onNext }: ReviewCardProps) {
  const [phase, setPhase] = useState<'input' | 'result'>('input')
  const [result, setResult] = useState<Result | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isMeaning = item.question_type === 'meaning'
  const label = isMeaning ? 'Vocabulary Meaning' : 'Vocabulary Reading'
  const placeholder = isMeaning ? 'Type the meaning…' : 'Type the reading…'
  const expected = (cardItem: Card): string =>
    isMeaning ? cardItem.meanings.join(', ') : cardItem.readings.join(', ')

  const submit = async (value: string) => {
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

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (phase === 'input' && isShortcut(event, SHORTCUTS.submit)) {
      submit(event.currentTarget.value)
    }
    if (phase === 'result' && isShortcut(event, SHORTCUTS.next)) {
      onNext()
    }
  }

  // On the result screen the input is disabled, so let SHORTCUTS.next (Enter) elsewhere act as "Continue".
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
    const handler = (event: KeyboardEvent) => {
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
        <div className={`result-bar ${correct ? 'green' : 'red'}`}>{result!.expected}</div>
      )}

      <div className="answer-zone">
        <AnswerInput
          inputRef={inputRef}
          onKeyDown={onKey}
          placeholder={placeholder}
          disabled={phase === 'result'}
          autoFocus
          actionLabel="Enter"
          onAction={() => submit(inputRef.current!.value)}
          actionHidden={phase !== 'input'}
        />
      </div>

      {phase === 'result' && (
        <ItemDetails item={result!.item} defaultOpen={isMeaning ? 'meaning' : 'reading'} />
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

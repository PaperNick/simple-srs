import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { reviewAnswer } from '../api'
import { playItemAudio, useAutoplay } from '../audio'
import { SHORTCUTS, isShortcut } from '../shortcuts'
import AnswerInput from './AnswerInput'
import { ItemDetails } from './LessonCard'
import PlayAudioButton from './PlayAudioButton'
import SelfGradeHints from './SelfGradeHints'
import ShortcutHints from './ShortcutHints'
import type { Card, ReviewCard as ReviewCardType } from '@shared/types'

interface Result {
  correct: boolean
  expected: string
  item: Card
  revealed?: boolean
}

interface ReviewCardProps {
  item: ReviewCardType
  autoplay: boolean
  markCorrect: boolean
  onAnswered: (correct: boolean) => void
  onNext: () => void
}

/** Imperative commit for finishing mid-card. */
export interface ReviewCardHandle {
  commit: () => void
}

/** Single review card: grade, allow an override, then continue. */
const ReviewCard = forwardRef<ReviewCardHandle, ReviewCardProps>(function ReviewCard(
  { item, autoplay, markCorrect, onAnswered, onNext },
  ref
) {
  const [phase, setPhase] = useState<'input' | 'result'>('input')
  const [result, setResult] = useState<Result | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)
  const isMeaning = item.question_type === 'meaning'
  const isSelfGrade = item.question_type === 'self-grade'
  const label = isMeaning ? 'Vocabulary Meaning' : isSelfGrade ? 'Vocabulary' : 'Vocabulary Reading'
  const placeholder = isMeaning ? 'Type the meaning…' : 'Type the reading…'
  const typeClass = isSelfGrade ? 'self-grade' : isMeaning ? 'meaning' : 'reading'
  const expected = (cardItem: Card): string => {
    if (isSelfGrade) {
      return ''
    }
    return isMeaning ? cardItem.meanings.join(', ') : cardItem.readings.join(', ')
  }

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
    } catch (_) {
      setResult({ correct: false, expected: expected(item), item })
    }
    setPhase('result')
  }

  // Reveal the answer and treat the card as a miss (resets the item's stage).
  const dontKnow = () => {
    setResult({ correct: false, expected: expected(item), item, revealed: true })
    setPhase('result')
  }

  const gradeSelf = async (recalled: boolean) => {
    try {
      const response = await reviewAnswer(item.id, '', 'self-grade', recalled)
      setResult({
        correct: response.correct,
        expected: response.expected || expected(item),
        item: response.item,
      })
    } catch (_) {
      setResult({ correct: recalled, expected: '', item })
    }
    setPhase('result')
  }

  // Report the result once so advance and early finish cannot double-count.
  const commit = useCallback(() => {
    if (committedRef.current || !result) {
      return
    }
    committedRef.current = true
    onAnswered(result.correct)
  }, [result, onAnswered])

  useImperativeHandle(ref, () => ({ commit }), [commit])

  const advance = () => {
    commit()
    onNext()
  }

  const markAsCorrect = () => {
    setResult(previous => (previous ? { ...previous, correct: true } : previous))
  }

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (phase === 'input' && isShortcut(event, SHORTCUTS.submit)) {
      submit(event.currentTarget.value)
    }
    if (phase === 'result' && isShortcut(event, SHORTCUTS.next)) {
      advance()
    }
  }

  // On the result screen the input is disabled, so let SHORTCUTS.next (Enter) elsewhere act as "Continue".
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isShortcut(event, SHORTCUTS.next) || phase !== 'result') {
        return
      }
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, advance])

  // Self-grade cards are graded by keyboard: "missed it" or "got it".
  useEffect(() => {
    if (!isSelfGrade) {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (phase !== 'input') {
        return
      }
      if (isShortcut(event, SHORTCUTS.missedIt)) {
        event.preventDefault()
        gradeSelf(false)
      } else if (isShortcut(event, SHORTCUTS.gotIt)) {
        event.preventDefault()
        gradeSelf(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isSelfGrade, phase, gradeSelf])

  useEffect(() => {
    if (phase === 'input' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [phase])

  useAutoplay(item, phase === 'result' && autoplay && item.question_type !== 'meaning')

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
  const showMarkCorrect =
    markCorrect &&
    !isSelfGrade &&
    phase === 'result' &&
    !!result &&
    !result.correct &&
    !result.revealed

  return (
    <div className={`card ${cardClass} type-${typeClass}`}>
      <div className="banner">
        <div className="banner-char">{item.characters}</div>
        {phase === 'result' && <PlayAudioButton item={item} />}
      </div>
      <div className="subtitle-bar">{label}</div>

      {phase === 'result' && result!.expected && (
        <div className={`result-bar ${correct ? 'green' : 'red'}`}>{result!.expected}</div>
      )}

      <div className="answer-zone">
        {isSelfGrade ? (
          <div className="self-grade">
            <button
              className="self-grade-btn miss"
              onClick={() => gradeSelf(false)}
              disabled={phase === 'result'}
            >
              Missed it
            </button>
            <button
              className="self-grade-btn got"
              onClick={() => gradeSelf(true)}
              disabled={phase === 'result'}
            >
              Got it
            </button>
          </div>
        ) : (
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
        )}
      </div>

      {phase === 'result' && !isSelfGrade && (
        <ItemDetails item={result!.item} defaultOpen={isMeaning ? 'meaning' : 'reading'} />
      )}

      <div className="action-row">
        {phase === 'input' ? (
          isSelfGrade ? (
            <SelfGradeHints />
          ) : (
            <button className="dont-know-btn" onClick={dontKnow}>
              Don't know
            </button>
          )
        ) : showMarkCorrect ? (
          <button className="mark-correct-btn" onClick={markAsCorrect}>
            <Check size={16} /> Mark Correct
          </button>
        ) : (
          <ShortcutHints />
        )}
        {phase === 'result' && (
          <button className="next-btn" onClick={advance}>
            Continue
          </button>
        )}
      </div>
    </div>
  )
})

export default ReviewCard

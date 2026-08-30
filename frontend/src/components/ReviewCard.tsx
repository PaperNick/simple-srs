import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { reviewAnswer } from '../api'
import { playItemAudio } from '../audio'
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

  const gradeSelf = async (recalled: boolean) => {
    try {
      const response = await reviewAnswer(item.id, '', 'self-grade', recalled)
      setResult({
        correct: response.correct,
        expected: response.expected || expected(item),
        item: response.item,
      })
      if (!response.correct) {
        onMissed()
      }
    } catch (_) {
      setResult({ correct: recalled, expected: '', item })
      if (!recalled) {
        onMissed()
      }
    }
    setPhase('result')
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
            <button className="skip-btn" onClick={skip}>
              Skip
            </button>
          )
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

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, Flame, X } from 'lucide-react'
import { getPracticeItems, practiceAnswer } from '../api'
import { playItemAudio, useAutoplay } from '../audio'
import { SHORTCUTS, isShortcut } from '../shortcuts'
import AnswerInput from './AnswerInput'
import { ItemDetails } from './LessonCard'
import PlayAudioButton from './PlayAudioButton'
import SelfGradeHints from './SelfGradeHints'
import ShortcutHints from './ShortcutHints'
import type { Card } from '@shared/types'

interface Tally {
  answered: number
  correct: number
  wrong: number
  streak: number
  best: number
}

interface PracticeProps {
  dataset: string
  autoplay: boolean
  markCorrect: boolean
  onStop: () => void
}

/** Return a new array with the items randomly shuffled. */
function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const temporary = shuffled[index]
    shuffled[index] = shuffled[randomIndex]
    shuffled[randomIndex] = temporary
  }
  return shuffled
}

/**
 * Run the endless practice session: shuffle the items, grade each
 * reading, keep a running tally and loop forever until the user stops.
 */
export default function Practice({ dataset, autoplay, markCorrect, onStop }: PracticeProps) {
  const allRef = useRef<Card[]>([]) // full item set
  const sequenceRef = useRef<Card[]>([]) // endless rotation
  const positionRef = useRef(0) // current position in rotation
  const inputRef = useRef<HTMLInputElement>(null)

  const [current, setCurrent] = useState<Card | null>(null)
  const [phase, setPhase] = useState<'input' | 'result'>('input')
  const [result, setResult] = useState<{ correct: boolean; revealed?: boolean } | null>(null)
  const [value, setValue] = useState('')
  const [tally, setTally] = useState<Tally>({
    answered: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    best: 0,
  })

  const advance = useCallback(() => {
    positionRef.current += 1
    if (positionRef.current >= sequenceRef.current.length) {
      // Rotation exhausted -> refill with a fresh shuffle (keeps going forever)
      sequenceRef.current = sequenceRef.current.concat(shuffle(allRef.current))
    }
    setCurrent(sequenceRef.current[positionRef.current])
    setPhase('input')
    setResult(null)
    setValue('')
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { items } = await getPracticeItems(dataset)
        if (cancelled) {
          return
        }
        allRef.current = items
        sequenceRef.current = shuffle(items)
        positionRef.current = 0
        setCurrent(sequenceRef.current[0])
      } catch (_) {
        onStop()
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [onStop, dataset])

  // Keep the input focused so you can type right away on every new item.
  useEffect(() => {
    if (phase === 'input' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [phase])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isShortcut(event, SHORTCUTS.playAudio)) {
        return
      }
      if (phase !== 'result' || !current) {
        return
      }
      playItemAudio(current)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, current])

  // Auto-play the character audio once the card has been answered, when enabled.
  useAutoplay(current, phase === 'result' && autoplay)

  const submit = async () => {
    const input = value
    if (!input || !input.trim()) {
      if (inputRef.current) {
        inputRef.current.focus()
      }
      return
    }

    let correct
    try {
      const response = await practiceAnswer(current!.id, input)
      correct = response.correct
    } catch (_) {
      correct = false
    }

    setResult({ correct })
    setPhase('result')
    setTally(previous => {
      const streak = correct ? previous.streak + 1 : 0
      return {
        answered: previous.answered + 1,
        correct: previous.correct + (correct ? 1 : 0),
        wrong: previous.wrong + (correct ? 0 : 1),
        streak,
        best: Math.max(previous.best, streak),
      }
    })

    // Reinforce misses: bring the item back a few steps later.
    if (!correct && current) {
      const insertAt = Math.min(positionRef.current + 4, sequenceRef.current.length)
      sequenceRef.current.splice(insertAt, 0, current)
    }
  }

  const reveal = () => {
    // Peek at the answer (neutral: does not affect the tally), then re-queue it.
    setResult({ correct: false, revealed: true })
    setPhase('result')
    if (current) {
      const insertAt = Math.min(positionRef.current + 2, sequenceRef.current.length)
      sequenceRef.current.splice(insertAt, 0, current)
    }
  }

  // Self-grade a card that has nothing to type: the user decides if they knew it.
  const gradeSelf = (recalled: boolean) => {
    setResult({ correct: recalled })
    setPhase('result')
    setTally(previous => {
      const streak = recalled ? previous.streak + 1 : 0
      return {
        answered: previous.answered + 1,
        correct: previous.correct + (recalled ? 1 : 0),
        wrong: previous.wrong + (recalled ? 0 : 1),
        streak,
        best: Math.max(previous.best, streak),
      }
    })
    if (!recalled && current) {
      const insertAt = Math.min(positionRef.current + 4, sequenceRef.current.length)
      sequenceRef.current.splice(insertAt, 0, current)
    }
  }

  const markAsCorrect = () => {
    setResult(previous =>
      previous && !previous.revealed ? { ...previous, correct: true } : previous
    )
    setTally(previous => ({
      ...previous,
      correct: previous.correct + 1,
      wrong: previous.wrong - 1,
    }))
  }

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (phase === 'input' && isShortcut(event, SHORTCUTS.submit)) {
      submit()
    } else if (phase === 'result' && isShortcut(event, SHORTCUTS.next)) {
      advance()
    }
  }

  // On the result screen the input is disabled, so let Enter elsewhere act as "Next".
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
    if (current && current.readings.length > 0) {
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
  }, [current, phase, gradeSelf])

  if (!current) {
    return (
      <div className="view">
        <p className="loading">Warming up…</p>
      </div>
    )
  }

  const hasAnswer = current.readings.length > 0
  const correct = result ? result.correct : null
  const cardClass = phase === 'result' ? (correct ? 'result-correct' : 'result-incorrect') : ''
  const showMarkCorrect =
    markCorrect &&
    hasAnswer &&
    phase === 'result' &&
    !!result &&
    !result.correct &&
    !result.revealed

  return (
    <div className="view session-view">
      <div className="session-progress practice-stats">
        <span className="stat-chip">#{tally.answered}</span>
        <span className="stat-chip ok">
          <Check size={20} /> {tally.correct}
        </span>
        <span className="stat-chip no">
          <X size={20} /> {tally.wrong}
        </span>
        <span className="stat-chip streak">
          <Flame size={20} /> {tally.streak}
        </span>
      </div>

      <div className={`card ${cardClass}`}>
        <div className="banner">
          <div className="banner-char">{current.characters}</div>
          {phase === 'result' && <PlayAudioButton item={current} />}
        </div>
        <div className="subtitle-bar">Character Reading</div>

        {phase === 'result' && hasAnswer && (
          <div className={`result-bar ${correct ? 'green' : 'red'}`}>
            {current.readings.join(', ')}
          </div>
        )}

        <div className="answer-zone">
          {hasAnswer ? (
            <AnswerInput
              inputRef={inputRef}
              value={value}
              onChange={event => setValue(event.target.value)}
              onKeyDown={onKey}
              placeholder="Type the reading…"
              disabled={phase === 'result'}
              autoFocus
              actionLabel="Enter"
              onAction={submit}
              actionHidden={phase !== 'input'}
            />
          ) : (
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
          )}
        </div>

        {phase === 'result' && hasAnswer && <ItemDetails item={current} defaultOpen="reading" />}

        <div className="action-row">
          {phase === 'input' ? (
            hasAnswer ? (
              <button className="dont-know-btn" onClick={reveal}>
                Show
              </button>
            ) : (
              <SelfGradeHints />
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
              Next
            </button>
          )}
        </div>
      </div>

      <div className="below-card-actions">
        <button className="ghost-link" onClick={onStop}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}

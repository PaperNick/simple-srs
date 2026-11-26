import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, Flame, X } from 'lucide-react'
import { getPracticeItems, practiceAnswer } from '../api'
import { playItemAudio, useAutoplay } from '../audio'
import { formatAccuracy, formatDuration } from '../format'
import { shuffle } from '../shuffle'
import { SHORTCUTS, isShortcut } from '../shortcuts'
import AnswerInput from './AnswerInput'
import { ItemDetails } from './LessonCard'
import LoadingView from './LoadingView'
import PlayAudioButton from './PlayAudioButton'
import SelfGradeHints from './SelfGradeHints'
import SessionSummary from './SessionSummary'
import type { SummaryStat } from './SessionSummary'
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

/** Endless practice session: grade cards until the user stops. */
export default function Practice({ dataset, autoplay, markCorrect, onStop }: PracticeProps) {
  const allRef = useRef<Card[]>([])
  const sequenceRef = useRef<Card[]>([])
  const positionRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const startedAtRef = useRef(0)

  const [current, setCurrent] = useState<Card | null>(null)
  const [phase, setPhase] = useState<'input' | 'result'>('input')
  const [result, setResult] = useState<{ correct: boolean; revealed?: boolean } | null>(null)
  const [value, setValue] = useState('')
  const [summary, setSummary] = useState(false)
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
        startedAtRef.current = Date.now()
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

  useEffect(() => {
    if (!summary && phase === 'input' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [phase, summary])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (summary || !isShortcut(event, SHORTCUTS.playAudio)) {
        return
      }
      if (phase !== 'result' || !current) {
        return
      }
      playItemAudio(current)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, current, summary])

  useAutoplay(current, !summary && phase === 'result' && autoplay)

  const recordAnswer = (correct: boolean) => {
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
  }

  // Bring a card back a few steps later so misses and reveals get repeated.
  const requeue = (card: Card, offset: number) => {
    const insertAt = Math.min(positionRef.current + offset, sequenceRef.current.length)
    sequenceRef.current.splice(insertAt, 0, card)
  }

  const submit = async () => {
    const card = current
    const input = value.trim()
    if (!card) {
      return
    }
    if (!input) {
      inputRef.current?.focus()
      return
    }

    let correct = false
    try {
      const response = await practiceAnswer(card.id, input)
      correct = response.correct
    } catch (_) {
      /* Treat a failed request as a miss. */
    }

    setResult({ correct })
    setPhase('result')
    recordAnswer(correct)
    if (!correct) {
      requeue(card, 4)
    }
  }

  const reveal = () => {
    if (!current) {
      return
    }
    // Show the answer without scoring it, then re-queue the card.
    setResult({ correct: false, revealed: true })
    setPhase('result')
    requeue(current, 2)
  }

  const gradeSelf = (recalled: boolean) => {
    if (!current) {
      return
    }
    setResult({ correct: recalled })
    setPhase('result')
    recordAnswer(recalled)
    if (!recalled) {
      requeue(current, 4)
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

  // Practice is endless, so finishing is explicit.
  const finishPractice = () => {
    if (tally.answered === 0) {
      onStop()
      return
    }
    setSummary(true)
  }

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (phase === 'input' && isShortcut(event, SHORTCUTS.submit)) {
      submit()
    } else if (phase === 'result' && isShortcut(event, SHORTCUTS.next)) {
      advance()
    }
  }

  // Enter advances once the result screen disables the input.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (summary || !isShortcut(event, SHORTCUTS.next) || phase !== 'result') {
        return
      }
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, advance, summary])

  // Self-grade cards are graded by keyboard: "missed it" or "got it".
  useEffect(() => {
    if (current && current.readings.length > 0) {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (summary || phase !== 'input') {
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
  }, [current, phase, gradeSelf, summary])

  if (summary) {
    const stats: SummaryStat[] = [
      { label: 'Answered', value: tally.answered },
      { label: 'Correct', value: tally.correct },
      { label: 'Missed', value: tally.wrong },
      { label: 'Accuracy', value: formatAccuracy(tally.correct, tally.answered) },
      { label: 'Best streak', value: tally.best },
      { label: 'Time', value: formatDuration(Date.now() - startedAtRef.current) },
    ]
    return <SessionSummary mode="practice" stats={stats} onDashboard={onStop} />
  }

  if (!current) {
    return <LoadingView label="Warming up…" />
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
        <button className="ghost-link" onClick={finishPractice}>
          Finish Practice
        </button>
      </div>
    </div>
  )
}

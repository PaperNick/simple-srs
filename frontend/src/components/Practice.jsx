import { useCallback, useEffect, useRef, useState } from 'react'
import { getPracticeItems, practiceAnswer } from '../api.js'
import { playItemAudio } from '../audio.js'
import { SHORTCUTS, isShortcut } from '../shortcuts.js'
import AnswerInput from './AnswerInput.jsx'
import { ItemDetails } from './LessonCard.jsx'
import ShortcutHints from './ShortcutHints.jsx'

/**
 * Return a new array with the items randomly shuffled.
 *
 * @param {Array} array Items to shuffle.
 * @returns {Array} A shuffled copy.
 */
function shuffle(array) {
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
 *
 * @param {{ dataset: string, onStop: Function }} props
 *   The practice dataset and callback fired when the user stops.
 */
export default function Practice({ dataset, onStop }) {
  const allRef = useRef([]) // full item set
  const sequenceRef = useRef([]) // endless rotation
  const positionRef = useRef(0) // current position in rotation
  const inputRef = useRef(null)

  const [current, setCurrent] = useState(null)
  const [phase, setPhase] = useState('input') // 'input' | 'result'
  const [result, setResult] = useState(null)
  const [value, setValue] = useState('')
  const [tally, setTally] = useState({ answered: 0, correct: 0, wrong: 0, streak: 0, best: 0 })

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
    const handler = event => {
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
      const response = await practiceAnswer(current.id, input)
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

  const onKey = event => {
    if (phase === 'input' && isShortcut(event, SHORTCUTS.submit)) {
      submit()
    } else if (phase === 'result' && isShortcut(event, SHORTCUTS.next)) {
      advance()
    }
  }

  // On the result screen the input is disabled, so let Enter elsewhere act as "Next".
  useEffect(() => {
    const handler = event => {
      if (!isShortcut(event, SHORTCUTS.next) || phase !== 'result') {
        return
      }
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, advance])

  if (!current) {
    return (
      <div className="view">
        <p className="loading">Warming up…</p>
      </div>
    )
  }

  const correct = result ? result.correct : null
  const cardClass = phase === 'result' ? (correct ? 'result-correct' : 'result-incorrect') : ''

  return (
    <div className="view session-view">
      <div className="session-progress practice-stats">
        <span className="stat-chip">#{tally.answered}</span>
        <span className="stat-chip ok">✓ {tally.correct}</span>
        <span className="stat-chip no">✗ {tally.wrong}</span>
        <span className="stat-chip streak">🔥 {tally.streak}</span>
      </div>

      <div className={`card ${cardClass}`}>
        <div className="banner">
          <div className="banner-char">{current.characters}</div>
        </div>
        <div className="subtitle-bar">Character Reading</div>

        {phase === 'result' && (
          <div className={`result-bar ${correct ? 'green' : 'red'}`}>
            {current.readings.join(', ')}
          </div>
        )}

        <div className="answer-zone">
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
        </div>

        {phase === 'result' && <ItemDetails item={current} defaultOpen="reading" />}

        <div className="action-row">
          {phase === 'input' ? (
            <button className="skip-btn" onClick={reveal}>
              Show
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

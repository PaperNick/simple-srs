import { useCallback, useEffect, useRef, useState } from 'react'
import LessonCard from './LessonCard.jsx'
import ReviewCard from './ReviewCard.jsx'
import { startLesson, startReview, completeLesson } from '../api.js'

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
 * Expand a lesson's items into review steps: a meaning step (if the item has a
 * meaning) followed by a reading step.
 *
 * @param {Array} items The lesson items.
 * @returns {Array} The review step list.
 */
function lessonSteps(items) {
  return items.flatMap(item => {
    const reading = { ...item, question_type: 'reading' }
    if (!item.meaning) {
      return [reading]
    }
    return [{ ...item, question_type: 'meaning' }, reading]
  })
}

/**
 * Run a lesson or review session over a dataset, stepping through its cards and
 * completing the lesson (if in lesson mode) when the queue is exhausted.
 *
 * @param {{ mode: 'lesson'|'review', dataset: string, onDone: Function }} props
 *   Session configuration and the callback fired when the session ends.
 */
export default function Session({ mode, dataset, onDone }) {
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const doneRef = useRef(false)

  const finish = useCallback(
    async lessonIds => {
      if (doneRef.current) {
        return
      }
      doneRef.current = true
      if (mode === 'lesson' && lessonIds && lessonIds.length) {
        try {
          await completeLesson(lessonIds)
        } catch (_) {
          /* ignore completion errors */
        }
      }
      onDone()
    },
    [mode, onDone]
  )

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const data = mode === 'lesson' ? await startLesson(dataset) : await startReview(dataset)
        if (cancelled) {
          return
        }
        // The backend returns due items in available_at order; shuffle the
        // review queue so the ordering isn't predictable. Lessons keep order.
        const fetched = mode === 'lesson' ? data.items || [] : data.due || []
        const items = mode === 'lesson' ? fetched : shuffle(fetched)
        if (!items.length) {
          finish()
          return
        }
        // A lesson teaches a word in two steps: meaning, then reading.
        const steps = mode === 'lesson' ? lessonSteps(items) : items
        setQueue(steps)
        setIndex(0)
      } catch (_) {
        finish()
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dataset])

  const current = queue[index]

  const next = useCallback(() => setIndex(current => current + 1), [])

  const reQueue = useCallback(() => {
    if (!current) {
      return
    }
    setQueue(q => [...q, current])
  }, [current])

  useEffect(() => {
    if (loading) {
      return
    }
    if (index >= queue.length) {
      finish(mode === 'lesson' ? [...new Set(queue.map(item => item.id))] : null)
    }
  }, [index, queue, loading, finish, mode])

  if (loading) {
    return (
      <div className="view">
        <p className="loading">Preparing session…</p>
      </div>
    )
  }

  if (!current) {
    return null
  }

  return (
    <div className="view session-view">
      <div className="session-progress">
        {mode === 'lesson' ? 'Lesson' : 'Review'} {Math.min(index + 1, queue.length)} /{' '}
        {queue.length}
      </div>
      {mode === 'lesson' ? (
        <LessonCard
          key={current.id + ':' + current.question_type}
          item={current}
          isLast={index === queue.length - 1}
          onNext={next}
        />
      ) : (
        <ReviewCard
          key={current.id + ':' + current.question_type}
          item={current}
          onMissed={reQueue}
          onNext={next}
        />
      )}

      <div className="below-card-actions">
        <button className="ghost-link" onClick={onDone}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}

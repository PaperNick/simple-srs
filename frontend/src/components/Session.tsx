import { useCallback, useEffect, useRef, useState } from 'react'
import LessonCard from './LessonCard'
import ReviewCard from './ReviewCard'
import { startLesson, startReview, completeLesson, reviewSchedule } from '../api'
import type { Card, QuestionType, ReviewCard as ReviewCardType, SessionMode } from '@shared/types'

interface SessionProps {
  mode: SessionMode
  dataset: string
  autoplayLesson: boolean
  autoplayReview: boolean
  onDone: () => void
}

/** Per-item progress for the current review: required types, those answered correctly, and whether it failed. */
interface ItemProgress {
  required: Set<QuestionType>
  correct: Set<QuestionType>
  failed: boolean
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
 * Expand an item into review steps: a meaning step (if the item has a meaning)
 * and a reading step (if it has a reading). Items with neither are a single
 * self-grade step - they just need to be seen.
 */
function expandSteps(items: Card[]): ReviewCardType[] {
  return items.flatMap(item => {
    const steps: ReviewCardType[] = []
    if (item.meanings.length) {
      steps.push({ ...item, question_type: 'meaning' })
    }
    if (item.readings.length) {
      steps.push({ ...item, question_type: 'reading' })
    }
    if (steps.length === 0) {
      steps.push({ ...item, question_type: 'self-grade' })
    }
    return steps
  })
}

/** The question types an item must answer correctly before it can advance. */
function requiredTypes(item: Card): QuestionType[] {
  const types: QuestionType[] = []
  if (item.readings.length) {
    types.push('reading')
  }
  if (item.meanings.length) {
    types.push('meaning')
  }
  if (types.length === 0) {
    types.push('self-grade')
  }
  return types
}

/**
 * Run a lesson or review session over a dataset, stepping through its cards and
 * completing the lesson (if in lesson mode) when the queue is exhausted.
 */
export default function Session({
  mode,
  dataset,
  autoplayLesson,
  autoplayReview,
  onDone,
}: SessionProps) {
  const [queue, setQueue] = useState<ReviewCardType[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const doneRef = useRef(false)
  const progressRef = useRef<Map<number, ItemProgress>>(new Map())

  const finish = useCallback(
    async (lessonIds?: number[] | null) => {
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
        // The backend returns due items in available_at order; shuffle the
        // review queue so the ordering isn't predictable. Lessons keep order.
        let steps: ReviewCardType[]
        if (mode === 'lesson') {
          const { items } = await startLesson(dataset)
          if (cancelled) {
            return
          }
          if (!items.length) {
            finish()
            return
          }
          // A lesson teaches a word in two steps: meaning, then reading.
          steps = expandSteps(items)
        } else {
          const { due } = await startReview(dataset)
          if (cancelled) {
            return
          }
          if (!due.length) {
            finish()
            return
          }
          // Each due item becomes a reading and/or meaning step, shuffled so the
          // ordering isn't predictable. Track which types each item still needs.
          steps = shuffle(expandSteps(due))
          const progress = new Map<number, ItemProgress>()
          for (const step of steps) {
            if (!progress.has(step.id)) {
              progress.set(step.id, {
                required: new Set(requiredTypes(step)),
                correct: new Set(),
                failed: false,
              })
            }
          }
          progressRef.current = progress
        }
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

  // Apply the SRS schedule for an item once its review is decided.
  const schedule = useCallback((itemId: number, correct: boolean) => {
    reviewSchedule(itemId, correct).catch(() => {
      /* ignore scheduling errors */
    })
  }, [])

  // Called after each review answer. A correct answer is recorded; once every
  // required question type is correct (with no prior miss) the item advances.
  // Any miss drops it to the first stage immediately and re-queues the card,
  // and the item stays at the first stage for the rest of the session.
  const handleAnswered = useCallback(
    (correct: boolean) => {
      if (!current) {
        return
      }
      const progress = progressRef.current.get(current.id)
      if (!progress) {
        return
      }
      if (!correct) {
        progress.failed = true
        schedule(current.id, false)
        setQueue(q => [...q, current])
        return
      }
      progress.correct.add(current.question_type)
      if (!progress.failed && progress.correct.size === progress.required.size) {
        schedule(current.id, true)
      }
    },
    [current, schedule]
  )

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
          autoplay={autoplayLesson}
          onNext={next}
        />
      ) : (
        <ReviewCard
          key={current.id + ':' + current.question_type}
          item={current}
          autoplay={autoplayReview}
          onAnswered={handleAnswered}
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

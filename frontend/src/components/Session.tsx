import { useCallback, useEffect, useRef, useState } from 'react'
import LessonCard from './LessonCard'
import ReviewCard from './ReviewCard'
import type { ReviewCardHandle } from './ReviewCard'
import SessionSummary from './SessionSummary'
import type { SummaryStat } from './SessionSummary'
import { startLesson, startReview, completeLesson, reviewSchedule } from '../api'
import { formatAccuracy, formatDuration } from '../format'
import { shuffle } from '../shuffle'
import type { Card, QuestionType, ReviewCard as ReviewCardType, SessionMode } from '@shared/types'

interface SessionProps {
  mode: SessionMode
  dataset: string
  autoplayLesson: boolean
  autoplayReview: boolean
  markCorrect: boolean
  onDone: () => void
  onReview: () => void
}

interface SessionStats {
  answers: number
  correct: number
  wrong: number
  items: Set<number>
  burned: Set<number>
}

function emptyStats(): SessionStats {
  return {
    answers: 0,
    correct: 0,
    wrong: 0,
    items: new Set(),
    burned: new Set(),
  }
}

function lessonSummary(learned: number, steps: number, elapsed: string): SummaryStat[] {
  return [
    { label: 'Words learned', value: learned },
    { label: 'Lesson steps', value: steps },
    { label: 'Time', value: elapsed },
  ]
}

function reviewSummary(stats: SessionStats, elapsed: string): SummaryStat[] {
  return [
    { label: 'Items reviewed', value: stats.items.size },
    { label: 'Correct', value: stats.correct },
    { label: 'Missed', value: stats.wrong },
    { label: 'Accuracy', value: formatAccuracy(stats.correct, stats.answers) },
    { label: 'Burned', value: stats.burned.size },
    { label: 'Time', value: elapsed },
  ]
}

function LoadingView({ label }: { label: string }) {
  return (
    <div className="view">
      <p className="loading">{label}</p>
    </div>
  )
}

/** Required question types, the ones answered correctly, and any miss. */
interface ItemProgress {
  required: Set<QuestionType>
  correct: Set<QuestionType>
  failed: boolean
}

/** Meaning and reading steps, or one self-grade step if the item has neither. */
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

/** Question types needed to pass an item. */
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

/** Run a lesson or review queue. */
export default function Session({
  mode,
  dataset,
  autoplayLesson,
  autoplayReview,
  markCorrect,
  onDone,
  onReview,
}: SessionProps) {
  const [queue, setQueue] = useState<ReviewCardType[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [summary, setSummary] = useState<SummaryStat[] | null>(null)
  const doneRef = useRef(false)
  const progressRef = useRef<Map<number, ItemProgress>>(new Map())
  const reviewCardRef = useRef<ReviewCardHandle>(null)
  const statsRef = useRef<SessionStats>(emptyStats())
  const pendingRef = useRef<Promise<unknown>[]>([])
  const startedAtRef = useRef(0)

  const finish = useCallback(
    async (lessonIds?: number[] | null) => {
      if (doneRef.current) {
        return
      }
      doneRef.current = true
      setFinishing(true)

      let learned = lessonIds?.length ?? 0
      if (mode === 'lesson' && lessonIds?.length) {
        try {
          const result = await completeLesson(lessonIds)
          learned = result.learned
        } catch (_) {
          /* best effort */
        }
      }

      // Wait for pending schedule calls so burned counts are accurate.
      await Promise.allSettled(pendingRef.current)

      const elapsed = formatDuration(Date.now() - startedAtRef.current)
      setSummary(
        mode === 'lesson'
          ? lessonSummary(learned, queue.length, elapsed)
          : reviewSummary(statsRef.current, elapsed)
      )
      setFinishing(false)
    },
    [mode, queue.length]
  )

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      doneRef.current = false
      progressRef.current = new Map()
      statsRef.current = emptyStats()
      pendingRef.current = []
      try {
        // Shuffle reviews; lessons keep their order.
        let steps: ReviewCardType[]
        if (mode === 'lesson') {
          const { items } = await startLesson(dataset)
          if (cancelled) {
            return
          }
          if (!items.length) {
            onDone()
            return
          }
          // Lessons run meaning then reading.
          steps = expandSteps(items)
        } else {
          const { due } = await startReview(dataset)
          if (cancelled) {
            return
          }
          if (!due.length) {
            onDone()
            return
          }
          // Shuffle steps and track each item's required types.
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
        startedAtRef.current = Date.now()
        setQueue(steps)
        setIndex(0)
      } catch (_) {
        if (!cancelled) {
          onDone()
        }
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
  }, [mode, dataset, onDone])

  const current = queue[index]

  const next = useCallback(() => setIndex(current => current + 1), [])

  // Apply the SRS schedule and record burned items.
  const schedule = useCallback((itemId: number, correct: boolean) => {
    const pending = reviewSchedule(itemId, correct)
      .then(response => {
        if (response.item.burned) {
          statsRef.current.burned.add(itemId)
        }
      })
      .catch(() => {
        /* ignore scheduling errors */
      })
    pendingRef.current.push(pending)
  }, [])

  // Pass once all required types are correct without a miss. A miss resets and
  // re-queues the card.
  const handleAnswered = useCallback(
    (correct: boolean) => {
      if (!current) {
        return
      }
      const progress = progressRef.current.get(current.id)
      if (!progress) {
        return
      }
      const stats = statsRef.current
      stats.items.add(current.id)
      stats.answers += 1
      if (!correct) {
        stats.wrong += 1
        progress.failed = true
        schedule(current.id, false)
        setQueue(q => [...q, current])
        return
      }
      stats.correct += 1
      progress.correct.add(current.question_type)
      if (!progress.failed && progress.correct.size === progress.required.size) {
        schedule(current.id, true)
      }
    },
    [current, schedule]
  )

  // Commit the current card, then show the overview.
  const finishReviewEarly = useCallback(() => {
    reviewCardRef.current?.commit()
    if (statsRef.current.answers === 0) {
      onDone()
      return
    }
    finish()
  }, [finish, onDone])

  useEffect(() => {
    if (loading || queue.length === 0 || index < queue.length) {
      return
    }
    finish(mode === 'lesson' ? [...new Set(queue.map(item => item.id))] : null)
  }, [index, queue, loading, finish, mode])

  if (summary) {
    if (mode === 'lesson') {
      return (
        <SessionSummary mode="lesson" stats={summary} onDashboard={onDone} onReview={onReview} />
      )
    }
    return <SessionSummary mode="review" stats={summary} onDashboard={onDone} />
  }

  if (loading) {
    return <LoadingView label="Preparing session…" />
  }

  // `!current` is the frame between the queue ending and `finish` setting a summary.
  if (finishing || !current) {
    return <LoadingView label="Wrapping up…" />
  }

  const currentStep = Math.min(index + 1, queue.length)
  const progress = queue.length ? (currentStep / queue.length) * 100 : 0

  return (
    <div className="view session-view">
      <div className="session-meter">
        <div className="session-meter-head">
          <span className="session-meter-mode">
            <span className="session-meter-dot" aria-hidden="true" />
            {mode === 'lesson' ? 'Lesson' : 'Review'}
          </span>
          <span className="session-meter-count">
            {currentStep}
            <span className="session-meter-total">/ {queue.length}</span>
          </span>
        </div>
        <div
          className="session-meter-track"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={queue.length}
          aria-valuenow={currentStep}
          aria-label={`${mode === 'lesson' ? 'Lesson' : 'Review'} progress`}
        >
          <span className="session-meter-fill" style={{ width: `${progress}%` }} />
        </div>
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
          ref={reviewCardRef}
          key={current.id + ':' + current.question_type}
          item={current}
          autoplay={autoplayReview}
          markCorrect={markCorrect}
          onAnswered={handleAnswered}
          onNext={next}
        />
      )}

      <div className="below-card-actions">
        {mode === 'review' ? (
          <button className="ghost-link" onClick={finishReviewEarly}>
            Finish Review
          </button>
        ) : (
          <button className="ghost-link" onClick={onDone}>
            Back to Dashboard
          </button>
        )}
      </div>
    </div>
  )
}

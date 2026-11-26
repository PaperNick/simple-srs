import { useCallback, useEffect, useRef, useState } from 'react'
import { reviewSchedule, startReview } from '../api'
import { formatAccuracy, formatDuration } from '../format'
import { buildProgress, expandSteps } from '../session'
import type { ItemProgress } from '../session'
import { shuffle } from '../shuffle'
import LoadingView from './LoadingView'
import ReviewCard from './ReviewCard'
import type { ReviewCardHandle } from './ReviewCard'
import SessionMeter from './SessionMeter'
import SessionSummary from './SessionSummary'
import type { SummaryStat } from './SessionSummary'
import type { Card, ReviewCard as ReviewCardType } from '@shared/types'

interface ReviewSessionProps {
  dataset: string
  autoplay: boolean
  markCorrect: boolean
  onDone: () => void
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

/** Review due items, re-queue misses, then show the review overview. */
export default function ReviewSession({
  dataset,
  autoplay,
  markCorrect,
  onDone,
}: ReviewSessionProps) {
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

  const finish = useCallback(async () => {
    if (doneRef.current) {
      return
    }
    doneRef.current = true
    setFinishing(true)

    // Wait for pending schedule calls so burned counts are accurate.
    await Promise.allSettled(pendingRef.current)

    const elapsed = formatDuration(Date.now() - startedAtRef.current)
    setSummary(reviewSummary(statsRef.current, elapsed))
    setFinishing(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      doneRef.current = false
      progressRef.current = new Map()
      statsRef.current = emptyStats()
      pendingRef.current = []

      let due: Card[] = []
      try {
        due = (await startReview(dataset)).due
      } catch (_) {
        if (!cancelled) {
          onDone()
        }
        return
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }

      if (cancelled) {
        return
      }
      if (!due.length) {
        onDone()
        return
      }
      // Shuffle steps and track each item's required types.
      const steps = shuffle(expandSteps(due))
      progressRef.current = buildProgress(steps)
      startedAtRef.current = Date.now()
      setQueue(steps)
      setIndex(0)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [dataset, onDone])

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
    finish()
  }, [index, queue.length, loading, finish])

  if (summary) {
    return <SessionSummary mode="review" stats={summary} onDashboard={onDone} />
  }

  if (loading) {
    return <LoadingView label="Preparing review…" />
  }

  if (finishing || !current) {
    return <LoadingView label="Wrapping up…" />
  }

  return (
    <div className="view session-view">
      <SessionMeter label="Review" current={index + 1} total={queue.length} />
      <ReviewCard
        ref={reviewCardRef}
        key={current.id + ':' + current.question_type}
        item={current}
        autoplay={autoplay}
        markCorrect={markCorrect}
        onAnswered={handleAnswered}
        onNext={next}
      />
      <div className="below-card-actions">
        <button className="ghost-link" onClick={finishReviewEarly}>
          Finish Review
        </button>
      </div>
    </div>
  )
}

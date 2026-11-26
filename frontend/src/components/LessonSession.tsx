import { useCallback, useEffect, useRef, useState } from 'react'
import { completeLesson, startLesson } from '../api'
import { formatDuration } from '../format'
import { expandSteps } from '../session'
import LessonCard from './LessonCard'
import LoadingView from './LoadingView'
import SessionMeter from './SessionMeter'
import SessionSummary from './SessionSummary'
import type { SummaryStat } from './SessionSummary'
import type { Card, ReviewCard as ReviewCardType } from '@shared/types'

interface LessonSessionProps {
  dataset: string
  autoplay: boolean
  onDone: () => void
  onReview: () => void
}

function lessonSummary(learned: number, steps: number, elapsed: string): SummaryStat[] {
  return [
    { label: 'Words learned', value: learned },
    { label: 'Lesson steps', value: steps },
    { label: 'Time', value: elapsed },
  ]
}

/** Teach new items one step at a time, then show the lesson overview. */
export default function LessonSession({ dataset, autoplay, onDone, onReview }: LessonSessionProps) {
  const [queue, setQueue] = useState<ReviewCardType[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)
  const [summary, setSummary] = useState<SummaryStat[] | null>(null)
  const doneRef = useRef(false)
  const startedAtRef = useRef(0)

  const finish = useCallback(async (lessonIds: number[], steps: number) => {
    if (doneRef.current) {
      return
    }
    doneRef.current = true
    setFinishing(true)

    let learned = lessonIds.length
    const result = await completeLesson(lessonIds).catch(() => null)
    if (result) {
      learned = result.learned
    }

    const elapsed = formatDuration(Date.now() - startedAtRef.current)
    setSummary(lessonSummary(learned, steps, elapsed))
    setFinishing(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      doneRef.current = false

      let items: Card[] = []
      try {
        items = (await startLesson(dataset)).items
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
      if (!items.length) {
        onDone()
        return
      }
      startedAtRef.current = Date.now()
      setQueue(expandSteps(items))
      setIndex(0)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [dataset, onDone])

  const next = useCallback(() => setIndex(current => current + 1), [])

  useEffect(() => {
    if (loading || queue.length === 0 || index < queue.length) {
      return
    }
    finish([...new Set(queue.map(item => item.id))], queue.length)
  }, [index, queue, loading, finish])

  if (summary) {
    return <SessionSummary mode="lesson" stats={summary} onDashboard={onDone} onReview={onReview} />
  }

  if (loading) {
    return <LoadingView label="Preparing lesson…" />
  }

  const current = queue[index]
  if (finishing || !current) {
    return <LoadingView label="Wrapping up…" />
  }

  return (
    <div className="view session-view">
      <SessionMeter label="Lesson" current={index + 1} total={queue.length} />
      <LessonCard
        key={current.id + ':' + current.question_type}
        item={current}
        isLast={index === queue.length - 1}
        autoplay={autoplay}
        onNext={next}
      />
      <div className="below-card-actions">
        <button className="ghost-link" onClick={onDone}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}

import LessonSession from './LessonSession'
import ReviewSession from './ReviewSession'
import type { SessionMode } from '@shared/types'

interface SessionProps {
  mode: SessionMode
  dataset: string
  autoplayLesson: boolean
  autoplayReview: boolean
  markCorrect: boolean
  onDone: () => void
  onReview: () => void
}

/** Route a session to its lesson or review implementation. */
export default function Session({
  mode,
  dataset,
  autoplayLesson,
  autoplayReview,
  markCorrect,
  onDone,
  onReview,
}: SessionProps) {
  if (mode === 'lesson') {
    return (
      <LessonSession
        dataset={dataset}
        autoplay={autoplayLesson}
        onDone={onDone}
        onReview={onReview}
      />
    )
  }

  return (
    <ReviewSession
      dataset={dataset}
      autoplay={autoplayReview}
      markCorrect={markCorrect}
      onDone={onDone}
    />
  )
}

import type { Card, QuestionType, ReviewCard } from '@shared/types'

/** Required question types, the ones answered correctly, and any miss. */
export interface ItemProgress {
  required: Set<QuestionType>
  correct: Set<QuestionType>
  failed: boolean
}

/** Meaning and reading steps, or one self-grade step if the item has neither. */
export function expandSteps(items: Card[]): ReviewCard[] {
  return items.flatMap(item => {
    const steps: ReviewCard[] = []
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
export function requiredTypes(item: Card): QuestionType[] {
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

/** Build the per-item progress map for a review queue. */
export function buildProgress(steps: ReviewCard[]): Map<number, ItemProgress> {
  const progress = new Map<number, ItemProgress>()
  for (const step of steps) {
    if (progress.has(step.id)) {
      continue
    }
    progress.set(step.id, {
      required: new Set(requiredTypes(step)),
      correct: new Set(),
      failed: false,
    })
  }
  return progress
}

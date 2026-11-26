import { describe, expect, it } from 'vitest'
import { buildProgress, expandSteps, requiredTypes } from './session'
import type { Card } from '@shared/types'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    type: 'vocabulary',
    level: 1,
    characters: '한',
    readings: [],
    meanings: [],
    audio: null,
    ...overrides,
  }
}

describe('expandSteps', () => {
  it('asks meaning then reading when the card has both', () => {
    const card = makeCard({ meanings: ['Korean'], readings: ['han'] })

    expect(expandSteps([card]).map(step => step.question_type)).toEqual(['meaning', 'reading'])
  })

  it('keeps the card fields on each step', () => {
    const card = makeCard({ id: 7, meanings: ['Korean'], readings: ['han'] })

    expect(expandSteps([card])).toEqual([
      { ...card, question_type: 'meaning' },
      { ...card, question_type: 'reading' },
    ])
  })

  it('falls back to reading or meaning when only one side exists', () => {
    expect(expandSteps([makeCard({ readings: ['han'] })]).map(s => s.question_type)).toEqual([
      'reading',
    ])
    expect(expandSteps([makeCard({ meanings: ['Korean'] })]).map(s => s.question_type)).toEqual([
      'meaning',
    ])
  })

  it('uses one self-grade step when the card has neither', () => {
    expect(expandSteps([makeCard()]).map(step => step.question_type)).toEqual(['self-grade'])
  })

  it('flattens steps for every item in order', () => {
    const first = makeCard({ id: 1, readings: ['a'], meanings: ['A'] })
    const second = makeCard({ id: 2, readings: [], meanings: [] })

    expect(expandSteps([first, second]).map(step => step.id)).toEqual([1, 1, 2])
  })
})

describe('requiredTypes', () => {
  it('requires both reading and meaning when both exist', () => {
    expect(requiredTypes(makeCard({ readings: ['han'], meanings: ['Korean'] }))).toEqual([
      'reading',
      'meaning',
    ])
  })

  it('requires only the side that exists', () => {
    expect(requiredTypes(makeCard({ readings: ['han'] }))).toEqual(['reading'])
    expect(requiredTypes(makeCard({ meanings: ['Korean'] }))).toEqual(['meaning'])
  })

  it('requires a self-grade step when the card has neither', () => {
    expect(requiredTypes(makeCard())).toEqual(['self-grade'])
  })
})

describe('buildProgress', () => {
  it('creates one entry per item with its required types', () => {
    const readingOnly = makeCard({ id: 1, readings: ['han'] })
    const both = makeCard({ id: 2, readings: ['han'], meanings: ['Korean'] })

    const progress = buildProgress(expandSteps([readingOnly, both]))

    expect(progress.size).toBe(2)
    expect(progress.get(1)?.required).toEqual(new Set(['reading']))
    expect(progress.get(2)?.required).toEqual(new Set(['reading', 'meaning']))
  })

  it('starts items unanswered and unfailed', () => {
    const progress = buildProgress(expandSteps([makeCard({ id: 1, readings: ['han'] })]))

    expect(progress.get(1)).toEqual({
      required: new Set(['reading']),
      correct: new Set(),
      failed: false,
    })
  })

  it('ignores duplicate steps for the same item', () => {
    const card = makeCard({ id: 1, readings: ['han'], meanings: ['Korean'] })

    expect(buildProgress(expandSteps([card])).size).toBe(1)
  })
})

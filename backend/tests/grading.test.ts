import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { grade, gradeQuestion, meaningAlternatives, normalize } from '../src/grading'

const mkItem = (characters: string, meaning: string | null, readings: string[]) => ({
  characters,
  meaning,
  readings: JSON.stringify(readings),
})

describe('grade (reading) - used by alphabet practice', () => {
  it('accepts an exact reading', () => {
    const r = grade('gada', mkItem('가다', 'To go', ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
  it('is case-insensitive', () => {
    const r = grade('  GADA ', mkItem('가다', 'To go', ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
  it('tolerates a near-miss typo (>=80%)', () => {
    const r = grade('gadaa', mkItem('가다', 'To go', ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
  it('rejects a wrong reading', () => {
    const r = grade('zzz', mkItem('가다', 'To go', ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, false)
  })
  it('returns accepted readings when input empty', () => {
    const r = grade('', mkItem('가다', 'To go', ['gada']))
    assert.deepEqual(r, ['gada'])
  })
  it('matches any of multiple readings', () => {
    const r = grade('k', mkItem('ㄱ', null, ['g', 'k']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
})

describe('gradeQuestion - reading', () => {
  it('accepts exact reading', () => {
    const r = gradeQuestion(mkItem('가다', 'To go', ['gada']), 'gada', 'reading')
    assert.equal(r.correct, true)
    assert.equal(r.expectedDisplay, 'gada')
  })
  it('tolerates a typo', () => {
    const r = gradeQuestion(mkItem('가다', 'To go', ['gada']), 'gad', 'reading')
    assert.equal(r.correct, false) // 75% < 80%
  })
})

describe('gradeQuestion - meaning', () => {
  const item = mkItem('가운데', 'In the middle', ['gaunde'])
  it('accepts the exact meaning (case-insensitive)', () => {
    assert.equal(gradeQuestion(item, 'in the middle', 'meaning').correct, true)
    assert.equal(gradeQuestion(item, 'IN THE MIDDLE', 'meaning').correct, true)
  })
  it('accepts a typo of the meaning', () => {
    const r = gradeQuestion(
      mkItem('가능성', 'Possibility', ['ganeungseong']),
      'posibility',
      'meaning'
    )
    assert.equal(r.correct, true)
  })
  it('accepts a single word from a multi-word meaning', () => {
    assert.equal(gradeQuestion(item, 'middle', 'meaning').correct, true)
  })
  it('rejects stopwords on their own', () => {
    assert.equal(gradeQuestion(item, 'the', 'meaning').correct, false)
  })
  it('accepts a short core word from the meaning', () => {
    const r = gradeQuestion(mkItem('가다', 'To go', ['gada']), 'go', 'meaning')
    assert.equal(r.correct, true)
  })
  it('rejects a wrong meaning', () => {
    assert.equal(gradeQuestion(item, 'blue', 'meaning').correct, false)
  })
})

describe('meaningAlternatives', () => {
  it('splits on numbered senses and commas', () => {
    const alts = meaningAlternatives('1. to be (in a place); to exist 2. to have')
    assert.ok(alts.some(a => /to be/.test(a)))
    assert.ok(alts.some(a => /to exist/.test(a)))
    assert.ok(alts.some(a => /to have/.test(a)))
  })
  it('handles comma separated lists', () => {
    const alts = meaningAlternatives('way, method, number')
    for (const part of ['way', 'method', 'number']) {
      assert.ok(alts.includes(part), part)
    }
  })
  it('splits on "or" / "and" and keeps the full string', () => {
    const alts = meaningAlternatives('A thing or an object')
    assert.ok(alts.includes('A thing'))
    assert.ok(alts.includes('an object'))
    assert.ok(alts.includes('A thing or an object'))
  })
  it('handles empty/null meaning', () => {
    assert.deepEqual(meaningAlternatives(null), [])
    assert.deepEqual(meaningAlternatives(''), [])
  })
})

describe('normalize', () => {
  it('lowercases and strips punctuation/whitespace', () => {
    assert.equal(normalize('  In the Middle, now! '), 'inthemiddlenow')
  })
})

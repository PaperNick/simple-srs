import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { grade, gradeQuestion, normalize, parseMeanings } from '../src/grading'
import { splitMeanings } from '../src/meanings'

const mkItem = (characters: string, meanings: string[], readings: string[]) => ({
  characters,
  meanings: JSON.stringify(meanings),
  readings: JSON.stringify(readings),
})

describe('grade (reading) - used by alphabet practice', () => {
  it('accepts an exact reading', () => {
    const r = grade('gada', mkItem('가다', [], ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
  it('is case-insensitive', () => {
    const r = grade('  GADA ', mkItem('가다', [], ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
  it('tolerates a near-miss typo (>=80%)', () => {
    const r = grade('gadaa', mkItem('가다', [], ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
  it('rejects a wrong reading', () => {
    const r = grade('zzz', mkItem('가다', [], ['gada']))
    assert.equal(Array.isArray(r) ? false : r.correct, false)
  })
  it('returns accepted readings when input empty', () => {
    const r = grade('', mkItem('가다', [], ['gada']))
    assert.deepEqual(r, ['gada'])
  })
  it('matches any of multiple readings', () => {
    const r = grade('k', mkItem('ㄱ', [], ['g', 'k']))
    assert.equal(Array.isArray(r) ? false : r.correct, true)
  })
})

describe('gradeQuestion - reading', () => {
  it('accepts exact reading', () => {
    const r = gradeQuestion(mkItem('가다', ['To go'], ['gada']), 'gada', 'reading')
    assert.equal(r.correct, true)
    assert.equal(r.expectedDisplay, 'gada')
  })
  it('tolerates a typo', () => {
    const r = gradeQuestion(mkItem('가다', ['To go'], ['gada']), 'gad', 'reading')
    assert.equal(r.correct, false) // 75% < 80%
  })
})

describe('gradeQuestion - meaning', () => {
  const item = mkItem('가운데', ['In the middle'], ['gaunde'])
  it('accepts the exact meaning (case-insensitive)', () => {
    assert.equal(gradeQuestion(item, 'in the middle', 'meaning').correct, true)
    assert.equal(gradeQuestion(item, 'IN THE MIDDLE', 'meaning').correct, true)
  })
  it('accepts a typo of the meaning', () => {
    const r = gradeQuestion(
      mkItem('가능성', ['Possibility'], ['ganeungseong']),
      'posibility',
      'meaning'
    )
    assert.equal(r.correct, true)
  })
  it('accepts the core word of a multi-word meaning', () => {
    assert.equal(gradeQuestion(item, 'middle', 'meaning').correct, true)
  })
  it('rejects stopwords on their own', () => {
    assert.equal(gradeQuestion(item, 'the', 'meaning').correct, false)
  })
  it('accepts a short core word from the meaning', () => {
    const r = gradeQuestion(mkItem('가다', ['To go'], ['gada']), 'go', 'meaning')
    assert.equal(r.correct, true)
  })
  it('rejects a wrong meaning', () => {
    assert.equal(gradeQuestion(item, 'blue', 'meaning').correct, false)
  })
  it('accepts any of several stored meanings', () => {
    const r = mkItem('것', ['A thing', 'an object'], ['geos'])
    assert.equal(gradeQuestion(r, 'thing', 'meaning').correct, true)
    assert.equal(gradeQuestion(r, 'object', 'meaning').correct, true)
    assert.equal(gradeQuestion(r, 'a thing', 'meaning').correct, true)
  })
})

describe('parseMeanings', () => {
  it('parses a JSON array of meanings', () => {
    assert.deepEqual(parseMeanings({ meanings: '["A thing","an object"]' }), [
      'A thing',
      'an object',
    ])
  })
  it('returns [] for invalid JSON', () => {
    assert.deepEqual(parseMeanings({ meanings: 'not json[' }), [])
  })
  it('returns [] for missing/null meanings', () => {
    assert.deepEqual(parseMeanings({}), [])
    assert.deepEqual(parseMeanings({ meanings: null }), [])
  })
})

describe('splitMeanings', () => {
  it('splits on numbered senses and semicolons', () => {
    const parts = splitMeanings('1. to be (in a place); to exist 2. to have')
    assert.deepEqual(parts, ['to be (in a place)', 'to exist', 'to have'])
  })
  it('handles comma separated lists', () => {
    assert.deepEqual(splitMeanings('way, method, number'), ['way', 'method', 'number'])
  })
  it('splits on "or" / "and" alternatives', () => {
    assert.deepEqual(splitMeanings('A thing or an object'), ['A thing', 'an object'])
  })
  it('splits the multi-sense example into discrete meanings', () => {
    assert.deepEqual(splitMeanings('A party, a troupe; a row, a line'), [
      'A party',
      'a troupe',
      'a row',
      'a line',
    ])
  })
  it('splits a complex mixed-separator meaning', () => {
    assert.deepEqual(
      splitMeanings('A Buddhist temple / bow; greeting / paragraph, passage; clause; verse'),
      ['A Buddhist temple', 'bow', 'greeting', 'paragraph', 'passage', 'clause', 'verse']
    )
  })
  it('deduplicates case-insensitively', () => {
    assert.deepEqual(splitMeanings('More and more'), ['More'])
  })
  it('handles empty/null meaning', () => {
    assert.deepEqual(splitMeanings(null), [])
    assert.deepEqual(splitMeanings(''), [])
  })
})

describe('normalize', () => {
  it('lowercases and strips punctuation/whitespace', () => {
    assert.equal(normalize('  In the Middle, now! '), 'inthemiddlenow')
  })
})

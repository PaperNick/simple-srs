'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const grading = require('../src/grading.js')

const mkItem = (characters, meaning, readings) => ({
  characters,
  meaning,
  readings: JSON.stringify(readings),
})

describe('grade (reading) - used by alphabet practice', () => {
  it('accepts an exact reading', () => {
    const r = grading.grade('gada', mkItem('가다', 'To go', ['gada']))
    assert.equal(r.correct, true)
  })
  it('is case-insensitive', () => {
    const r = grading.grade('  GADA ', mkItem('가다', 'To go', ['gada']))
    assert.equal(r.correct, true)
  })
  it('tolerates a near-miss typo (>=80%)', () => {
    const r = grading.grade('gadaa', mkItem('가다', 'To go', ['gada']))
    assert.equal(r.correct, true)
  })
  it('rejects a wrong reading', () => {
    const r = grading.grade('zzz', mkItem('가다', 'To go', ['gada']))
    assert.equal(r.correct, false)
  })
  it('returns accepted readings when input empty', () => {
    const r = grading.grade('', mkItem('가다', 'To go', ['gada']))
    assert.deepEqual(r, ['gada'])
  })
  it('matches any of multiple readings', () => {
    const r = grading.grade('k', mkItem('ㄱ', null, ['g', 'k']))
    assert.equal(r.correct, true)
  })
})

describe('gradeQuestion - reading', () => {
  it('accepts exact reading', () => {
    const r = grading.gradeQuestion(mkItem('가다', 'To go', ['gada']), 'gada', 'reading')
    assert.equal(r.correct, true)
    assert.equal(r.expectedDisplay, 'gada')
  })
  it('tolerates a typo', () => {
    const r = grading.gradeQuestion(mkItem('가다', 'To go', ['gada']), 'gad', 'reading')
    assert.equal(r.correct, false) // 75% < 80%
  })
})

describe('gradeQuestion - meaning', () => {
  const item = mkItem('가운데', 'In the middle', ['gaunde'])
  it('accepts the exact meaning (case-insensitive)', () => {
    assert.equal(grading.gradeQuestion(item, 'in the middle', 'meaning').correct, true)
    assert.equal(grading.gradeQuestion(item, 'IN THE MIDDLE', 'meaning').correct, true)
  })
  it('accepts a typo of the meaning', () => {
    const r = grading.gradeQuestion(
      mkItem('가능성', 'Possibility', ['ganeungseong']),
      'posibility',
      'meaning'
    )
    assert.equal(r.correct, true)
  })
  it('accepts a single word from a multi-word meaning', () => {
    assert.equal(grading.gradeQuestion(item, 'middle', 'meaning').correct, true)
  })
  it('rejects stopwords on their own', () => {
    assert.equal(grading.gradeQuestion(item, 'the', 'meaning').correct, false)
  })
  it('accepts a short core word from the meaning', () => {
    const r = grading.gradeQuestion(mkItem('가다', 'To go', ['gada']), 'go', 'meaning')
    assert.equal(r.correct, true)
  })
  it('rejects a wrong meaning', () => {
    assert.equal(grading.gradeQuestion(item, 'blue', 'meaning').correct, false)
  })
})

describe('meaningAlternatives', () => {
  it('splits on numbered senses and commas', () => {
    const alts = grading.meaningAlternatives('1. to be (in a place); to exist 2. to have')
    assert.ok(alts.some(a => /to be/.test(a)))
    assert.ok(alts.some(a => /to exist/.test(a)))
    assert.ok(alts.some(a => /to have/.test(a)))
  })
  it('handles comma separated lists', () => {
    const alts = grading.meaningAlternatives('way, method, number')
    for (const part of ['way', 'method', 'number']) {
      assert.ok(alts.includes(part), part)
    }
  })
  it('splits on "or" / "and" and keeps the full string', () => {
    const alts = grading.meaningAlternatives('A thing or an object')
    assert.ok(alts.includes('A thing'))
    assert.ok(alts.includes('an object'))
    assert.ok(alts.includes('A thing or an object'))
  })
  it('handles empty/null meaning', () => {
    assert.deepEqual(grading.meaningAlternatives(null), [])
    assert.deepEqual(grading.meaningAlternatives(''), [])
  })
})

describe('normalize', () => {
  it('lowercases and strips punctuation/whitespace', () => {
    assert.equal(grading.normalize('  In the Middle, now! '), 'inthemiddlenow')
  })
})

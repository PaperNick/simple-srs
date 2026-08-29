import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { levenshtein, normalize, similar } from '../src/grading'

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    assert.equal(levenshtein('gada', 'gada'), 0)
  })
  it('counts substitutions', () => {
    assert.equal(levenshtein('kitten', 'sitten'), 1)
  })
  it('counts insertions', () => {
    assert.equal(levenshtein('gada', 'gadaa'), 1)
  })
  it('counts deletions', () => {
    assert.equal(levenshtein('gada', 'gad'), 1)
  })
  it('handles empty string', () => {
    assert.equal(levenshtein('', 'abc'), 3)
    assert.equal(levenshtein('abc', ''), 3)
  })
})

describe('similar', () => {
  it('is exact for identical strings', () => {
    assert.equal(similar('gada', 'gada'), true)
  })
  it('rejects unrelated strings', () => {
    assert.equal(similar('gada', 'xyzzy'), false)
  })
  it('accepts a single-char typo in a long word (>=80%)', () => {
    assert.equal(similar('ganeungseong', 'gneungseong'), true)
  })
  it('rejects when below the threshold', () => {
    // 'gad' vs 'gada' is distance 1 over max 4 => 75% < 80%
    assert.equal(similar('gada', 'gad'), false)
  })
  it('rejects very short answers to avoid trivial matches', () => {
    assert.equal(similar('su', 's'), false)
  })
  it('is case-insensitive through normalize (grade path)', () => {
    assert.equal(similar(normalize('gada'), normalize('GADA')), true)
  })
  it('boundary: exactly 80% counts as correct', () => {
    // 'gadaa' vs 'gada' => distance 1 / max 5 = 0.8
    assert.equal(similar('gada', 'gadaa'), true)
    // 'gad' vs 'gada' => 2/3 => 0.75 => false
    assert.equal(similar('gada', 'gad'), false)
  })
})

'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const grading = require('../src/grading.js')

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    assert.equal(grading.levenshtein('gada', 'gada'), 0)
  })
  it('counts substitutions', () => {
    assert.equal(grading.levenshtein('kitten', 'sitten'), 1)
  })
  it('counts insertions', () => {
    assert.equal(grading.levenshtein('gada', 'gadaa'), 1)
  })
  it('counts deletions', () => {
    assert.equal(grading.levenshtein('gada', 'gad'), 1)
  })
  it('handles empty string', () => {
    assert.equal(grading.levenshtein('', 'abc'), 3)
    assert.equal(grading.levenshtein('abc', ''), 3)
  })
})

describe('similar', () => {
  it('is exact for identical strings', () => {
    assert.equal(grading.similar('gada', 'gada'), true)
  })
  it('rejects unrelated strings', () => {
    assert.equal(grading.similar('gada', 'xyzzy'), false)
  })
  it('accepts a single-char typo in a long word (>=80%)', () => {
    assert.equal(grading.similar('ganeungseong', 'gneungseong'), true)
  })
  it('rejects when below the threshold', () => {
    // 'gad' vs 'gada' is distance 1 over max 4 => 75% < 80%
    assert.equal(grading.similar('gada', 'gad'), false)
  })
  it('rejects very short answers to avoid trivial matches', () => {
    assert.equal(grading.similar('su', 's'), false)
  })
  it('is case-insensitive through normalize (grade path)', () => {
    assert.equal(grading.similar(grading.normalize('gada'), grading.normalize('GADA')), true)
  })
  it('boundary: exactly 80% counts as correct', () => {
    // 'gadaa' vs 'gada' => distance 1 / max 5 = 0.8
    assert.equal(grading.similar('gada', 'gadaa'), true)
    // 'gad' vs 'gada' => 2/3 => 0.75 => false
    assert.equal(grading.similar('gada', 'gad'), false)
  })
})

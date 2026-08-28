'use strict'

/**
 * Parse an item's `readings` JSON column into an array of romanizations.
 *
 * @param {{ readings?: string }} item A database row.
 * @returns {string[]} The readings, or an empty array if unparsable/absent.
 */
function parseReadings(item) {
  try {
    return JSON.parse(item.readings || '[]')
  } catch (_) {
    return []
  }
}

/**
 * Normalize a comparison string: lowercase and strip punctuation/whitespace so
 * typed and expected answers can be compared consistently.
 *
 * @param {string} value The value to normalize.
 * @returns {string} The normalized string.
 */
function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-'’".,;:!?()\[\]{}]/g, '')
}

/**
 * Compute the Levenshtein (edit) distance between two strings: the minimum
 * number of single-character insertions, deletions or substitutions required to
 * transform one into the other.
 *
 * @param {string} left The first string.
 * @param {string} right The second string.
 * @returns {number} The edit distance.
 */
function levenshtein(left, right) {
  const leftLength = left.length
  const rightLength = right.length

  if (leftLength === 0) {
    return rightLength
  }
  if (rightLength === 0) {
    return leftLength
  }

  let previousRow = Array.from({ length: rightLength + 1 }, (_, colIndex) => colIndex)
  let currentRow = new Array(rightLength + 1)

  for (let rowIndex = 1; rowIndex <= leftLength; rowIndex++) {
    currentRow[0] = rowIndex
    for (let colIndex = 1; colIndex <= rightLength; colIndex++) {
      const substitutionCost = left[rowIndex - 1] === right[colIndex - 1] ? 0 : 1
      currentRow[colIndex] = Math.min(
        currentRow[colIndex - 1] + 1,
        previousRow[colIndex] + 1,
        previousRow[colIndex - 1] + substitutionCost
      )
    }
    const previousRowCopy = previousRow
    previousRow = currentRow
    currentRow = previousRowCopy
  }

  return previousRow[rightLength]
}

/**
 * Similarity in [0, 1]: 1 - editDistance / maxLen. A typed answer counts as
 * correct when it is at least SIM_THRESHOLD similar to an accepted form.
 */
const SIM_THRESHOLD = 0.8

/**
 * Return whether a typed answer is close enough (>= SIM_THRESHOLD) to an
 * accepted form, guarding against trivially matching very short strings.
 *
 * @param {string} accepted The expected answer.
 * @param {string} typed The user's answer.
 * @returns {boolean} True when the answer is considered a match.
 */
function similar(accepted, typed) {
  if (!accepted || !typed) {
    return false
  }
  if (accepted === typed) {
    return true
  }
  if (Math.min(accepted.length, typed.length) < 2) {
    return false
  }

  const maxLength = Math.max(accepted.length, typed.length)
  const score = 1 - levenshtein(accepted, typed) / maxLength
  return score >= SIM_THRESHOLD
}

/**
 * Common English stopwords - accepted only if the whole meaning matches, so
 * short/loose answers like "the" aren't scored correct for a multi-word meaning.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'at',
  'be',
  'do',
  'is',
  'and',
  'or',
])

/**
 * Grade a reading answer for an item. With no input, returns the list of
 * accepted (normalized) readings.
 *
 * @param {string} input The user's typed answer.
 * @param {{ readings?: string }} item A database row.
 * @returns {Array<string>|{accepted: string[], correct: boolean}} The accepted
 *   readings when input is empty, otherwise a correctness result.
 */
function grade(input, item) {
  const answer = normalize(input)
  const readings = parseReadings(item).map(normalize)

  if (!answer) {
    return readings
  }

  return {
    accepted: readings,
    correct: readings.some(reading => similar(reading, answer)),
  }
}

/**
 * Split a meaning string into individual acceptable answers. English meanings
 * can hold multiple senses ("1. to go 2. to leave"), comma/slash lists, or
 * conjunction-separated alternatives ("a thing or an object"). The full string
 * is always kept as an answer too.
 *
 * @param {string} meaning The item's English meaning.
 * @returns {string[]} Distinct acceptable answer strings.
 */
function meaningAlternatives(meaning) {
  if (!meaning) {
    return []
  }

  const full = String(meaning).trim()
  const parts = new Set()
  const add = part => {
    const trimmed = part.trim()
    if (trimmed) {
      parts.add(trimmed)
    }
  }

  full.split(/\s*(?:\d+\.|;|\/|,|\bor\b|\band\b)\s*/i).forEach(add)
  add(full)
  return [...parts]
}

/**
 * Grade an item for a given question type: 'meaning' compares the English
 * meaning, anything else compares the romanized reading.
 *
 * @param {{ readings?: string, meaning?: string }} item A database row.
 * @param {string} input The user's typed answer.
 * @param {string} questionType 'meaning' | 'reading'.
 * @returns {{correct: boolean, accepted: string[], expectedDisplay: string}}
 *   The result plus the accepted answers and a human-readable expectation.
 */
function gradeQuestion(item, input, questionType) {
  const answer = normalize(input)

  if (questionType === 'meaning') {
    const alternatives = meaningAlternatives(item.meaning)
    const correct = isMeaningMatch(alternatives, answer)
    return { correct, accepted: alternatives, expectedDisplay: item.meaning }
  }

  const readings = parseReadings(item)
  const normalizedReadings = readings.map(normalize)
  const correct = !!answer && normalizedReadings.some(reading => similar(reading, answer))
  return {
    correct,
    accepted: normalizedReadings,
    expectedDisplay: readings.join(', '),
  }
}

/**
 * Decide whether an answer is correct for a meaning question. Accepts exact or
 * >=80% similar alternatives, or a partial word contained in an alternative,
 * while rejecting bare stopwords and very short answers.
 *
 * @param {string[]} alternatives Accepted meaning strings.
 * @param {string} answer The normalized user answer.
 * @returns {boolean} True when the answer counts as correct.
 */
function isMeaningMatch(alternatives, answer) {
  if (!answer) {
    return false
  }

  for (const alternative of alternatives) {
    const normalized = normalize(alternative)
    if (similar(normalized, answer)) {
      return true
    }
    if (answer.length < 2) {
      continue
    }
    if (STOPWORDS.has(answer) || STOPWORDS.has(normalized)) {
      continue
    }
    if (normalized.includes(answer)) {
      return true
    }
  }

  return false
}

module.exports = {
  parseReadings,
  normalize,
  levenshtein,
  similar,
  grade,
  gradeQuestion,
  meaningAlternatives,
  isMeaningMatch,
  SIM_THRESHOLD,
}

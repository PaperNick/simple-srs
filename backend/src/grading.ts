import type { GradeResult } from '@shared/types'

interface ReadingsItem {
  readings?: string | null
}

interface MeaningsItem {
  meanings?: string | null
}

interface GradeItem extends ReadingsItem, MeaningsItem {}

/** Parse an item's `readings` JSON column into an array of romanizations. */
function parseReadings(item: ReadingsItem): string[] {
  try {
    return JSON.parse(item.readings || '[]') as string[]
  } catch (_) {
    return []
  }
}

/** Parse an item's `meanings` JSON column into an array of meanings. */
function parseMeanings(item: MeaningsItem): string[] {
  try {
    return JSON.parse(item.meanings || '[]') as string[]
  } catch (_) {
    return []
  }
}

/**
 * Normalize a comparison string: lowercase and strip punctuation/whitespace so
 * typed and expected answers can be compared consistently.
 */
function normalize(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-'’".,;:!?()\[\]{}]/g, '')
}

/**
 * Compute the Levenshtein (edit) distance between two strings: the minimum
 * number of single-character insertions, deletions or substitutions required to
 * transform one into the other.
 */
function levenshtein(left: string, right: string): number {
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
 */
function similar(accepted: string, typed: string): boolean {
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
 * Common English stopwords, dropped before comparing a meaning with a typed
 * answer so articles/prepositions don't force the learner to type them.
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
 */
function grade(
  input: string,
  item: GradeItem
): string[] | { accepted: string[]; correct: boolean } {
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
 * Extract the significant words of a meaning/answer: lowercased tokens, minus
 * stopwords and punctuation. Used to compare meanings with typed answers as a
 * full-string match while ignoring articles/prepositions.
 */
function contentWords(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 0 && !STOPWORDS.has(word))
}

/**
 * Grade an item for a given question type: 'meaning' compares the English
 * meaning, anything else compares the romanized reading.
 */
function gradeQuestion(
  item: GradeItem,
  input: string,
  questionType: 'meaning' | 'reading'
): GradeResult {
  const answer = normalize(input)

  if (questionType === 'meaning') {
    const meanings = parseMeanings(item)
    const correct = meanings.some(meaning => isMeaningMatch(meaning, input))
    return { correct, accepted: meanings, expectedDisplay: meanings.join(', ') }
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
 * Decide whether a typed answer matches a single meaning. The meaning and
 * answer are reduced to their content words (stopwords dropped) and compared as
 * a full string, tolerating a small typo (>= SIM_THRESHOLD similar).
 */
function isMeaningMatch(meaning: string, answer: string): boolean {
  const meaningKey = contentWords(meaning).join(' ')
  const answerKey = contentWords(answer).join(' ')

  if (!meaningKey || !answerKey) {
    return false
  }

  return similar(meaningKey, answerKey)
}

export {
  parseReadings,
  parseMeanings,
  normalize,
  levenshtein,
  similar,
  grade,
  gradeQuestion,
  isMeaningMatch,
  SIM_THRESHOLD,
}

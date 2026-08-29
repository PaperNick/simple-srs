import type { GradeResult } from '@shared/types'

interface ReadingsItem {
  readings?: string | null
}

interface GradeItem extends ReadingsItem {
  meaning?: string | null
}

/** Parse an item's `readings` JSON column into an array of romanizations. */
function parseReadings(item: ReadingsItem): string[] {
  try {
    return JSON.parse(item.readings || '[]') as string[]
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
 * Split a meaning string into individual acceptable answers. English meanings
 * can hold multiple senses ("1. to go 2. to leave"), comma/slash lists, or
 * conjunction-separated alternatives ("a thing or an object"). The full string
 * is always kept as an answer too.
 */
function meaningAlternatives(meaning: string | null | undefined): string[] {
  if (!meaning) {
    return []
  }

  const full = String(meaning).trim()
  const parts = new Set<string>()
  const add = (part: string) => {
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
 */
function gradeQuestion(
  item: GradeItem,
  input: string,
  questionType: 'meaning' | 'reading'
): GradeResult {
  const answer = normalize(input)

  if (questionType === 'meaning') {
    const alternatives = meaningAlternatives(item.meaning)
    const correct = isMeaningMatch(alternatives, answer)
    return { correct, accepted: alternatives, expectedDisplay: item.meaning ?? '' }
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
 */
function isMeaningMatch(alternatives: string[], answer: string): boolean {
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

export {
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

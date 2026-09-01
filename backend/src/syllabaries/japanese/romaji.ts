import kanaJson from './kana.json'

/**
 * Japanese kana helpers.
 *
 * Provides syllabary conversion (hiragana <-> katakana) and kana -> Hepburn
 * romaji conversion, including digraphs (きゃ -> kya), the sokuon っ
 * (がっこう -> gakkou) and the long vowel mark ー (トーキョー -> tookyoo).
 * Non-kana characters pass through unchanged.
 */

const HIRAGANA: Record<string, string> = kanaJson.HIRAGANA
const DIGRAPHS: Record<string, string> = kanaJson.DIGRAPHS

// Hiragana and katakana are offset by a fixed amount in Unicode.
const HIRAGANA_START = 0x3041
const HIRAGANA_END = 0x3096
const KATAKANA_START = 0x30a1
const KATAKANA_END = 0x30f6
const KANA_OFFSET = 0x60

/** Shift characters in [from, to] by offset, leaving everything else intact. */
function transliterate(input: string, from: number, to: number, offset: number): string {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0)!
    out += code >= from && code <= to ? String.fromCodePoint(code + offset) : char
  }
  return out
}

/** Convert katakana to hiragana. */
export function katakanaToHiragana(char: string): string {
  return transliterate(char, KATAKANA_START, KATAKANA_END, -KANA_OFFSET)
}

/** Convert hiragana to katakana. */
export function hiraganaToKatakana(char: string): string {
  return transliterate(char, HIRAGANA_START, HIRAGANA_END, KANA_OFFSET)
}

/** The romanized prefix a small っ/ッ contributes before the following kana. */
function sokuonPrefix(next: string): string {
  // っち / っつ double to "t" (tchi, ttsu) rather than the first letter.
  if (next === 'ち' || next === 'ぢ' || next === 'つ' || next === 'づ') {
    return 't'
  }
  const rom = HIRAGANA[next]
  return rom ? rom[0] : ''
}

/** Convert a kana string (hiragana or katakana) to Hepburn romaji. */
export function toRomaji(input: string): string {
  const kana = katakanaToHiragana(input)
  let out = ''

  for (let index = 0; index < kana.length; index++) {
    const char = kana[index]
    const next = kana[index + 1]

    if (char === 'っ') {
      if (next) {
        out += sokuonPrefix(next)
      }
      continue
    }

    if (next && 'ゃゅょ'.includes(next)) {
      const digraph = DIGRAPHS[char + next]
      if (digraph) {
        out += digraph
        index++
        continue
      }
    }

    if (char === 'ー') {
      const previous = out[out.length - 1]
      if (previous) {
        out += previous
      }
      continue
    }

    out += HIRAGANA[char] ?? char
  }

  return out
}

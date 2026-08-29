/**
 * Split a raw English sense string into discrete meanings.
 *
 * Dataset sources encode several meanings in a single field using numbered
 * senses ("1. ... 2. ..."), semicolons, slashes, commas, and "or"/"and"
 * alternatives. Each meaning is returned trimmed, de-duplicated
 * (case-insensitively) and in first-seen order.
 */

/**
 * Split a meaning string into individual meanings. Separators are honoured only
 * at top level (parenthesised notes like "(of a time)" are kept intact). If
 * splitting would produce nothing (a value made only of separators/stopwords),
 * the whole string is returned as a single meaning.
 */
export function splitMeanings(text: string | null | undefined): string[] {
  if (!text) {
    return []
  }

  const raw = String(text)
  const parts: string[] = []
  let depth = 0
  let current = ''
  let index = 0

  const push = (chunk: string) => {
    const trimmed = chunk.trim()
    if (trimmed) {
      parts.push(trimmed)
    }
  }

  while (index < raw.length) {
    const char = raw[index]

    if (char === '(') {
      depth++
      current += char
      index++
      continue
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1)
      current += char
      index++
      continue
    }

    if (depth === 0) {
      const numbered = /^\d+\.\s*/.exec(raw.slice(index))
      if (numbered) {
        push(current)
        current = ''
        index += numbered[0].length
        continue
      }

      if (char === ';' || char === '/' || char === ',') {
        push(current)
        current = ''
        index++
        continue
      }

      const prevIsWord = index > 0 && /[A-Za-z0-9]/.test(raw[index - 1])
      const orAnd = /^(or|and)\b/i.exec(raw.slice(index))
      if (!prevIsWord && orAnd) {
        push(current)
        current = ''
        index += orAnd[0].length
        continue
      }
    }

    current += char
    index++
  }
  push(current)

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(part)
  }

  return out.length > 0 ? out : [raw.trim()]
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { shuffle } from './shuffle'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shuffle', () => {
  it('returns a new array and leaves the input untouched', () => {
    const items = [1, 2, 3, 4, 5]

    const result = shuffle(items)

    expect(result).not.toBe(items)
    expect(items).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps every item exactly once', () => {
    const items = ['a', 'b', 'c', 'd', 'e']

    const result = shuffle(items)

    expect([...result].sort()).toEqual([...items].sort())
  })

  it('follows Fisher–Yates for a known random sequence', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)

    expect(shuffle(['a', 'b', 'c'])).toEqual(['b', 'c', 'a'])
  })

  it('handles empty and single-item arrays', () => {
    expect(shuffle([])).toEqual([])
    expect(shuffle(['only'])).toEqual(['only'])
  })
})

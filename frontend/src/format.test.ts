import { describe, expect, it } from 'vitest'
import { formatAccuracy, formatDuration } from './format'

describe('formatAccuracy', () => {
  it('rounds to the nearest whole percent', () => {
    expect(formatAccuracy(1, 3)).toBe('33%')
    expect(formatAccuracy(2, 3)).toBe('67%')
  })

  it('defaults to 100% when nothing was answered', () => {
    expect(formatAccuracy(0, 0)).toBe('100%')
  })

  it('handles perfect and zero scores', () => {
    expect(formatAccuracy(5, 5)).toBe('100%')
    expect(formatAccuracy(0, 5)).toBe('0%')
  })
})

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
  })

  it('pads minutes and seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 00s')
    expect(formatDuration(125_000)).toBe('2m 05s')
  })

  it('pads hours, minutes and seconds', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m 00s')
    expect(formatDuration(4_530_000)).toBe('1h 15m 30s')
  })

  it('rounds sub-second values and clamps negatives', () => {
    expect(formatDuration(999)).toBe('1s')
    expect(formatDuration(-5_000)).toBe('0s')
  })
})

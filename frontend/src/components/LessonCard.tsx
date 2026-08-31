import { useCallback, useEffect, useMemo, useState } from 'react'
import { playItemAudio, itemAudioSrc, useAutoplay } from '../audio'
import { SHORTCUTS, isShortcut } from '../shortcuts'
import PlayAudioButton from './PlayAudioButton'
import ShortcutHints from './ShortcutHints'
import type { Card, ReviewCard } from '@shared/types'

interface LessonCardProps {
  item: ReviewCard
  isLast: boolean
  autoplay: boolean
  onNext: () => void
}

interface ItemDetailsProps {
  item: Card
  defaultOpen?: string[] | string | null
}

/**
 * Show a single lesson card: reveal the answer, then continue to the next step
 * (or finish the lesson on the last step).
 */
export default function LessonCard({ item, isLast, autoplay, onNext }: LessonCardProps) {
  const [revealed, setRevealed] = useState(false)
  const isMeaning = item.question_type === 'meaning'
  const isSelfGrade = item.question_type === 'self-grade'
  const label = isMeaning ? 'Vocabulary Meaning' : isSelfGrade ? 'Vocabulary' : 'Vocabulary Reading'
  const answer = isMeaning ? item.meanings.join(', ') : item.readings.join(', ')

  // Reveal the answer first; only continue to the next step once it's revealed.
  const advance = useCallback(() => {
    if (!revealed) {
      setRevealed(true)
    } else {
      onNext()
    }
  }, [revealed, onNext])

  // Enter acts like "Reveal", then like "Continue"/"Finish Lesson".
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isShortcut(event, SHORTCUTS.reveal)) {
        return
      }
      event.preventDefault()
      advance()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [advance])

  // Auto-play audio on non-Meaning (Reading/self-grade) cards when revealed.
  useAutoplay(item, revealed && autoplay && item.question_type !== 'meaning')

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isShortcut(event, SHORTCUTS.playAudio)) {
        return
      }
      if (!revealed) {
        return
      }
      playItemAudio(item)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [revealed, item])

  return (
    <div
      className={`card ${revealed ? 'result-correct' : ''} type-${isSelfGrade ? 'self-grade' : isMeaning ? 'meaning' : 'reading'}`}
    >
      <div className="banner tall">
        <div className="banner-char">{item.characters}</div>
        {revealed && <PlayAudioButton item={item} />}
      </div>
      <div className="subtitle-bar">{label}</div>

      {revealed && !isSelfGrade && <div className="result-bar green">{answer}</div>}

      <div className="answer-zone">
        <button
          className="submit-btn reveal-btn"
          onClick={() => setRevealed(true)}
          disabled={revealed}
        >
          {revealed ? 'Learning ✔' : 'Reveal'}
        </button>
      </div>

      {revealed && !isSelfGrade && <ItemDetails item={item} defaultOpen={['meaning', 'reading']} />}

      <div className="action-row">
        {revealed ? <ShortcutHints /> : <span />}
        <button className="next-btn" onClick={advance}>
          {isLast ? 'Finish Lesson' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

/**
 * Render the collapsible "Meaning" and "Reading" detail panels for an item, and
 * sync their open state (both expandable via the shortcut).
 */
export function ItemDetails({ item, defaultOpen = null }: ItemDetailsProps) {
  const initial = useMemo(() => {
    const panels = Array.isArray(defaultOpen) ? defaultOpen : defaultOpen ? [defaultOpen] : []
    return new Set(panels)
  }, [defaultOpen])
  const [open, setOpen] = useState<Set<string>>(initial)

  // Press the expand shortcut to open all available tabs (Meaning + Reading).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isShortcut(event, SHORTCUTS.expandDetails)) {
        return
      }
      setOpen(
        new Set(['meaning', 'reading'].filter(panel => panel === 'reading' || item.meanings.length))
      )
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [item])

  const toggle = (panel: string) => {
    setOpen(previous => {
      const next = new Set(previous)
      if (next.has(panel)) {
        next.delete(panel)
      } else {
        next.add(panel)
      }
      return next
    })
  }

  return (
    <div className="details">
      {item.meanings.length > 0 && (
        <div className={`detail-row ${open.has('meaning') ? 'open' : ''}`}>
          <div className="detail-head" onClick={() => toggle('meaning')}>
            <span className="chev">›</span>
            <span>Meaning</span>
          </div>
          {open.has('meaning') && (
            <div className="detail-body">
              {item.meanings.map(meaning => (
                <div key={meaning} className="meaning-text">
                  {meaning}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`detail-row ${open.has('reading') ? 'open' : ''}`}>
        <div className="detail-head" onClick={() => toggle('reading')}>
          <span className="chev">›</span>
          <span>Reading</span>
        </div>
        {open.has('reading') && (
          <div className="detail-body">
            {item.readings.map(reading => (
              <div key={reading} className="reading-item">
                {itemAudioSrc(item) && (
                  <button
                    className="speak-btn"
                    aria-label="Play audio"
                    onClick={() => playItemAudio(item)}
                  >
                    🔊
                  </button>
                )}
                <span className="reading-text">{reading}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

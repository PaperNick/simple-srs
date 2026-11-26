import { useEffect, useRef } from 'react'
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  Clock,
  Flame,
  GraduationCap,
  Layers,
  ListChecks,
  ListOrdered,
  PenLine,
  Sparkles,
  Target,
  Trophy,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SummaryMode = 'practice' | 'lesson' | 'review'

export type SummaryTone = 'ok' | 'no' | 'accent' | 'streak' | 'info' | 'burned'

interface StatVisual {
  Icon: LucideIcon
  tone?: SummaryTone
}

// Labels double as the lookup key, so `SummaryLabel` is the union of known stats.
const STAT_VISUALS = {
  Answered: { Icon: ListChecks },
  Correct: { Icon: Check, tone: 'ok' },
  Missed: { Icon: X, tone: 'no' },
  Accuracy: { Icon: Target, tone: 'accent' },
  'Best streak': { Icon: Flame, tone: 'streak' },
  Time: { Icon: Clock, tone: 'info' },
  'Words learned': { Icon: BookOpenCheck, tone: 'ok' },
  'Lesson steps': { Icon: ListOrdered },
  'Items reviewed': { Icon: Layers },
  Burned: { Icon: Sparkles, tone: 'burned' },
} satisfies Record<string, StatVisual>

export type SummaryLabel = keyof typeof STAT_VISUALS

export interface SummaryStat {
  label: SummaryLabel
  value: string | number
}

interface SummaryCopy {
  eyebrow: string
  title: string
  subtitle: string
  Icon: LucideIcon
}

const COPY: Record<SummaryMode, SummaryCopy> = {
  practice: {
    eyebrow: 'Practice session',
    title: 'Practice complete',
    subtitle: 'Nice work. You put in the reps. Here is how this session went.',
    Icon: PenLine,
  },
  lesson: {
    eyebrow: 'Lesson',
    title: 'Lesson complete!',
    subtitle: "You learned some new words. Lock them in with a quick review while they're fresh.",
    Icon: GraduationCap,
  },
  review: {
    eyebrow: 'Review session',
    title: 'Review complete!',
    subtitle: 'Nice work. Every answer helps these words stick a little longer.',
    Icon: Trophy,
  },
}

interface SessionSummaryBaseProps {
  stats: SummaryStat[]
  onDashboard: () => void
}

interface PracticeSummaryProps extends SessionSummaryBaseProps {
  mode: 'practice'
}

interface ReviewSummaryProps extends SessionSummaryBaseProps {
  mode: 'review'
}

interface LessonSummaryProps extends SessionSummaryBaseProps {
  mode: 'lesson'
  onReview: () => void
}

/** Lesson requires onReview; practice and review reject it. */
export type SessionSummaryProps = PracticeSummaryProps | ReviewSummaryProps | LessonSummaryProps

/** Full-screen end-of-session overview. */
export default function SessionSummary(props: SessionSummaryProps) {
  const { mode, stats, onDashboard } = props
  const onReview = mode === 'lesson' ? props.onReview : undefined
  const primaryRef = useRef<HTMLButtonElement>(null)
  const { eyebrow, title, subtitle, Icon } = COPY[mode]

  // Focus the primary action and lock background scrolling.
  useEffect(() => {
    primaryRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className={`summary-overlay ${mode}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-title"
      aria-describedby="summary-subtitle"
    >
      <div className="summary-glow" aria-hidden="true" />
      <div className="summary-content">
        <div className="summary-icon">
          <Icon size={42} strokeWidth={2} aria-hidden="true" />
        </div>

        <p className="summary-eyebrow">{eyebrow}</p>
        <h1 className="summary-title" id="summary-title">
          {title}
        </h1>
        <p className="summary-subtitle" id="summary-subtitle">
          {subtitle}
        </p>

        {stats.length > 0 && (
          <div className={`summary-stats ${stats.length % 2 === 1 ? 'odd' : ''}`}>
            {stats.map(stat => {
              const visual: StatVisual = STAT_VISUALS[stat.label]
              const StatIcon = visual.Icon
              const tone = visual.tone
              return (
                <div key={stat.label} className={`summary-stat ${tone ?? ''}`.trim()}>
                  <StatIcon
                    className="summary-stat-watermark"
                    size={72}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                  <div className="summary-stat-value">{stat.value}</div>
                  <div className="summary-stat-label">{stat.label}</div>
                </div>
              )
            })}
          </div>
        )}

        <div className="summary-actions">
          {onReview && (
            <button ref={primaryRef} className="summary-btn primary" onClick={onReview}>
              <Sparkles size={18} /> Start Review
            </button>
          )}
          <button
            ref={onReview ? undefined : primaryRef}
            className={`summary-btn ${onReview ? 'secondary' : 'primary'}`}
            onClick={onDashboard}
          >
            <ArrowLeft size={18} /> Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

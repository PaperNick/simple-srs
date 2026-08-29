import type { DatasetSummary } from '@shared/types'

interface DashboardProps {
  datasets: DatasetSummary[] | null
  onPractice: (id: string) => void
  onLesson: (id: string) => void
  onReview: (id: string) => void
}

/** Return the CSS class used to colour an SRS stage row. */
function stageClass(stage: number): string {
  if (stage >= 6) {
    return 'master'
  }
  if (stage >= 4) {
    return 'guru'
  }
  return 'apprentice'
}

/**
 * Render the dashboard: one card per dataset driven by its metadata. `practice`
 * datasets show only the practice UI; `srs` datasets automatically populate
 * the lesson/review UI with SRS stats and a stage breakdown.
 */
export default function Dashboard({ datasets, onPractice, onLesson, onReview }: DashboardProps) {
  if (!datasets) {
    return (
      <div className="view">
        <p className="loading">Loading…</p>
      </div>
    )
  }

  if (!datasets.length) {
    return (
      <div className="view">
        <h1 className="welcome">
          오늘도 화이팅! <span className="wave">🙌</span>
        </h1>
        <section className="mode-card empty-card">
          <div className="mode-heading">
            <div>
              <h2>
                No practice items yet. <span className="badge">Empty</span>
              </h2>
              <p className="mode-sub">
                Add a dataset via <code>data/datasets.json</code> to get started.
              </p>
            </div>
            <div className="stat compact">
              <div className="num">0</div>
              <div className="lbl">items</div>
            </div>
          </div>
          <div className="empty-note">
            <strong>Nothing to grind yet.</strong> The app is fully driven by your
            <code>data/datasets.json</code> registry - add an entry and it appears right here as a
            card.
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="view">
      <h1 className="welcome">
        오늘도 화이팅! <span className="wave">🙌</span>
      </h1>
      <p className="subtitle">Simple SRS flashcards, spaced-repetition and practice learning.</p>

      {datasets.map(dataset => (
        <section key={dataset.id} className="mode-card">
          <div className="mode-heading">
            <div>
              <h2>
                {dataset.name} {dataset.badge && <span className="badge">{dataset.badge}</span>}
              </h2>
              {dataset.description && <p className="mode-sub">{dataset.description}</p>}
            </div>
            <div className="stat compact">
              <div className="num">{dataset.total}</div>
              <div className="lbl">items</div>
            </div>
          </div>

          {dataset.mode === 'srs' ? (
            <>
              <div className="stats-grid">
                <div className="stat new">
                  <div className="num">{dataset.new}</div>
                  <div className="lbl">New</div>
                </div>
                <div className="stat learning">
                  <div className="num">{dataset.learning}</div>
                  <div className="lbl">Learning</div>
                </div>
                <div className="stat due">
                  <div className="num">{dataset.due}</div>
                  <div className="lbl">Due now</div>
                </div>
                <div className="stat burned">
                  <div className="num">{dataset.burned}</div>
                  <div className="lbl">Burned</div>
                </div>
              </div>

              <div className="dashboard-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => onLesson(dataset.id)}
                  disabled={dataset.new === 0}
                >
                  <span className="btn-icon">📖</span> Start Lesson
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => onReview(dataset.id)}
                  disabled={dataset.due === 0}
                >
                  <span className="btn-icon">⏰</span> Start Review
                </button>
              </div>

              <div className="stage-card">
                <h2>SRS Stages</h2>
                <div className="stage-list">
                  {(dataset.stages ?? []).map(stage => (
                    <div key={stage.stage} className={`stage-row ${stageClass(stage.stage)}`}>
                      <span className="dot" />
                      <span className="name">{stage.name}</span>
                      <span className="cnt">{stage.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="dashboard-actions">
              <button className="btn btn-primary" onClick={() => onPractice(dataset.id)}>
                <span className="btn-icon">✍️</span> Practice
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

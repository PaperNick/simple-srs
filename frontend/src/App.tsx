import { useCallback, useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import Session from './components/Session'
import Practice from './components/Practice'
import { getDatasets } from './api'
import type { DatasetSummary, SessionMode, Theme } from '@shared/types'

type View = 'dashboard' | 'session' | 'practice'

const THEME_KEY = 'simplesrs-theme'

/** Resolve the initial theme from the OS color-scheme preference. */
const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

/**
 * Root component: holds the current view (dashboard / session / practice), the
 * theme, and the app-level state shared across the screens.
 */
export default function App() {
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [sessionMode, setSessionMode] = useState<SessionMode>('review')
  const [sessionKey, setSessionKey] = useState(0)
  const [currentDataset, setCurrentDataset] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Resolve the initial theme: saved choice, else the OS preference.
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem(THEME_KEY)
    return saved === 'dark' || saved === 'light' ? saved : systemTheme()
  })

  // Follow the OS theme unless the user has made an explicit choice.
  useEffect(() => {
    if (window.localStorage.getItem(THEME_KEY)) {
      return
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light')
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    window.localStorage.setItem(THEME_KEY, next)
    setTheme(next)
  }

  const refresh = useCallback(async () => {
    try {
      const { datasets } = await getDatasets()
      setDatasets(datasets)
    } catch (error) {
      setError((error as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openSession = useCallback((dataset: string, mode: SessionMode) => {
    setCurrentDataset(dataset)
    setSessionMode(mode)
    setSessionKey(key => key + 1)
    setView('session')
  }, [])

  const openPractice = useCallback((dataset: string) => {
    setCurrentDataset(dataset)
    setView('practice')
  }, [])

  const backToDashboard = useCallback(() => {
    setView('dashboard')
    refresh()
  }, [refresh])

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-btn" onClick={backToDashboard} title="Go to dashboard">
          Simple<span className="brand-dot">.</span>SRS
        </button>
        <div className="topbar-actions">
          <button
            className="ghost-btn"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <main className="main">
        {view === 'dashboard' && (
          <Dashboard
            datasets={datasets}
            onPractice={openPractice}
            onLesson={dataset => openSession(dataset, 'lesson')}
            onReview={dataset => openSession(dataset, 'review')}
          />
        )}
        {view === 'session' && (
          <Session
            key={sessionKey}
            dataset={currentDataset ?? ''}
            mode={sessionMode}
            onDone={backToDashboard}
          />
        )}
        {view === 'practice' && (
          <Practice dataset={currentDataset ?? ''} onStop={backToDashboard} />
        )}
      </main>

      {error && (
        <div className="toast" onClick={() => setError('')}>
          {error}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Session from './components/Session.jsx'
import Practice from './components/Practice.jsx'
import { getDatasets } from './api.js'

const THEME_KEY = 'simplesrs-theme'

/**
 * Resolve the initial theme from the OS color-scheme preference.
 *
 * @returns {'dark'|'light'} The preferred theme.
 */
const systemTheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

/**
 * Root component: holds the current view (dashboard / session / practice), the
 * theme, and the app-level state shared across the screens.
 */
export default function App() {
  const [datasets, setDatasets] = useState(null)
  const [view, setView] = useState('dashboard') // 'dashboard' | 'session' | 'practice'
  const [sessionMode, setSessionMode] = useState('review')
  const [sessionKey, setSessionKey] = useState(0)
  const [currentDataset, setCurrentDataset] = useState(null)
  const [error, setError] = useState('')
  // Resolve the initial theme: saved choice, else the OS preference.
  const [theme, setTheme] = useState(() => {
    const saved = window.localStorage.getItem(THEME_KEY)
    return saved === 'dark' || saved === 'light' ? saved : systemTheme()
  })

  // Follow the OS theme unless the user has made an explicit choice.
  useEffect(() => {
    if (window.localStorage.getItem(THEME_KEY)) {
      return
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = event => setTheme(event.matches ? 'dark' : 'light')
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    window.localStorage.setItem(THEME_KEY, next)
    setTheme(next)
  }

  const refresh = useCallback(async () => {
    try {
      const { datasets } = await getDatasets()
      setDatasets(datasets)
    } catch (error) {
      setError(error.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openSession = useCallback((dataset, mode) => {
    setCurrentDataset(dataset)
    setSessionMode(mode)
    setSessionKey(key => key + 1)
    setView('session')
  }, [])

  const openPractice = useCallback(dataset => {
    setCurrentDataset(dataset)
    setView('practice')
  }, [])

  const backToDashboard = useCallback(() => {
    setView('dashboard')
    refresh()
  }, [refresh])

  const topbarLabel = view === 'session' ? 'Dashboard' : view === 'practice' ? 'Stop' : ''

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
          {topbarLabel && (
            <button className="ghost-btn" onClick={backToDashboard}>
              {topbarLabel}
            </button>
          )}
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
            dataset={currentDataset}
            mode={sessionMode}
            onDone={backToDashboard}
          />
        )}
        {view === 'practice' && <Practice dataset={currentDataset} onStop={backToDashboard} />}
      </main>

      {error && (
        <div className="toast" onClick={() => setError('')}>
          {error}
        </div>
      )}
    </div>
  )
}

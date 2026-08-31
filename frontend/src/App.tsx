import { useCallback, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import Dashboard from './components/Dashboard'
import Session from './components/Session'
import Practice from './components/Practice'
import SettingsModal from './components/SettingsModal'
import { getDatasets } from './api'
import type { DatasetSummary, SessionMode, Theme } from '@shared/types'

type View = 'dashboard' | 'session' | 'practice'

const THEME_KEY = 'simplesrs-theme'
const AUTOPLAY_LESSON_KEY = 'simplesrs-autoplay-lesson'
const AUTOPLAY_REVIEW_KEY = 'simplesrs-autoplay-review'

/** Whether the OS prefers a dark colour scheme. */
const prefersDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

/** Resolve the effective light/dark theme for a stored theme choice. */
const effectiveTheme = (theme: Theme, systemDark: boolean): 'dark' | 'light' => {
  if (theme === 'system') {
    return systemDark ? 'dark' : 'light'
  }
  return theme
}

/** Read/write a boolean flag persisted in localStorage as 'on'/'off'. */
function useStoredFlag(key: string): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => window.localStorage.getItem(key) === 'on')
  const set = (next: boolean) => {
    window.localStorage.setItem(key, next ? 'on' : 'off')
    setValue(next)
  }
  return [value, set]
}

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem(THEME_KEY)
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system'
  })

  // Separate auto-play toggles for lesson and review items.
  const [autoplayLesson, setAutoplayLesson] = useStoredFlag(AUTOPLAY_LESSON_KEY)
  const [autoplayReview, setAutoplayReview] = useStoredFlag(AUTOPLAY_REVIEW_KEY)

  // Follow the OS colour-scheme so the 'system' theme tracks changes.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  const themeMode = effectiveTheme(theme, systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark')
  }, [themeMode])

  const selectTheme = (next: Theme) => {
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
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            title="Settings"
          >
            <Settings size={18} />
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
            autoplayLesson={autoplayLesson}
            autoplayReview={autoplayReview}
            onDone={backToDashboard}
          />
        )}
        {view === 'practice' && (
          <Practice
            dataset={currentDataset ?? ''}
            autoplay={autoplayReview}
            onStop={backToDashboard}
          />
        )}
      </main>

      {error && (
        <div className="toast" onClick={() => setError('')}>
          {error}
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        theme={theme}
        autoplayLesson={autoplayLesson}
        autoplayReview={autoplayReview}
        onSelectTheme={selectTheme}
        onSetAutoplayLesson={setAutoplayLesson}
        onSetAutoplayReview={setAutoplayReview}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

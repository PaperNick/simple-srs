/**
 ** Starts the backend + frontend dev servers for the Playwright suite, pointing
 ** the backend at a throwaway test DB and a self-contained data fixture. Written
 ** in plain Node (no shell scripts / bash) so the e2e harness is portable.
 **
 ** Run by playwright.config.mjs (webServer.command). Playwright sends SIGTERM on
 ** teardown; this script forwards it to both servers and kills their process
 ** trees (npm -> shell -> node) before exiting.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(currentDir, '..')

/**
 ** E2E is fully self-contained: the backend reads its dataset registry, dataset
 ** files and audio from a small fixture under e2e/data (not backend/data), and
 ** writes to a throwaway DB in the OS temp dir. This keeps the suite independent
 ** of the real app data.
 */
const DATA_DIR = path.join(ROOT, 'e2e', 'data')
const TEST_DB = path.join(os.tmpdir(), 'simple-srs-e2e.sqlite')

// Run on dedicated ports so the suite never clashes with a running dev server.
const BACKEND_PORT = process.env.BACKEND_PORT || '3100'
const FRONTEND_PORT = process.env.FRONTEND_PORT || '5174'

/**
 * Delete the test DB and its WAL files with plain fs (no shell) so the real app
 * DB is never touched.
 */
function resetTestDatabase() {
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(TEST_DB + suffix, { force: true })
  }
}

/**
 * Spawn one of the project's dev servers via npm, in the same process group as
 * the launcher. Playwright kills the whole group on teardown (SIGKILL to -pid),
 * so the servers go down with it and nothing is left orphaned.
 *
 * @param {string} project 'backend' | 'frontend'.
 * @returns {import('node:child_process').ChildProcess} The spawned process.
 */
function launch(project) {
  return spawn('npm', ['--prefix', path.join(ROOT, project), 'run', 'dev'], {
    env,
    cwd: ROOT,
    stdio: 'inherit',
  })
}

/**
 * Forward a signal (or force kill) to every spawned server child.
 *
 * @param {string} signal The signal name to send.
 */
function stopAll(signal) {
  for (const child of servers) {
    try {
      child.kill(signal)
    } catch (_) {
      /* the child may already be gone */
    }
  }
}

/**
 * Gracefully stop the servers on SIGTERM/SIGINT, then force-kill anything left.
 *
 * @param {string} signal The received signal name.
 */
function shutdown(signal) {
  console.log(`\n[launcher] ${signal} - stopping servers…`)
  stopAll(signal)
  // Give them a moment to exit gracefully, then force kill anything left.
  setTimeout(() => {
    stopAll('SIGKILL')
    process.exit(0)
  }, 1500).unref()
  setTimeout(() => process.exit(0), 3000).unref()
}

resetTestDatabase()

const env = {
  ...process.env,
  DATA_DIR,
  SIMPLE_SRS_DB: TEST_DB,
  BACKEND_PORT, // backend listens on this; frontend proxies to it
  FRONTEND_PORT, // frontend vite dev server port
  // Pin the shortcut keys to their defaults. .env.local overrides those and process env wins over .env files in Vite
  VITE_KEY_PLAY_AUDIO: 'p',
  VITE_KEY_EXPAND_DETAILS: 'e',
  VITE_KEY_MISSED_IT: '1',
  VITE_KEY_GOT_IT: '2',
}

const servers = [launch('backend'), launch('frontend')]

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Keep the launcher alive until both servers have exited.
Promise.all(servers.map(server => new Promise(resolve => server.on('exit', resolve)))).then(() => {
  console.log('[launcher] servers exited.')
  process.exit(0)
})

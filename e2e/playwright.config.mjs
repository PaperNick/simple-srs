import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Dedicated frontend port so the suite never clashes with a running dev server.
const FRONTEND_PORT = process.env.FRONTEND_PORT || '5174'

/**
 * E2E must never touch the real app DB, so it runs against a separate test DB
 * (a prefixed file inside backend/data, which is gitignored). The server is
 * booted by a portable Node launcher (launch-servers.mjs) that resets that DB
 * with fs and spawns backend + frontend on dedicated ports.
 */
const command = 'node e2e/launch-servers.mjs'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
    launchOptions: {
      // Allow audio to play (and its file to be fetched) in headless Chromium.
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command,
    cwd: REPO_ROOT,
    url: `http://localhost:${FRONTEND_PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

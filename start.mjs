/**
 * Starts the backend and frontend dev servers together.
 * It spawns both servers, wires them into the same process group, and stops them cleanly
 * on Ctrl+C (SIGINT / SIGTERM). Ports are configurable via BACKEND_PORT, FRONTEND_PORT
 */
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

const BACKEND_PORT = process.env.BACKEND_PORT || '3000'
const FRONTEND_PORT = process.env.FRONTEND_PORT || '5173'

const PROJECTS = ['backend', 'frontend']

/**
 * Absolute path of a project's dev-server log file. Truncated on each start
 *
 * @param {string} project 'backend' | 'frontend'.
 * @returns {string}
 */
function logPath(project) {
  return path.join(os.tmpdir(), `simple-srs-${project}.log`)
}

/**
 * Resolve the npm executable; on Windows it ships as npm.cmd
 *
 * @returns {string}
 */
function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * Ensure each project's dependencies are installed before spawning
 */
function checkDependencies() {
  for (const project of PROJECTS) {
    const dir = path.join(ROOT, project, 'node_modules')
    if (!fs.existsSync(dir)) {
      console.error(
        `ERROR: ${project}/node_modules not found. Install dependencies first:\n` +
          `  npm --prefix ${project} install`
      )
      process.exit(1)
    }
  }
}

/**
 * Check whether a TCP port is free on localhost
 *
 * @param {number} port
 * @returns {Promise<boolean>} true when the port is available
 */
function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * Refuse to start if a required port is already in use
 */
async function checkPorts() {
  const checks = [
    [BACKEND_PORT, 'backend'],
    [FRONTEND_PORT, 'frontend'],
  ]
  for (const [port, name] of checks) {
    if (!(await isPortFree(Number(port)))) {
      console.error(`ERROR: Port ${port} (${name}) is already in use. Stop that process and retry.`)
      process.exit(1)
    }
  }
}

/**
 * Spawn one of the project's dev servers via npm. It runs in its own process
 * group (detached) so the whole tree can be signalled together on shutdown
 *
 * @param {string} project 'backend' | 'frontend'.
 * @returns {import('node:child_process').ChildProcess}
 */
function launch(project) {
  // Separate log file per project so subprocess output is
  // captured without polluting this launcher's stdout.
  const logFd = fs.openSync(logPath(project), 'w')
  return spawn(npmBin(), ['--prefix', path.join(ROOT, project), 'run', 'dev'], {
    cwd: ROOT,
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: { ...process.env, BACKEND_PORT, FRONTEND_PORT },
  })
}

/**
 * Kill a spawned server and its process tree
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (!child.pid) {
    return
  }

  // taskkill /T terminates the process and its whole subtree
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }

  // Negative PID targets the process group so children die as well
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (_) {
    // process may already be gone
  }
}

async function start() {
  const servers = []
  let shuttingDown = false

  /**
   * Stop both servers on SIGINT/SIGTERM, then force-kill anything left
   *
   * @param {string} signal The received signal name.
   */
  function shutdown(signal) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.log(`\n[simple-srs] ${signal} - stopping servers...`)
    for (const child of servers) {
      killTree(child)
    }

    setTimeout(() => {
      for (const child of servers) {
        if (child && child.pid && !child.killed) {
          try {
            child.kill('SIGKILL')
          } catch (_) {
            // ignore
          }
        }
      }
      process.exit(0)
    }, 500).unref()
    setTimeout(() => process.exit(0), 1500).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  checkDependencies()
  await checkPorts()

  for (const project of PROJECTS) {
    servers.push(launch(project))
  }

  console.log(`\nSimple SRS is running:`)
  console.log(`  Backend API: http://localhost:${BACKEND_PORT}`)
  console.log(`  Frontend UI: http://localhost:${FRONTEND_PORT}`)
  console.log(`  Logs: ${logPath('backend')} | ${logPath('frontend')}`)
  console.log(`\nPress Ctrl+C to stop both.`)
}

start()

'use strict'

/**
 * HTTP-level tests for src/server.js against a throwaway DB. We spawn the real
 * server as a child process (pointing SIMPLE_SRS_DB at a temp file) and hit the
 * public endpoints with fetch. This covers the routes that db.test.js can't.
 * The dataset ids come from the running registry (/api/datasets), so the tests
 * are data-driven and don't hard-code any dataset name.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const TMP_DB = path.join(os.tmpdir(), `srs-api-${process.pid}-${Date.now()}.sqlite`)
const PORT = 4000 + (process.pid % 1000)
const BASE = `http://localhost:${PORT}`

const FIXTURE_DATASETS = [
  {
    id: 'hangul',
    name: 'Hangul Alphabet',
    file: 'hangul.json',
    mode: 'practice',
    type: 'character',
    badge: 'Practice',
    description: 'Endless practice.',
  },
  {
    id: 'words',
    name: 'Korean Words',
    file: 'words.json',
    mode: 'srs',
    type: 'vocabulary',
    badge: 'SRS',
    description: 'Spaced repetition.',
  },
]
const FIXTURE_HANGUL = [
  { type: 'character', characters: 'ㄱ', readings: ['g', 'k'], level: 1 },
  { type: 'character', characters: 'ㄴ', readings: ['n'], level: 1 },
  { type: 'character', characters: 'ㄷ', readings: ['d', 't'], level: 1 },
]
const FIXTURE_WORDS = [
  { type: 'vocabulary', characters: '가', meaning: 'To go', readings: ['ga'], level: 1 },
  { type: 'vocabulary', characters: '나', meaning: 'I / me', readings: ['na'], level: 1 },
  { type: 'vocabulary', characters: '다', meaning: 'All', readings: ['da'], level: 1 },
  { type: 'vocabulary', characters: '라', meaning: 'Fourth letter', readings: ['ra'], level: 1 },
  { type: 'vocabulary', characters: '마', meaning: 'Horse', readings: ['ma'], level: 1 },
  { type: 'vocabulary', characters: '바', meaning: 'Bar', readings: ['ba'], level: 1 },
]

/** Materialize the fixture dataset into a temp DATA_DIR and return its path. */
function materializeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-api-data-'))
  fs.writeFileSync(path.join(dir, 'datasets.json'), JSON.stringify(FIXTURE_DATASETS, null, 2))
  fs.writeFileSync(path.join(dir, 'hangul.json'), JSON.stringify(FIXTURE_HANGUL, null, 2))
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(FIXTURE_WORDS, null, 2))
  return dir
}

const DATA_DIR = materializeFixture()

let child
let stderr = ''

// Populated once the server is ready.
let datasets = []
let srsDataset = null

function waitForReady(timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const onData = buf => {
      if (buf.toString().includes('Simple SRS running')) {
        cleanup()
        resolve()
      }
    }
    const onExit = code => {
      cleanup()
      reject(new Error(`server exited early (${code}):\n${stderr}`))
    }
    child.stdout.on('data', onData)
    child.on('exit', onExit)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout waiting for server to start'))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.removeListener('exit', onExit)
    }
  })
}

before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, SIMPLE_SRS_DB: TMP_DB, BACKEND_PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', buf => {
    stderr += buf.toString()
  })
  await waitForReady()

  const response = await fetch(`${BASE}/api/datasets`)
  datasets = (await response.json()).datasets
  srsDataset = datasets.find(d => d.mode === 'srs') || datasets[0]
})

after(() => {
  try {
    if (child) {
      child.kill('SIGTERM')
    }
  } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TMP_DB + suffix, { force: true })
    } catch (_) {}
  }
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  } catch (_) {}
})

async function get(pathname) {
  const res = await fetch(BASE + pathname)
  return { status: res.status, body: await res.json() }
}

async function post(pathname, payload) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() }
}

describe('API - stats & datasets', () => {
  it('GET /api/stats returns per-dataset stats', async () => {
    const { status, body } = await get('/api/stats')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.datasets))
    assert.ok(body.datasets.length >= 1)
  })

  it('GET /api/datasets lists exactly the configured datasets', async () => {
    const { status, body } = await get('/api/datasets')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.datasets))
    assert.deepEqual(body.datasets.map(d => d.id).sort(), datasets.map(d => d.id).sort())
    const srs = body.datasets.find(d => d.id === srsDataset.id)
    assert.equal(srs.mode, 'srs')
    assert.ok(srs.total > 0)
    assert.ok(Array.isArray(srs.stages))
  })
})

describe('API - practice (any dataset) and answer grading', () => {
  let first

  it('GET /api/practice/items?dataset= returns the dataset items', async () => {
    const { status, body } = await get(`/api/practice/items?dataset=${srsDataset.id}`)
    assert.equal(status, 200)
    assert.ok(body.items.length > 0)
    first = body.items[0]
    assert.equal(first.type, 'vocabulary')
    assert.ok(Array.isArray(first.readings))
  })

  it('GET /api/practice/items without a dataset is rejected', async () => {
    const { status } = await get('/api/practice/items')
    assert.equal(status, 400)
  })

  it('POST /api/practice/answer grades a reading', async () => {
    const guess = first.readings[0]
    const { status, body } = await post('/api/practice/answer', { item_id: first.id, input: guess })
    assert.equal(status, 200)
    assert.equal(body.correct, true)
    assert.ok(Array.isArray(body.accepted))
    assert.ok(body.accepted.includes(guess))
  })

  it('POST /api/practice/answer rejects an unknown item', async () => {
    const { status } = await post('/api/practice/answer', { item_id: 999_999_999, input: 'x' })
    assert.equal(status, 404)
  })
})

describe('API - vocab, lesson, review flow', () => {
  it('POST /api/vocab adds a new word and bumps totals', async () => {
    const before = await get('/api/stats')
    const total = before.body.datasets.find(d => d.id === srsDataset.id).total
    const { status, body } = await post('/api/vocab', {
      characters: '가',
      meaning: 'To go',
      readings: ['ga'],
      level: 1,
      dataset: srsDataset.id,
    })
    assert.equal(status, 201)
    assert.ok(body.id > 0)
    const after = body.stats.datasets.find(d => d.id === srsDataset.id)
    assert.equal(after.total, total + 1)
  })

  it('POST /api/vocab without a dataset is rejected', async () => {
    const { status } = await post('/api/vocab', {
      characters: '가',
      meaning: 'To go',
      readings: ['ga'],
      level: 1,
    })
    assert.equal(status, 400)
  })

  it('runs a lesson -> complete -> review -> answer cycle', async () => {
    // Start a lesson (5 fresh words).
    const lesson = await get(`/api/lesson/start?dataset=${srsDataset.id}&limit=5`)
    assert.equal(lesson.status, 200)
    assert.equal(lesson.body.items.length, 5)
    const ids = lesson.body.items.map(i => i.id)
    for (const it of lesson.body.items) {
      assert.equal(it.type, 'vocabulary')
      assert.ok(it.characters)
    }

    // Complete the lesson -> they become due for review.
    const complete = await post('/api/lesson/complete', { item_ids: ids })
    assert.equal(complete.status, 200)
    assert.equal(complete.body.learned, 5)

    // They should now be due.
    const review = await get(`/api/review/start?dataset=${srsDataset.id}&limit=20`)
    assert.equal(review.status, 200)
    assert.ok(review.body.due.length >= 5)
    const first = review.body.due.find(d => ids.includes(d.id))
    assert.ok(first)
    assert.notEqual(first.question_type, undefined)

    // Answer with the correct reading.
    const guess = first.readings[0]
    const ans = await post('/api/review/answer', {
      item_id: first.id,
      input: guess,
      question_type: 'reading',
    })
    assert.equal(ans.status, 200)
    assert.equal(ans.body.correct, true)
    assert.equal(ans.body.expected, first.readings.join(', '))
    assert.ok(ans.body.item.srs_stage >= 0)
  })
})

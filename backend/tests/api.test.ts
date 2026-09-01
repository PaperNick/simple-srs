import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ChildProcess } from 'node:child_process'
import type { Card, DatasetConfig, DatasetSummary } from '@shared/types'

/**
 * HTTP-level tests for src/server.ts against a throwaway DB. We spawn the real
 * server as a child process (pointing SIMPLE_SRS_DB at a temp file) and hit the
 * public endpoints with fetch. This covers the routes that db.test.ts can't.
 * The dataset ids come from the running registry (/api/datasets), so the tests
 * are data-driven and don't hard-code any dataset name.
 */

const TMP_DB = path.join(os.tmpdir(), `srs-api-${process.pid}-${Date.now()}.sqlite`)
const PORT = 4000 + (process.pid % 1000)
const BASE = `http://localhost:${PORT}`

const FIXTURE_DATASETS: DatasetConfig[] = [
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
  {
    id: 'seen',
    name: 'Seen Cards',
    file: 'seen.json',
    mode: 'srs',
    type: 'vocabulary',
    badge: 'SRS',
    description: 'Cards that only need to be seen.',
  },
]
const FIXTURE_HANGUL = [
  { type: 'character', characters: 'ㄱ', readings: ['g', 'k'], level: 1 },
  { type: 'character', characters: 'ㄴ', readings: ['n'], level: 1 },
  { type: 'character', characters: 'ㄷ', readings: ['d', 't'], level: 1 },
]
const FIXTURE_SEEN = [
  { type: 'vocabulary', characters: 'ㄱ', level: 1 },
  { type: 'vocabulary', characters: 'ㄴ', level: 1 },
]
const FIXTURE_WORDS = [
  { type: 'vocabulary', characters: '가', meanings: ['To go'], readings: ['ga'], level: 1 },
  { type: 'vocabulary', characters: '나', meanings: ['I', 'me'], readings: ['na'], level: 1 },
  { type: 'vocabulary', characters: '다', meanings: ['All'], readings: ['da'], level: 1 },
  { type: 'vocabulary', characters: '라', meanings: ['Fourth letter'], readings: ['ra'], level: 1 },
  { type: 'vocabulary', characters: '마', meanings: ['Horse'], readings: ['ma'], level: 1 },
  { type: 'vocabulary', characters: '바', meanings: ['Bar'], readings: ['ba'], level: 1 },
]

/** Materialize the fixture dataset into a temp DATA_DIR and return its path. */
function materializeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-api-data-'))
  fs.writeFileSync(path.join(dir, 'datasets.json'), JSON.stringify(FIXTURE_DATASETS, null, 2))
  fs.writeFileSync(path.join(dir, 'hangul.json'), JSON.stringify(FIXTURE_HANGUL, null, 2))
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(FIXTURE_WORDS, null, 2))
  fs.writeFileSync(path.join(dir, 'seen.json'), JSON.stringify(FIXTURE_SEEN, null, 2))
  return dir
}

const DATA_DIR = materializeFixture()

let child: ChildProcess
let stderr = ''

// Populated once the server is ready.
let datasets: DatasetSummary[] = []
let srsDataset: DatasetSummary

function waitForReady(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      if (buf.toString().includes('Simple SRS running')) {
        cleanup()
        resolve()
      }
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`server exited early (${code}):\n${stderr}`))
    }
    child.stdout!.on('data', onData)
    child.on('exit', onExit)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout waiting for server to start'))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      child.stdout!.off('data', onData)
      child.removeListener('exit', onExit)
    }
  })
}

before(async () => {
  child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(import.meta.dirname, '..', 'src', 'server.ts')],
    {
      env: { ...process.env, SIMPLE_SRS_DB: TMP_DB, BACKEND_PORT: String(PORT), DATA_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  child.stderr!.on('data', buf => {
    stderr += buf.toString()
  })
  await waitForReady()

  const response = await fetch(`${BASE}/api/datasets`)
  datasets = ((await response.json()) as { datasets: DatasetSummary[] }).datasets
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

async function get(pathname: string): Promise<{ status: number; body: any }> {
  const res = await fetch(BASE + pathname)
  return { status: res.status, body: await res.json() }
}

async function post(pathname: string, payload: unknown): Promise<{ status: number; body: any }> {
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
    assert.deepEqual(
      body.datasets.map((d: DatasetSummary) => d.id).sort(),
      datasets.map(d => d.id).sort()
    )
    const srs = body.datasets.find((d: DatasetSummary) => d.id === srsDataset.id)
    assert.equal(srs.mode, 'srs')
    assert.ok(srs.total > 0)
    assert.ok(Array.isArray(srs.stages))
  })
})

describe('API - practice (any dataset) and answer grading', () => {
  let first: any

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
    const total = before.body.datasets.find((d: DatasetSummary) => d.id === srsDataset.id).total
    const { status, body } = await post('/api/vocab', {
      characters: '가',
      meanings: ['To go'],
      readings: ['ga'],
      level: 1,
      dataset: srsDataset.id,
    })
    assert.equal(status, 201)
    assert.ok(body.id > 0)
    const after = body.stats.datasets.find((d: DatasetSummary) => d.id === srsDataset.id)
    assert.equal(after.total, total + 1)
  })

  it('POST /api/vocab without a dataset is rejected', async () => {
    const { status } = await post('/api/vocab', {
      characters: '가',
      meanings: ['To go'],
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
    const ids: number[] = lesson.body.items.map((i: any) => i.id)
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
    const first: Card = review.body.due.find((d: Card) => ids.includes(d.id))
    assert.ok(first)

    // Answer with the correct reading (grade only - does not schedule yet).
    const guess = first.readings[0]
    const ans = await post('/api/review/answer', {
      item_id: first.id,
      input: guess,
      question_type: 'reading',
    })
    assert.equal(ans.status, 200)
    assert.equal(ans.body.correct, true)
    assert.equal(ans.body.expected, first.readings.join(', '))
    assert.equal(ans.body.item.srs_stage, 0)

    // Scheduling is a separate step: a correct review advances the stage.
    const scheduled = await post('/api/review/schedule', { item_id: first.id, correct: true })
    assert.equal(scheduled.status, 200)
    assert.equal(scheduled.body.item.srs_stage, 1)
    assert.equal(scheduled.body.item.stage_name, 'Apprentice II')
  })
})

describe('API - self-grade cards (nothing to type)', () => {
  it('review asks a self-grade question and grades accept/reject', async () => {
    const seenDataset = datasets.find(d => d.id === 'seen')
    assert.ok(seenDataset, 'seen fixture dataset is registered')

    // Learn the seen cards so they become due for review.
    const lesson = await get(`/api/lesson/start?dataset=seen`)
    assert.equal(lesson.status, 200)
    assert.equal(lesson.body.items.length, 2)
    const ids: number[] = lesson.body.items.map((i: any) => i.id)
    const complete = await post('/api/lesson/complete', { item_ids: ids })
    assert.equal(complete.body.learned, 2)

    const review = await get(`/api/review/start?dataset=seen&limit=20`)
    assert.equal(review.status, 200)
    assert.equal(review.body.due.length, 2)
    const due: Card = review.body.due[0]
    assert.deepEqual(due.readings, [])
    assert.deepEqual(due.meanings, [])

    // Accept ("got it") -> graded correct, then scheduled to advance.
    const accept = await post('/api/review/answer', {
      item_id: due.id,
      input: '',
      question_type: 'self-grade',
      recalled: true,
    })
    assert.equal(accept.status, 200)
    assert.equal(accept.body.correct, true)
    assert.equal(accept.body.item.srs_stage, 0)

    const acceptScheduled = await post('/api/review/schedule', { item_id: due.id, correct: true })
    assert.equal(acceptScheduled.status, 200)
    assert.ok(acceptScheduled.body.item.srs_stage >= 1)

    // Reject ("missed it") -> graded incorrect, then scheduled to reset.
    const other: Card = review.body.due.find((d: Card) => d.id !== due.id)
    const reject = await post('/api/review/answer', {
      item_id: other.id,
      input: '',
      question_type: 'self-grade',
      recalled: false,
    })
    assert.equal(reject.status, 200)
    assert.equal(reject.body.correct, false)
    assert.equal(reject.body.item.srs_stage, 0)

    const rejectScheduled = await post('/api/review/schedule', {
      item_id: other.id,
      correct: false,
    })
    assert.equal(rejectScheduled.status, 200)
    assert.equal(rejectScheduled.body.item.srs_stage, 0)
  })
})

describe('API - two-part review staging', () => {
  it('grades reading + meaning without scheduling, then advances once both are correct', async () => {
    const review = await get(`/api/review/start?dataset=${srsDataset.id}&limit=20`)
    assert.equal(review.status, 200)
    const due: Card = review.body.due.find(
      (d: Card) => d.readings.length > 0 && d.meanings.length > 0
    )
    assert.ok(due, 'expected a due vocabulary item with both reading and meaning')

    // Reading correct -> graded correct, but the item is not scheduled yet.
    const reading = await post('/api/review/answer', {
      item_id: due.id,
      input: due.readings[0],
      question_type: 'reading',
    })
    assert.equal(reading.status, 200)
    assert.equal(reading.body.correct, true)
    const before = reading.body.item.srs_stage

    // Meaning correct -> still not scheduled (the client decides the combined result).
    const meaning = await post('/api/review/answer', {
      item_id: due.id,
      input: due.meanings[0],
      question_type: 'meaning',
    })
    assert.equal(meaning.status, 200)
    assert.equal(meaning.body.correct, true)
    assert.equal(meaning.body.item.srs_stage, before, 'grading must not schedule')

    // The client reports "both correct" -> advance one stage.
    const scheduled = await post('/api/review/schedule', { item_id: due.id, correct: true })
    assert.equal(scheduled.status, 200)
    assert.equal(scheduled.body.item.srs_stage, before + 1)
  })

  it('resets an item to Apprentice I when the client reports a miss', async () => {
    const review = await get(`/api/review/start?dataset=${srsDataset.id}&limit=20`)
    const due: Card = review.body.due.find(
      (d: Card) => d.readings.length > 0 && d.meanings.length > 0
    )
    assert.ok(due, 'expected a due vocabulary item with both reading and meaning')

    // Advance it first so the reset (non-zero -> zero) is observable.
    await post('/api/review/schedule', { item_id: due.id, correct: true })

    // A wrong reading answer is graded incorrect; the client then schedules a reset.
    const wrong = await post('/api/review/answer', {
      item_id: due.id,
      input: 'zzzzzz',
      question_type: 'reading',
    })
    assert.equal(wrong.status, 200)
    assert.equal(wrong.body.correct, false)

    const scheduled = await post('/api/review/schedule', { item_id: due.id, correct: false })
    assert.equal(scheduled.status, 200)
    assert.equal(scheduled.body.item.srs_stage, 0)
    assert.equal(scheduled.body.item.stage_name, 'Apprentice I')
  })
})

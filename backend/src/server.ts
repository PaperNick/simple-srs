import path from 'node:path'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import * as dbc from './db'
import { parseReadings, parseMeanings, grade, gradeCard } from './grading'
import type {
  Card,
  DatasetsResponse,
  GradeResult,
  ItemRow,
  ItemsResponse,
  LessonCompleteResponse,
  PracticeAnswerResponse,
  QuestionType,
  ReviewAnswerResponse,
  ReviewScheduleResponse,
  ReviewStartResponse,
  VocabAddResponse,
} from '@shared/types'

const db = dbc.open()
const BACKEND_PORT = process.env.BACKEND_PORT || 3000
const app = express()
const QUESTION_TYPES: readonly QuestionType[] = ['reading', 'meaning', 'self-grade']

app.use(express.json())

// In production (after `npm run build`) serve the bundled React frontend.
const CLIENT_DIST = path.join(import.meta.dirname, '..', '..', 'frontend', 'dist')
app.use(express.static(CLIENT_DIST))

// Serve static files and media referenced by the datasets
const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data')
app.use('/static', express.static(path.join(DATA_DIR, 'static')))

interface ReviewAnswerBody {
  question_type?: string
  input?: string
  recalled?: boolean
}

interface ReviewScheduleBody {
  correct?: boolean
}

interface VocabAddBody {
  characters?: string
  meanings?: string[]
  readings?: string[]
  level?: number
  dataset?: string
}

/** Shape an item row into the public card metadata returned to the client. */
function toCard(item: ItemRow): Card {
  return {
    id: item.id,
    type: item.type,
    level: item.level,
    characters: item.characters,
    readings: parseReadings(item),
    meanings: parseMeanings(item),
    audio: item.audio || null,
  }
}

/**
 * Read the required dataset id from the query string, responding with 400 when
 * it's missing. No default/fallback dataset is assumed.
 */
function datasetFrom(req: Request, res: Response): string | null {
  const dataset = req.query.dataset
  if (dataset) {
    return String(dataset)
  }
  res.status(400).json({ error: 'dataset is required' })
  return null
}

/** Look up the item referenced by a request body, responding with 404 when absent. */
function findItemOr404(req: Request, res: Response): ItemRow | null {
  const { item_id } = (req.body as { item_id?: number }) || {}
  const item = dbc.getItem(db, item_id ?? -1)
  if (item) {
    return item
  }
  res.status(404).json({ error: 'item not found' })
  return null
}

app.get('/api/stats', (_req, res) => {
  res.json(dbc.stats(db))
})

app.get('/api/datasets', (_req, res) => {
  const body: DatasetsResponse = { datasets: dbc.datasets(db) }
  res.json(body)
})

app.get('/api/practice/items', (req, res) => {
  const dataset = datasetFrom(req, res)
  if (!dataset) {
    return
  }
  const body: ItemsResponse = { items: dbc.practiceItems(db, dataset).map(toCard) }
  res.json(body)
})

/** Grade a practice answer. Reuses the same normalizer but never touches SRS. */
app.post('/api/practice/answer', (req, res) => {
  const item = findItemOr404(req, res)
  if (!item) {
    return
  }
  const { input } = (req.body as { input?: string }) || {}
  const result = grade(input ?? '', item)
  const body: PracticeAnswerResponse = Array.isArray(result)
    ? { correct: false, accepted: result }
    : { correct: result.correct, accepted: result.accepted }
  res.json(body)
})

/** Add a single vocabulary item. Useful for testing before you supply the dataset. */
app.post('/api/vocab', (req, res) => {
  const { characters, meanings, readings, level, dataset } = (req.body as VocabAddBody) || {}
  if (!characters) {
    return res.status(400).json({ error: 'characters required' })
  }
  if (!dataset) {
    return res.status(400).json({ error: 'dataset required' })
  }
  const id = dbc.addVocab(db, { characters, meanings, readings, level, dataset })
  const body: VocabAddResponse = { id, stats: dbc.stats(db) }
  res.status(201).json(body)
})

app.get('/api/lesson/start', (req, res) => {
  const dataset = datasetFrom(req, res)
  if (!dataset) {
    return
  }
  const body: ItemsResponse = { items: dbc.newItems(db, 5, dataset).map(toCard) }
  res.json(body)
})

/** Mark the given items as learned and schedule their first review immediately. */
app.post('/api/lesson/complete', (req, res) => {
  const ids = ((req.body as { item_ids?: number[] }) || {}).item_ids || []
  const learnedCount = dbc.learnItems(db, ids)
  const body: LessonCompleteResponse = { learned: learnedCount, stats: dbc.stats(db) }
  res.json(body)
})

/** Validate a client-supplied question type, returning null when invalid. */
function parseQuestionType(value: unknown): QuestionType | null {
  return QUESTION_TYPES.includes(value as QuestionType) ? (value as QuestionType) : null
}

/** Human-readable name for a stage number. */
function stageName(stage: number): string {
  return stage === dbc.BURNED_STAGE ? 'Burned' : dbc.STAGES[stage].name
}

app.get('/api/review/start', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? ''), 10) || 20, 100)
  const dataset = datasetFrom(req, res)
  if (!dataset) {
    return
  }
  // Return the due items as cards. The client turns each card into its
  // reading/meaning steps and decides when the item has fully passed.
  const due: Card[] = dbc.dueItems(db, limit, dataset).map(toCard)
  const body: ReviewStartResponse = { due }
  res.json(body)
})

/** Grade a single review answer for feedback. */
app.post('/api/review/answer', (req, res) => {
  const item = findItemOr404(req, res)
  if (!item) {
    return
  }
  const body = (req.body as ReviewAnswerBody) || {}
  const question_type = parseQuestionType(body.question_type)
  if (!question_type) {
    return res.status(400).json({ error: 'invalid question_type' })
  }
  // A self-grade card is graded by the client's accept/reject decision.
  const result: GradeResult = gradeCard(item, body.input ?? '', question_type, body.recalled)
  dbc.recordReview(
    db,
    item.id,
    question_type,
    String(body.input || ''),
    result.correct,
    item.srs_stage
  )

  const response: ReviewAnswerResponse = {
    correct: result.correct,
    expected: result.expectedDisplay,
    item: {
      ...toCard(item),
      srs_stage: item.srs_stage,
      stage_name: stageName(item.srs_stage),
      burned: item.srs_stage === dbc.BURNED_STAGE,
    },
  }
  res.json(response)
})

/**
 * Apply the SRS schedule for an item once its review is decided: advance a stage
 * when every required question type was answered correctly, otherwise reset.
 */
app.post('/api/review/schedule', (req, res) => {
  const item = findItemOr404(req, res)
  if (!item) {
    return
  }
  const { correct } = (req.body as ReviewScheduleBody) || {}
  if (typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'correct is required' })
  }
  const schedule = dbc.scheduleAfterAnswer(db, item, correct)
  const response: ReviewScheduleResponse = {
    item: {
      ...toCard(item),
      srs_stage: schedule.stage,
      stage_name: schedule.stageName,
      burned: schedule.burned,
    },
  }
  res.json(response)
})

/** SPA fallback: serve the React bundle for any non-API GET (only if built). */
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/static')) {
    return next()
  }
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), err => {
    if (err) {
      res
        .status(404)
        .send('Client not built. Run `npm run build` in client/, or use the Vite dev server.')
    }
  })
})

const server = app.listen(BACKEND_PORT, () => {
  const s = dbc.stats(db)
  console.log(`Simple SRS running at http://localhost:${BACKEND_PORT}`)
  for (const ds of s.datasets) {
    const extra =
      ds.mode === 'srs'
        ? `${ds.new} new, ${ds.learning} learning, ${ds.due} due`
        : `${ds.total} items`
    console.log(`  ${ds.name}: ${extra}`)
  }
  console.log('Press Ctrl+C to stop.')
})

/** Tear the server and database down cleanly on SIGINT/SIGTERM. */
function shutdown(signal: string) {
  console.log(`\n${signal} received - shutting down…`)
  server.close(() => {
    try {
      db.close()
    } catch (_) {}
    console.log('Server stopped.')
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}

/** Stay attached to the terminal like `vite`: stop cleanly on Ctrl+C / SIGTERM. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal))
}

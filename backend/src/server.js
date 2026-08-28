'use strict'

const path = require('path')
const express = require('express')
const dbc = require('./db')
const { parseReadings, grade, gradeQuestion } = require('./grading')

const db = dbc.open()
const BACKEND_PORT = process.env.BACKEND_PORT || 3000
const app = express()

app.use(express.json())

// In production (after `npm run build`) serve the bundled React frontend.
const CLIENT_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist')
app.use(express.static(CLIENT_DIST))

// Serve static files and media referenced by the datasets
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
app.use('/static', express.static(path.join(DATA_DIR, 'static')))

/**
 * Shape an item row into the public card metadata returned to the client.
 *
 * @param {object} item A database row.
 * @returns {{id: number, type: string, level: number, characters: string, readings: string[], meaning: string|null, audio: string|null}}
 *   The public card fields.
 */
function toCard(item) {
  return {
    id: item.id,
    type: item.type,
    level: item.level,
    characters: item.characters,
    readings: parseReadings(item),
    meaning: item.meaning,
    audio: item.audio || null,
  }
}

/**
 * Read the required dataset id from the query string, responding with 400 when
 * it's missing. No default/fallback dataset is assumed - every dataset-scoped
 * endpoint is driven by the datasets.json registry via the frontend.
 *
 * @param {import('express').Request} req The request.
 * @param {import('express').Response} res The response.
 * @returns {string|null} The dataset id, or null after a 400 response.
 */
function datasetFrom(req, res) {
  const dataset = req.query.dataset
  if (dataset) {
    return dataset
  }
  res.status(400).json({ error: 'dataset is required' })
  return null
}

/**
 * Look up the item referenced by a request body, responding with 404 when it
 * does not exist.
 *
 * @param {import('express').Request} req The request.
 * @param {import('express').Response} res The response.
 * @returns {object|null} The item row, or null after a 404 response.
 */
function findItemOr404(req, res) {
  const { item_id } = req.body || {}
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id)
  if (item) {
    return item
  }
  res.status(404).json({ error: 'item not found' })
  return null
}

app.get('/api/stats', (req, res) => {
  res.json(dbc.stats(db))
})

app.get('/api/datasets', (req, res) => {
  res.json({ datasets: dbc.datasets(db) })
})

app.get('/api/practice/items', (req, res) => {
  const dataset = datasetFrom(req, res)
  if (!dataset) {
    return
  }
  res.json({ items: dbc.practiceItems(db, dataset).map(toCard) })
})

/**
 * Grade a practice answer. Reuses the same normalizer but never touches SRS.
 */
app.post('/api/practice/answer', (req, res) => {
  const item = findItemOr404(req, res)
  if (!item) {
    return
  }
  const result = grade(req.body?.input, item)
  res.json({ correct: result.correct, accepted: result.accepted })
})

/**
 * Add a single vocabulary item. Useful for testing before you supply the dataset.
 */
app.post('/api/vocab', (req, res) => {
  const { characters, meaning, readings, level, dataset } = req.body || {}
  if (!characters) {
    return res.status(400).json({ error: 'characters required' })
  }
  if (!dataset) {
    return res.status(400).json({ error: 'dataset required' })
  }
  const id = dbc.addVocab(db, { characters, meaning, readings, level, dataset })
  res.status(201).json({ id, stats: dbc.stats(db) })
})

app.get('/api/lesson/start', (req, res) => {
  const dataset = datasetFrom(req, res)
  if (!dataset) {
    return
  }
  const items = dbc.newItems(db, 5, dataset)
  res.json({ items: items.map(toCard) })
})

/**
 * Mark the given items as learned and schedule their first review immediately.
 */
app.post('/api/lesson/complete', (req, res) => {
  const ids = (req.body && req.body.item_ids) || []
  const now = Date.now()

  let learnedCount = 0
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    const updatedCount = db
      .prepare(
        `UPDATE items SET srs_stage = 0, available_at = ? WHERE srs_stage = -1 AND id IN (${placeholders})`
      )
      .run(now, ...ids).changes
    learnedCount = updatedCount
  }
  res.json({ learned: learnedCount, stats: dbc.stats(db) })
})

app.get('/api/review/start', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100)
  const dataset = datasetFrom(req, res)
  if (!dataset) {
    return
  }
  const items = dbc.dueItems(db, limit, dataset)
  // Ask reading OR meaning for each item (prompt -> recall either).
  res.json({
    due: items.map(item => ({
      ...toCard(item),
      question_type: Math.random() < 0.5 ? 'reading' : 'meaning',
    })),
  })
})

app.post('/api/review/answer', (req, res) => {
  const item = findItemOr404(req, res)
  if (!item) {
    return
  }
  const question_type = req.body?.question_type === 'meaning' ? 'meaning' : 'reading'
  const result = gradeQuestion(item, req.body?.input, question_type)
  const schedule = dbc.scheduleAfterAnswer(db, item, result.correct)

  db.prepare(
    `
    INSERT INTO reviews (item_id, question_type, input, correct, srs_stage_after, answered_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    item.id,
    question_type,
    String(req.body?.input || ''),
    result.correct ? 1 : 0,
    schedule.stage,
    Date.now()
  )

  res.json({
    correct: result.correct,
    expected: result.expectedDisplay,
    item: {
      ...toCard(item),
      srs_stage: schedule.stage,
      stage_name: schedule.stageName,
      burned: schedule.burned,
    },
  })
})

/**
 * SPA fallback: serve the React bundle for any non-API GET (only if built).
 */
app.use((req, res, next) => {
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

/**
 * Tear the server and database down cleanly on SIGINT/SIGTERM.
 *
 * @param {string} signal The received signal name.
 */
function shutdown(signal) {
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

/**
 * Stay attached to the terminal like `vite`: stop cleanly on Ctrl+C / SIGTERM.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal))
}

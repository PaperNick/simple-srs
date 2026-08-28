'use strict'

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const DB_PATH = process.env.SIMPLE_SRS_DB || path.join(DATA_DIR, 'simple_srs.sqlite')

/**
 * SRS stages. Index == srs_stage.
 * A stage's interval is how long you wait AFTER being promoted to it before
 * the next review. srs_stage === BURNED_STAGE means the item is finished.
 */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const STAGES = [
  { name: 'Apprentice I', interval: 1 * HOUR },
  { name: 'Apprentice II', interval: 4 * HOUR },
  { name: 'Apprentice III', interval: 8 * HOUR },
  { name: 'Apprentice IV', interval: 1 * DAY },
  { name: 'Guru I', interval: 2 * DAY },
  { name: 'Guru II', interval: 5 * DAY },
  { name: 'Master', interval: 10 * DAY },
  { name: 'Enlightened', interval: 20 * DAY },
]

const BURNED_STAGE = STAGES.length // 8
const RE_AGAIN_DELAY = 10 * 60 * 1000 // 10 min after a miss

const TYPE_CHARACTER = 'character'
const TYPE_VOCAB = 'vocabulary'

// Rows per multi-row INSERT; kept under SQLite's 32766 bound-parameter limit.
const BULK_INSERT_CHUNK = 500

/**
 * Create the `items` and `reviews` tables and their indexes (idempotent).
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 */
function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT    NOT NULL,
      dataset      TEXT,
      level        INTEGER NOT NULL DEFAULT 1,
      characters   TEXT    NOT NULL,          -- prompt (the item's characters)
      readings     TEXT    NOT NULL,          -- JSON array of accepted romanizations
      meaning      TEXT,                      -- English meaning, for vocabulary items
      audio        TEXT,                      -- optional URL to a local audio file
      srs_stage    INTEGER NOT NULL DEFAULT -1, -- -1 = new/unlearned
      available_at INTEGER,                   -- epoch ms when next review is due
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_due ON items (available_at);
    CREATE INDEX IF NOT EXISTS idx_items_stage ON items (srs_stage);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items (type);
    CREATE INDEX IF NOT EXISTS idx_items_dataset ON items (dataset);

    CREATE TABLE IF NOT EXISTS reviews (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      question_type   TEXT    NOT NULL,
      input           TEXT,
      correct         INTEGER NOT NULL,
      srs_stage_after INTEGER NOT NULL,
      answered_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_item ON reviews (item_id);
  `)
}

/**
 * Datasets. Each entry in data/datasets.json is one JSON file that appears as
 * a separate item in the UI. All dataset files share one item schema.
 */
const DATASETS_JSON = path.join(DATA_DIR, 'datasets.json')

/**
 * Read the dataset registry from data/datasets.json. If it is missing or
 * unreadable there are no datasets, so the database stays empty.
 *
 * @returns {Array<{id: string, file: string, mode: string, type: string}>}
 *   The configured datasets.
 */
function listDatasets() {
  if (!fs.existsSync(DATASETS_JSON)) {
    return []
  }
  try {
    return JSON.parse(fs.readFileSync(DATASETS_JSON, 'utf8'))
  } catch (_) {
    return []
  }
}

/**
 * Insert many item rows with a single multi-row INSERT per chunk, so the number
 * of statements is independent of the batch size. Safe to call inside a transaction.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {Array<object>} rows Item-shaped rows (dataset, type, level,
 *   characters, readings, meaning, audio, srs_stage, available_at, created_at).
 * @param {number} now Epoch ms used to fill an omitted `created_at`.
 * @returns {number} The number of rows inserted.
 */
function bulkInsertItems(db, rows, now = Date.now()) {
  const columns =
    'dataset, type, level, characters, readings, meaning, audio, srs_stage, available_at, created_at'
  let inserted = 0
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK)
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(', ')
    const stmt = db.prepare(`INSERT INTO items (${columns}) VALUES ${placeholders}`)
    const params = []
    for (const row of chunk) {
      params.push(
        row.dataset,
        row.type,
        row.level || 1,
        row.characters,
        JSON.stringify(row.readings || []),
        row.meaning || null,
        row.audio || null,
        row.srs_stage ?? -1,
        row.available_at ?? null,
        row.created_at ?? now
      )
    }
    stmt.run(...params)
    inserted += chunk.length
  }
  return inserted
}

/**
 * Insert the contents of each dataset JSON file into `items`, skipping any
 * dataset that is already present. New items start as unlearned (srs_stage -1).
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @returns {{ inserted: number }} How many rows were inserted.
 */
function seed(db) {
  const now = Date.now()
  const rows = []

  for (const dataset of listDatasets()) {
    const file = path.join(DATA_DIR, dataset.file)
    if (!fs.existsSync(file)) {
      continue
    }
    const existing = db
      .prepare('SELECT COUNT(*) AS n FROM items WHERE dataset = ?')
      .get(dataset.id).n
    if (existing > 0) {
      continue
    }

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const item of parsed) {
      rows.push({
        dataset: dataset.id,
        type: item.type || dataset.type,
        level: item.level || 1,
        characters: item.characters,
        readings: item.readings || [],
        meaning: item.meaning || null,
        audio: item.audio || null,
        srs_stage: -1,
        available_at: null,
        created_at: now,
      })
    }
  }

  const inserted = db.transaction(() => bulkInsertItems(db, rows, now))()
  return { inserted }
}

/**
 * Update an item's SRS stage and next review time based on the answer.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {{ id: number, srs_stage: number }} item The item being reviewed.
 * @param {boolean} correct Whether the answer was correct.
 * @returns {{stage: number, stageName: string, availableAt: number|null, burned: boolean}}
 *   The resulting stage and schedule.
 */
function scheduleAfterAnswer(db, item, correct) {
  const now = Date.now()
  let stage
  let availableAt

  if (!correct) {
    stage = 0
    availableAt = now + RE_AGAIN_DELAY
  } else if (item.srs_stage + 1 >= BURNED_STAGE) {
    stage = BURNED_STAGE
    availableAt = null
  } else {
    stage = item.srs_stage + 1
    availableAt = now + STAGES[stage].interval
  }

  db.prepare('UPDATE items SET srs_stage = ?, available_at = ? WHERE id = ?').run(
    stage,
    availableAt,
    item.id
  )

  return {
    stage,
    stageName: stage === BURNED_STAGE ? 'Burned' : STAGES[stage].name,
    availableAt,
    burned: stage === BURNED_STAGE,
  }
}

/**
 * Queries are scoped to a dataset. SRS operates on a dataset whose mode is
 * 'srs'; practice operates on a 'practice' dataset (never touches srs_stage).
 */

/**
 * Return items that are currently due for review.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {number} limit Maximum number of items.
 * @param {string} dataset Dataset id to scope to.
 * @returns {Array} Due items.
 */
function dueItems(db, limit, dataset) {
  return db
    .prepare(
      `
    SELECT * FROM items
    WHERE dataset = ?
      AND srs_stage >= 0
      AND srs_stage < ?
      AND available_at IS NOT NULL
      AND available_at <= ?
    ORDER BY available_at ASC
    LIMIT ?
  `
    )
    .all(dataset, BURNED_STAGE, Date.now(), limit)
}

/**
 * Return the next, not-yet-learned items for a lesson.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {number} limit Maximum number of items.
 * @param {string} dataset Dataset id to scope to.
 * @returns {Array} New (unlearned) items.
 */
function newItems(db, limit, dataset) {
  return db
    .prepare(
      `
    SELECT * FROM items
    WHERE dataset = ?
      AND srs_stage = -1
    ORDER BY level ASC, id ASC
    LIMIT ?
  `
    )
    .all(dataset, limit)
}

/**
 * Return every item in a dataset (used by practice mode, which can be any
 * dataset, not just the alphabet).
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {string} dataset Dataset id to scope to.
 * @returns {Array} All items in the dataset.
 */
function practiceItems(db, dataset) {
  return db
    .prepare(
      `
    SELECT * FROM items
    WHERE dataset = ?
    ORDER BY id ASC
  `
    )
    .all(dataset)
}

/**
 * Build dashboard summaries for every configured dataset. SRS datasets also
 * carry new/learning/due/burned counts and a per-stage breakdown.
 *
 * A single GROUP BY aggregate computes every bucket for all datasets in one round-trip.
 * The per-dataset loop only slices the already-computed row.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @returns {Array<object>} A summary object per dataset.
 */
function datasets(db) {
  const now = Date.now()
  const registered = listDatasets()
  if (registered.length === 0) {
    return []
  }

  const stageExpr = STAGES.map(
    (_, index) => `sum(case when srs_stage = ${index} then 1 else 0 end) AS stage_${index}`
  ).join(',\n        ')

  const aggregates = new Map(
    db
      .prepare(
        `
      SELECT
        dataset,
        count(*) AS total,
        sum(case when srs_stage = -1 then 1 else 0 end) AS new,
        sum(case when srs_stage = ${BURNED_STAGE} then 1 else 0 end) AS burned,
        sum(case when srs_stage >= 0 AND srs_stage < ${BURNED_STAGE} AND available_at IS NOT NULL AND available_at <= ? then 1 else 0 end) AS due,
        ${stageExpr}
      FROM items
      GROUP BY dataset
    `
      )
      .all(now)
      .map(row => [row.dataset, row])
  )

  return registered.map(dataset => {
    const row = aggregates.get(dataset.id)
    const total = row ? row.total : 0
    const summary = { ...dataset, total }
    if (dataset.mode !== 'srs') {
      return summary
    }

    const newCount = row ? row.new : 0
    const burned = row ? row.burned : 0
    summary.new = newCount
    summary.burned = burned
    summary.learning = total - newCount - burned
    summary.due = row ? row.due : 0
    summary.stages = STAGES.map((stage, index) => ({
      stage: index,
      name: stage.name,
      count: row ? row[`stage_${index}`] : 0,
    }))
    return summary
  })
}

/**
 * Insert a single vocabulary item and return its id.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {{characters: string, meaning?: string, readings?: string[], level?: number, audio?: string, dataset?: string}} options
 *   Item fields.
 * @returns {number} The new row's id.
 */
function addVocab(db, { characters, meaning, readings, level = 1, audio = null, dataset }) {
  const info = db
    .prepare(
      `
    INSERT INTO items (dataset, type, level, characters, readings, meaning, audio, srs_stage, available_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, -1, NULL, ?)
  `
    )
    .run(
      dataset,
      TYPE_VOCAB,
      level,
      characters,
      JSON.stringify(readings || []),
      meaning || null,
      audio || null,
      Date.now()
    )
  return info.lastInsertRowid
}

/**
 * Replace all vocabulary rows (and their reviews) with the given list, clearing
 * any existing word SRS progress. Used for bulk imports.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {Array<object>} words The new vocabulary items.
 * @param {string} dataset Dataset id to replace.
 * @returns {number} The number of rows inserted.
 */
function replaceVocab(db, words, dataset) {
  const now = Date.now()
  const rows = words.map(word => ({
    dataset,
    type: TYPE_VOCAB,
    level: word.level || 1,
    characters: word.characters,
    readings: word.readings || [],
    meaning: word.meaning || null,
    audio: word.audio || null,
    srs_stage: -1,
    available_at: null,
    created_at: now,
  }))

  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM reviews WHERE item_id IN (SELECT id FROM items WHERE dataset = ?)`).run(
      dataset
    )
    db.prepare('DELETE FROM items WHERE dataset = ?').run(dataset)
    bulkInsertItems(db, rows, now)
  })

  transaction()
  return words.length
}

/**
 * Return the full stats payload (per-dataset summaries) for the dashboard.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @returns {{datasets: Array<object>}} The stats.
 */
function stats(db) {
  return { datasets: datasets(db) }
}

/**
 * Open (creating if needed) the database, apply schema + migrations and seed the
 * configured datasets. Mutations from old schemas are applied so a pre-existing
 * file keeps working.
 *
 * @returns {import('better-sqlite3').Database} The open connection.
 */
function open() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  createSchema(db)

  migrateColumns(db)
  seed(db)
  return db
}

/**
 * Add the `audio` and `dataset` columns when opening a database created by an
 * older schema version, backfilling the dataset from the item type.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 */
function migrateColumns(db) {
  if (!hasColumn(db, 'audio')) {
    db.exec('ALTER TABLE items ADD COLUMN audio TEXT')
  }

  if (!hasColumn(db, 'dataset')) {
    db.exec('ALTER TABLE items ADD COLUMN dataset TEXT')
    // Backfill the dataset from each row's type using the configured registry
    // (no hard-coded dataset ids).
    const typeToDataset = new Map()
    for (const dataset of listDatasets()) {
      if (!typeToDataset.has(dataset.type)) {
        typeToDataset.set(dataset.type, dataset.id)
      }
    }
    const backfill = db.prepare('UPDATE items SET dataset = ? WHERE dataset IS NULL AND type = ?')
    for (const [type, datasetId] of typeToDataset) {
      backfill.run(datasetId, type)
    }
  }
}

/**
 * Whether the `items` table already has the given column.
 *
 * @param {import('better-sqlite3').Database} db Open database connection.
 * @param {string} name Column name.
 * @returns {boolean} Whether the column exists.
 */
function hasColumn(db, name) {
  return !!db.prepare("SELECT 1 FROM pragma_table_info('items') WHERE name = ?").get(name)
}

module.exports = {
  open,
  STAGES,
  BURNED_STAGE,
  scheduleAfterAnswer,
  dueItems,
  newItems,
  practiceItems,
  datasets,
  addVocab,
  replaceVocab,
  stats,
  TYPE_CHARACTER,
  TYPE_VOCAB,
}

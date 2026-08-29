import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type {
  DatasetConfig,
  DatasetItem,
  DatasetSummary,
  DatasetsResponse,
  ItemRow,
  ItemSeedRow,
  ItemType,
  ScheduleResult,
  SrsStage,
  StageSummary,
} from '@shared/types'

type DB = Database.Database

interface DatasetAggregate {
  dataset: string
  total: number
  new: number
  burned: number
  due: number
  [key: string]: string | number
}

interface AddVocabOptions {
  characters: string
  meanings?: string[]
  readings?: string[]
  level?: number
  audio?: string | null
  dataset?: string
}

const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data')

/** Resolve the SQLite path lazily so tests can point SIMPLE_SRS_DB at a temp file. */
function dbPath(): string {
  return process.env.SIMPLE_SRS_DB || path.join(DATA_DIR, 'simple_srs.sqlite')
}

/**
 * SRS stages. Index == srs_stage.
 * A stage's interval is how long you wait AFTER being promoted to it before
 * the next review. srs_stage === BURNED_STAGE means the item is finished.
 */
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const STAGES: SrsStage[] = [
  { name: 'Apprentice I', interval: 1 * HOUR },
  { name: 'Apprentice II', interval: 4 * HOUR },
  { name: 'Apprentice III', interval: 8 * HOUR },
  { name: 'Apprentice IV', interval: 1 * DAY },
  { name: 'Guru I', interval: 2 * DAY },
  { name: 'Guru II', interval: 5 * DAY },
  { name: 'Master', interval: 10 * DAY },
  { name: 'Enlightened', interval: 20 * DAY },
]

const BURNED_STAGE = STAGES.length
const RE_AGAIN_DELAY = 10 * 60 * 1000 // 10 min after a miss

const TYPE_CHARACTER: ItemType = 'character'
const TYPE_VOCAB: ItemType = 'vocabulary'

// Rows per multi-row INSERT; kept under SQLite's 32766 bound-parameter limit.
const BULK_INSERT_CHUNK = 500

/**
 * Create the `items` and `reviews` tables and their indexes (idempotent).
 */
function createSchema(db: DB): void {
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
      meanings     TEXT,                      -- JSON array of English meanings, for vocabulary items
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
 */
function listDatasets(): DatasetConfig[] {
  if (!fs.existsSync(DATASETS_JSON)) {
    return []
  }
  try {
    return JSON.parse(fs.readFileSync(DATASETS_JSON, 'utf8')) as DatasetConfig[]
  } catch (_) {
    return []
  }
}

/**
 * Insert many item rows with a single multi-row INSERT per chunk, so the number
 * of statements is independent of the batch size. Safe to call inside a transaction.
 */
function bulkInsertItems(db: DB, rows: ItemSeedRow[], now = Date.now()): number {
  const columns =
    'dataset, type, level, characters, readings, meanings, audio, srs_stage, available_at, created_at'
  let inserted = 0
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK)
    const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(', ')
    const stmt = db.prepare(`INSERT INTO items (${columns}) VALUES ${placeholders}`)
    const params: unknown[] = []
    for (const row of chunk) {
      params.push(
        row.dataset,
        row.type,
        row.level || 1,
        row.characters,
        JSON.stringify(row.readings || []),
        JSON.stringify(row.meanings || []),
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
 */
function seed(db: DB): { inserted: number } {
  const now = Date.now()
  const rows: ItemSeedRow[] = []

  for (const dataset of listDatasets()) {
    const file = path.join(DATA_DIR, dataset.file)
    if (!fs.existsSync(file)) {
      continue
    }
    const existing = db
      .prepare('SELECT COUNT(*) AS n FROM items WHERE dataset = ?')
      .get(dataset.id) as { n: number }
    if (existing.n > 0) {
      continue
    }

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as DatasetItem[]
    for (const item of parsed) {
      rows.push({
        dataset: dataset.id,
        type: item.type || dataset.type,
        level: item.level || 1,
        characters: item.characters,
        readings: item.readings || [],
        meanings: item.meanings || [],
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
 */
function scheduleAfterAnswer(
  db: DB,
  item: { id: number; srs_stage: number },
  correct: boolean
): ScheduleResult {
  const now = Date.now()
  let stage: number
  let availableAt: number | null

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

/** Return items that are currently due for review. */
function dueItems(db: DB, limit: number, dataset: string): ItemRow[] {
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
    .all(dataset, BURNED_STAGE, Date.now(), limit) as ItemRow[]
}

/** Return the next, not-yet-learned items for a lesson. */
function newItems(db: DB, limit: number, dataset: string): ItemRow[] {
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
    .all(dataset, limit) as ItemRow[]
}

/** Return every item in a dataset (used by practice mode). */
function practiceItems(db: DB, dataset: string): ItemRow[] {
  return db
    .prepare(
      `
    SELECT * FROM items
    WHERE dataset = ?
    ORDER BY id ASC
  `
    )
    .all(dataset) as ItemRow[]
}

/**
 * Build dashboard summaries for every configured dataset. SRS datasets also
 * carry new/learning/due/burned counts and a per-stage breakdown.
 */
function datasets(db: DB): DatasetSummary[] {
  const now = Date.now()
  const registered = listDatasets()
  if (registered.length === 0) {
    return []
  }

  const stageExpr = STAGES.map(
    (_, index) => `sum(case when srs_stage = ${index} then 1 else 0 end) AS stage_${index}`
  ).join(',\n        ')

  const aggregates = new Map(
    (
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
        .all(now) as DatasetAggregate[]
    ).map(row => [row.dataset, row] as const)
  )

  return registered.map(dataset => {
    const row = aggregates.get(dataset.id)
    const total = row ? row.total : 0
    const summary = { ...dataset, total } as DatasetSummary
    if (dataset.mode !== 'srs') {
      return summary
    }

    const newCount = row ? row.new : 0
    const burned = row ? row.burned : 0
    summary.new = newCount
    summary.burned = burned
    summary.learning = total - newCount - burned
    summary.due = row ? row.due : 0
    summary.stages = STAGES.map((stage, index): StageSummary => ({
      stage: index,
      name: stage.name,
      count: row ? Number(row[`stage_${index}`]) : 0,
    }))
    return summary
  })
}

/** Insert a single vocabulary item and return its id. */
function addVocab(
  db: DB,
  { characters, meanings, readings, level = 1, audio = null, dataset }: AddVocabOptions
): number {
  const info = db
    .prepare(
      `
    INSERT INTO items (dataset, type, level, characters, readings, meanings, audio, srs_stage, available_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, -1, NULL, ?)
  `
    )
    .run(
      dataset,
      TYPE_VOCAB,
      level,
      characters,
      JSON.stringify(readings || []),
      JSON.stringify(meanings || []),
      audio || null,
      Date.now()
    )
  return Number(info.lastInsertRowid)
}

/**
 * Replace all vocabulary rows (and their reviews) with the given list, clearing
 * any existing word SRS progress. Used for bulk imports.
 */
function replaceVocab(db: DB, words: DatasetItem[], dataset: string): number {
  const now = Date.now()
  const rows: ItemSeedRow[] = words.map(word => ({
    dataset,
    type: TYPE_VOCAB,
    level: word.level || 1,
    characters: word.characters,
    readings: word.readings || [],
    meanings: word.meanings || [],
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

/** Return the full stats payload (per-dataset summaries) for the dashboard. */
function stats(db: DB): DatasetsResponse {
  return { datasets: datasets(db) }
}

/**
 * Open (creating if needed) the database, apply the schema and seed the
 * configured datasets.
 */
function open(): DB {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  const db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  createSchema(db)
  seed(db)
  return db
}

export {
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

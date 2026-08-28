'use strict'

/**
 * Unit tests for the SQLite-backed data layer (src/db.js). These exercise the
 * query functions that the grading/scheduling tests don't reach (they only
 * cover the pure helpers). We point SIMPLE_SRS_DB at a throwaway temp file so the
 * real data/simple_srs.sqlite is never touched. The db.js functions take a
 * dataset id as an argument (they don't know about specific datasets), so these
 * tests use their own TEST_DATASET to scope queries.
 */

const { describe, it, before, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')

const TMP_DB = path.join(os.tmpdir(), `srs-db-${process.pid}-${Date.now()}.sqlite`)
process.env.SIMPLE_SRS_DB = TMP_DB

const TEST_DATASET = 'test-words'

const dbc = require('../src/db.js')
const grading = require('../src/grading.js')

let db

before(() => {
  db = dbc.open() // fresh DB: creates schema + seeds from data/*.json
})

after(() => {
  try {
    if (db) {
      db.close()
    }
  } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(TMP_DB + suffix, { force: true })
    } catch (_) {}
  }
})

describe('parseReadings', () => {
  it('parses a JSON array of readings', () => {
    assert.deepEqual(grading.parseReadings({ readings: '["g","k"]' }), ['g', 'k'])
  })
  it('returns [] for invalid JSON', () => {
    assert.deepEqual(grading.parseReadings({ readings: 'not json[' }), [])
  })
  it('returns [] for missing/null readings', () => {
    assert.deepEqual(grading.parseReadings({}), [])
    assert.deepEqual(grading.parseReadings({ readings: null }), [])
  })
})

describe('open() seeds the datasets from the datasets.json registry', () => {
  it('seeds every declared dataset (0 if its file is missing)', () => {
    const datasetsFile = path.join(__dirname, '..', 'data', 'datasets.json')
    if (!fs.existsSync(datasetsFile)) {
      // No registry -> no datasets, so nothing to seed.
      assert.equal(dbc.datasets(db).length, 0)
      return
    }
    const registry = JSON.parse(fs.readFileSync(datasetsFile, 'utf8'))
    const summaries = dbc.datasets(db)

    assert.equal(summaries.length, registry.length)
    for (const declared of registry) {
      const summary = summaries.find(s => s.id === declared.id)
      assert.ok(summary, `seeded dataset '${declared.id}'`)
      const file = path.join(__dirname, '..', 'data', declared.file)
      const expected = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).length : 0
      assert.equal(summary.total, expected, `total for '${declared.id}'`)
    }
  })
})

describe('item queries', () => {
  function insertRow(row = {}) {
    const {
      dataset = TEST_DATASET,
      type = 'vocabulary',
      level = 1,
      characters,
      readings = [],
      meaning = null,
      audio = null,
      srs_stage = -1,
      available_at = null,
    } = row
    return db
      .prepare(
        `
      INSERT INTO items
        (dataset, type, level, characters, readings, meaning, audio, srs_stage, available_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        dataset,
        type,
        level,
        characters,
        JSON.stringify(readings),
        meaning,
        audio,
        srs_stage,
        available_at,
        Date.now()
      ).lastInsertRowid
  }

  beforeEach(() => {
    db.exec('DELETE FROM reviews; DELETE FROM items;')
  })

  it('newItems returns unlearned items ordered by level then id', () => {
    insertRow({ characters: 'ㄱ', level: 3, srs_stage: -1 })
    insertRow({ characters: 'ㄴ', level: 1, srs_stage: -1 })
    insertRow({ characters: 'ㄷ', level: 2, srs_stage: -1 })
    insertRow({ characters: 'ㄹ', level: 1, srs_stage: 3 }) // learned => excluded

    const rows = dbc.newItems(db, 5, TEST_DATASET)
    assert.equal(rows.length, 3)
    assert.ok(rows.every(r => r.srs_stage === -1))
    // Level 1 (ㄴ) before level 2 (ㄷ) before level 3 (ㄱ)
    assert.deepEqual(
      rows.map(r => r.characters),
      ['ㄴ', 'ㄷ', 'ㄱ']
    )
  })

  it('newItems respects the limit', () => {
    for (let i = 0; i < 10; i++) {
      insertRow({ characters: `w${i}`, level: 1 })
    }
    assert.equal(dbc.newItems(db, 4, TEST_DATASET).length, 4)
  })

  it('practiceItems returns all items for a dataset ordered by id', () => {
    const a = insertRow({ dataset: 'hangul', type: 'character', characters: 'ㅏ' })
    const b = insertRow({ dataset: 'hangul', type: 'character', characters: 'ㅓ' })
    insertRow({ dataset: TEST_DATASET, characters: '가' }) // other dataset => excluded
    const rows = dbc.practiceItems(db, 'hangul')
    assert.deepEqual(
      rows.map(r => r.id),
      [a, b]
    )
  })

  it('dueItems returns only past-due, non-burned, learned items', () => {
    const now = Date.now()
    const pastDue = insertRow({ characters: '가', srs_stage: 1, available_at: now - 1000 })
    insertRow({ characters: '나', srs_stage: 2, available_at: now + 60_000 }) // future => not due
    insertRow({ characters: '다', srs_stage: -1, available_at: now - 1000 }) // new => not due
    insertRow({ characters: '라', srs_stage: dbc.BURNED_STAGE, available_at: now - 1000 }) // burned => not due

    const rows = dbc.dueItems(db, 20, TEST_DATASET)
    assert.deepEqual(
      rows.map(r => r.id),
      [pastDue]
    )
  })
})

describe('addVocab / replaceVocab / stats', () => {
  beforeEach(() => {
    db.exec('DELETE FROM reviews; DELETE FROM items;')
  })

  it('addVocab inserts a new vocabulary row and returns its id', () => {
    const id = dbc.addVocab(db, {
      characters: '가',
      meaning: 'To go',
      readings: ['ga'],
      level: 2,
      dataset: TEST_DATASET,
    })
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id)
    assert.equal(row.characters, '가')
    assert.equal(row.meaning, 'To go')
    assert.deepEqual(grading.parseReadings(row), ['ga'])
    assert.equal(row.type, dbc.TYPE_VOCAB)
    assert.equal(row.dataset, TEST_DATASET)
    assert.equal(row.srs_stage, -1)
  })

  it('replaceVocab clears old words + reviews and inserts the new list', () => {
    const oldId = dbc.addVocab(db, {
      characters: '가는',
      meaning: 'Old',
      readings: ['gada'],
      dataset: TEST_DATASET,
    })
    db.prepare(
      `
      INSERT INTO reviews (item_id, question_type, input, correct, srs_stage_after, answered_at)
      VALUES (?, 'reading', 'gada', 1, 0, ?)
    `
    ).run(oldId, Date.now())

    const n = dbc.replaceVocab(
      db,
      [
        { characters: '갑', meaning: 'A', readings: ['gap'], level: 1 },
        { characters: '만', meaning: 'B', readings: ['man'], level: 2 },
      ],
      TEST_DATASET
    )
    assert.equal(n, 2)
    const remaining = db
      .prepare('SELECT COUNT(*) AS n FROM items WHERE dataset = ?')
      .get(TEST_DATASET).n
    const reviews = db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n
    assert.equal(remaining, 2)
    assert.equal(reviews, 0)
  })

  it('datasets/stats report new, learning, due and burned counts', () => {
    // datasets()/stats() only report configured (registered) datasets, so scope
    // the assertions to a dataset that actually exists in the registry.
    const datasetsFile = path.join(__dirname, '..', 'data', 'datasets.json')
    if (!fs.existsSync(datasetsFile)) {
      return
    }
    const registry = JSON.parse(fs.readFileSync(datasetsFile, 'utf8'))
    const target = registry.find(d => d.mode === 'srs') || registry[0]
    if (!target) {
      return
    }

    const now = Date.now()
    const insert = (chars, stage, avail) => {
      db.prepare(
        `
        INSERT INTO items (dataset, type, level, characters, readings, meaning, audio, srs_stage, available_at, created_at)
        VALUES (?, ?, 1, ?, '[]', NULL, NULL, ?, ?, ?)
      `
      ).run(target.id, dbc.TYPE_VOCAB, chars, stage, avail, now)
    }
    insert('new1', -1, null)
    insert('new2', -1, null)
    insert('learn1', 0, now - 1000) // due
    insert('learn2', 1, now - 1000) // due
    insert('learn3', 2, now + 60000) // not due yet
    insert('burn', dbc.BURNED_STAGE, now - 1000) // burned

    const s = dbc.stats(db)
    const words = s.datasets.find(d => d.id === target.id)
    assert.ok(words, 'stats include the registered dataset')
    assert.equal(words.total, 6)
    assert.equal(words.new, 2)
    assert.equal(words.learning, 3)
    assert.equal(words.burned, 1)
    assert.equal(words.due, 2)
    // stage distribution: 0->1, 1->1, 2->1, rest 0
    const stage0 = words.stages.find(st => st.stage === 0)
    const stage1 = words.stages.find(st => st.stage === 1)
    assert.equal(stage0.count, 1)
    assert.equal(stage1.count, 1)
  })
})

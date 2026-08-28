'use strict'

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const dbc = require('../src/db.js')

const HOUR = 60 * 60 * 1000

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      srs_stage INTEGER NOT NULL,
      available_at INTEGER
    );
  `)
  return db
}

function insert(db, stage) {
  return db
    .prepare('INSERT INTO items (srs_stage, available_at) VALUES (?, ?)')
    .run(stage, Date.now()).lastInsertRowid
}

function get(db, id) {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id)
}

describe('scheduleAfterAnswer', () => {
  let db
  beforeEach(() => {
    db = makeDb()
  })

  it('advances one stage on a correct answer and schedules the next review', () => {
    const id = insert(db, 0)
    const r = dbc.scheduleAfterAnswer(db, { id, srs_stage: 0 }, true)
    assert.equal(r.stage, 1)
    assert.equal(r.stageName, 'Apprentice II')
    assert.equal(r.burned, false)
    // available_at = now + STAGES[1].interval (4h)
    assert.ok(Math.abs(r.availableAt - Date.now() - 4 * HOUR) < 5000)
    assert.equal(get(db, id).srs_stage, 1)
  })

  it('drops to Apprentice I on a wrong answer', () => {
    const id = insert(db, 5)
    const r = dbc.scheduleAfterAnswer(db, { id, srs_stage: 5 }, false)
    assert.equal(r.stage, 0)
    assert.equal(r.stageName, 'Apprentice I')
    assert.equal(get(db, id).srs_stage, 0)
  })

  it('burns on the final correct answer (terminal state)', () => {
    const last = dbc.STAGES.length - 1 // 7 (Enlightened)
    const id = insert(db, last)
    const r = dbc.scheduleAfterAnswer(db, { id, srs_stage: last }, true)
    assert.equal(r.stage, dbc.BURNED_STAGE)
    assert.equal(r.stageName, 'Burned')
    assert.equal(r.burned, true)
    assert.equal(r.availableAt, null)
    assert.equal(get(db, id).available_at, null)
  })

  it('never burns above the terminal stage', () => {
    const last = dbc.STAGES.length - 1
    const id = insert(db, last)
    const r = dbc.scheduleAfterAnswer(db, { id, srs_stage: last }, true)
    assert.ok(r.stage <= dbc.BURNED_STAGE)
  })
})

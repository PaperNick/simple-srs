import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import * as dbc from '../src/db'

type DB = Database.Database

const HOUR = 60 * 60 * 1000

// Run against the production schema in an in-memory database.
process.env.SIMPLE_SRS_DB = ':memory:'

function insert(db: DB, stage: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO items (type, characters, readings, srs_stage, available_at, created_at)
         VALUES ('vocabulary', '가', '[]', ?, ?, ?)`
      )
      .run(stage, Date.now(), Date.now()).lastInsertRowid
  )
}

function get(db: DB, id: number): { id: number; srs_stage: number; available_at: number | null } {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as {
    id: number
    srs_stage: number
    available_at: number | null
  }
}

describe('scheduleAfterAnswer', () => {
  let db: DB
  beforeEach(() => {
    db = dbc.open(false)
  })

  it('advances one stage on a correct answer and schedules the next review', () => {
    const id = insert(db, 0)
    const r = dbc.scheduleAfterAnswer(db, { id, srs_stage: 0 }, true)
    assert.equal(r.stage, 1)
    assert.equal(r.stageName, 'Apprentice II')
    assert.equal(r.burned, false)
    // available_at = now + STAGES[1].interval (4h)
    assert.ok(Math.abs((r.availableAt ?? 0) - Date.now() - 4 * HOUR) < 5000)
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

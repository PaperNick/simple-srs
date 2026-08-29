/**
 * Shared domain types for Simple SRS.
 *
 * These describe the three core concepts the app is built on:
 *   - datasets (the registry entries that become decks in the UI)
 *   - cards    (the public item shape returned to the client)
 *   - items    (the full database row behind each card)
 *
 * Only types live here; there are no runtime exports, so importing them is
 * free in both the backend and the frontend.
 */

/** The kind of content an item represents. */
export type ItemType = 'character' | 'vocabulary'

/** How a deck behaves: endless practice, or stage-based spaced repetition. */
export type DatasetMode = 'practice' | 'srs'

/** The two question forms a review can ask. */
export type QuestionType = 'reading' | 'meaning'

/** A session mode selected from the dashboard. */
export type SessionMode = 'lesson' | 'review'

/** The UI colour theme. */
export type Theme = 'dark' | 'light'

/** A single entry in `data/datasets.json` (one deck). */
export interface DatasetConfig {
  id: string
  name: string
  file: string
  mode: DatasetMode
  type: ItemType
  badge?: string
  description?: string
}

/** A single item as declared in a dataset JSON file (`data/<file>.json`). */
export interface DatasetItem {
  type: ItemType
  characters: string
  meanings?: string[]
  readings: string[]
  level: number
  audio: string | null
}

/** One rung of the SRS ladder. */
export interface SrsStage {
  name: string
  interval: number
}

/** A per-stage count in the dashboard breakdown. */
export interface StageSummary {
  stage: number
  name: string
  count: number
}

/** A dataset summary as returned by `/api/datasets` and `/api/stats`. */
export interface DatasetSummary extends DatasetConfig {
  total: number
  new?: number
  learning?: number
  due?: number
  burned?: number
  stages?: StageSummary[]
}

/** The public card shape returned to the client (no internal SRS fields). */
export interface Card {
  id: number
  type: ItemType
  level: number
  characters: string
  readings: string[]
  meanings: string[]
  audio: string | null
}

/** A review card: a card plus the question to ask for it. */
export interface ReviewCard extends Card {
  question_type: QuestionType
}

/** The full item row as stored in SQLite (internal representation). */
export interface ItemRow {
  id: number
  type: ItemType
  dataset: string | null
  level: number
  characters: string
  readings: string
  meanings: string | null
  audio: string | null
  srs_stage: number
  available_at: number | null
  created_at: number
}

/** A row bound for a bulk insert (before the readings JSON is serialized). */
export interface ItemSeedRow {
  dataset: string
  type: ItemType
  level: number
  characters: string
  readings: string[]
  meanings: string[]
  audio: string | null
  srs_stage: number
  available_at: number | null
  created_at: number
}

/** The result of grading a reading/meaning answer. */
export interface GradeResult {
  correct: boolean
  accepted: string[]
  expectedDisplay: string
}

/** The SRS scheduling result produced after a review answer. */
export interface ScheduleResult {
  stage: number
  stageName: string
  availableAt: number | null
  burned: boolean
}

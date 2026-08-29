/**
 * HTTP request/response payload shapes for the REST API.
 *
 * These describe the JSON bodies exchanged between the backend and the frontend.
 * The backend builds them (in `server.ts`) and the frontend consumes them (in
 * `frontend/src/api.ts`), so a shape drift is a compile error on both sides.
 */
import type { Card, DatasetSummary, ReviewCard } from './domain'

/** A list of dataset summaries, returned by `/api/stats` and `/api/datasets`. */
export interface DatasetsResponse {
  datasets: DatasetSummary[]
}

/** A list of cards, returned by `/api/practice/items` and `/api/lesson/start`. */
export interface ItemsResponse {
  items: Card[]
}

export interface VocabAddResponse {
  id: number
  stats: DatasetsResponse
}

export interface LessonCompleteResponse {
  learned: number
  stats: DatasetsResponse
}

export interface ReviewStartResponse {
  due: ReviewCard[]
}

/** A review answer's card payload (a card plus the resulting SRS state). */
export interface ReviewAnswerItem extends Card {
  srs_stage: number
  stage_name: string
  burned: boolean
}

export interface ReviewAnswerResponse {
  correct: boolean
  expected: string
  item: ReviewAnswerItem
}

export interface PracticeAnswerResponse {
  correct: boolean
  accepted: string[]
}

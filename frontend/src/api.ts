import type {
  DatasetsResponse,
  ItemsResponse,
  LessonCompleteResponse,
  PracticeAnswerResponse,
  QuestionType,
  ReviewAnswerResponse,
  ReviewScheduleResponse,
  ReviewStartResponse,
} from '@shared/types'

/** Perform a fetch and return the parsed JSON, throwing on a non-OK status. */
const API = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, options)
  if (!response.ok) {
    throw new Error('HTTP ' + response.status)
  }
  return response.json() as Promise<T>
}

/** Build fetch options for a JSON POST request. */
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const getStats = () => API<DatasetsResponse>('/api/stats')
export const getDatasets = () => API<DatasetsResponse>('/api/datasets')
export const startLesson = (dataset: string) =>
  API<ItemsResponse>(`/api/lesson/start?dataset=${dataset}`)
export const completeLesson = (item_ids: number[]) =>
  API<LessonCompleteResponse>('/api/lesson/complete', json('POST', { item_ids }))
export const startReview = (dataset: string) =>
  API<ReviewStartResponse>(`/api/review/start?dataset=${dataset}`)
export const reviewAnswer = (
  item_id: number,
  input: string,
  question_type: QuestionType,
  recalled?: boolean
) =>
  API<ReviewAnswerResponse>(
    '/api/review/answer',
    json('POST', { item_id, input, question_type, recalled })
  )

export const reviewSchedule = (item_id: number, correct: boolean) =>
  API<ReviewScheduleResponse>('/api/review/schedule', json('POST', { item_id, correct }))

export const getPracticeItems = (dataset: string) =>
  API<ItemsResponse>(`/api/practice/items?dataset=${dataset}`)
export const practiceAnswer = (item_id: number, input: string) =>
  API<PracticeAnswerResponse>('/api/practice/answer', json('POST', { item_id, input }))

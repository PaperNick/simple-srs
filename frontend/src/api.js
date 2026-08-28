/**
 * Perform a fetch and return the parsed JSON, throwing on a non-OK status.
 *
 * @param {string} path The request path.
 * @param {object} [options] fetch options.
 * @returns {Promise<any>} The parsed JSON body.
 */
const API = async (path, options) => {
  const response = await fetch(path, options)
  if (!response.ok) {
    throw new Error('HTTP ' + response.status)
  }
  return response.json()
}

/**
 * Build fetch options for a JSON POST request.
 *
 * @param {string} method HTTP method.
 * @param {object} body Request body.
 * @returns {{method: string, headers: object, body: string}} fetch options.
 */
const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const getStats = () => API('/api/stats')
export const getDatasets = () => API('/api/datasets')
export const startLesson = dataset => API(`/api/lesson/start?dataset=${dataset}`)
export const completeLesson = item_ids => API('/api/lesson/complete', json('POST', { item_ids }))
export const startReview = dataset => API(`/api/review/start?dataset=${dataset}`)
export const reviewAnswer = (item_id, input, question_type) =>
  API('/api/review/answer', json('POST', { item_id, input, question_type }))

export const getPracticeItems = dataset => API(`/api/practice/items?dataset=${dataset}`)
export const practiceAnswer = (item_id, input) =>
  API('/api/practice/answer', json('POST', { item_id, input }))

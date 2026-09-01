import * as dbc from '../../src/db'

/*
 * Synchronize a user's WaniKani SRS progress into the local database.
 *
 * Downloads the user's assignments (each links a subject to its current SRS
 * stage and next review time) plus the subjects needed to resolve an assignment
 * back to a card's characters. Each assignment is mapped to the card in the
 * matching dataset and its stage/available_at are written into the DB.
 *
 * WaniKani stages 0..9 (Initiate..Burned) are mapped onto the app's stages:
 *   0 -> new (-1), 1..8 -> Apprentice I..Enlightened, 9 -> Burned.
 *
 * Run build-wanikani.ts first so the cards exist, then:
 *   WANIKANI_API_KEY=... npx tsx scripts/japanese/sync-wanikani.ts
 *   npx tsx scripts/japanese/sync-wanikani.ts <api-key>
 */

const API_ROOT = 'https://api.wanikani.com/v2'

type AssignmentSubjectType = 'radical' | 'kanji' | 'vocabulary' | 'kana_vocabulary'

interface WkSubject {
  id: number
  object: string
  data: { characters: string | null }
}

interface WkAssignmentData {
  subject_id: number
  subject_type: AssignmentSubjectType
  srs_stage: number
  available_at: string | null
}

interface WkAssignment {
  id: number
  data: WkAssignmentData
}

interface WkCollection<T> {
  data: T[]
  pages: { next_url: string | null }
}

/** Aggregated progress for one card (merged subjects share one card). */
interface AggregatedProgress {
  stage: number
  availableAt: number | null
}

/** Which local dataset each assignment subject type belongs to. */
const DATASET_BY_TYPE: Record<AssignmentSubjectType, string> = {
  radical: 'wanikani-radicals',
  kanji: 'wanikani-kanji',
  vocabulary: 'wanikani-vocabulary',
  kana_vocabulary: 'wanikani-vocabulary',
}

/** The datasets that receive synced progress (in registration order). */
const SYNCED_DATASETS = ['wanikani-radicals', 'wanikani-kanji', 'wanikani-vocabulary']

/** Read the API key from the environment or the first CLI argument. */
function apiKey(): string {
  const key = process.env.WANIKANI_API_KEY || process.argv[2]
  if (!key) {
    console.error('Missing WaniKani API key. Set WANIKANI_API_KEY or pass it as an argument:')
    console.error('  npx tsx scripts/japanese/sync-wanikani.ts <api-key>')
    process.exit(1)
  }
  return key
}

/** Perform an authenticated WaniKani request, rethrowing network errors clearly. */
async function request(url: string, key: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, 'Wanikani-Revision': '20170710' },
    })
  } catch (error) {
    throw new Error(`request failed: ${(error as Error).message}`)
  }
}

/** Fetch every page of a WaniKani collection, following next_url to the end. */
async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = []
  let url: string | null = `${API_ROOT}${path}`
  while (url) {
    const response = await request(url, key)
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') || '2')
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
      continue
    }
    if (!response.ok) {
      throw new Error(`WaniKani API ${response.status} ${response.statusText}`)
    }

    const json = (await response.json()) as WkCollection<T>
    items.push(...json.data)
    url = json.pages.next_url
  }
  return items
}

/** Map a WaniKani SRS stage (0..9) onto the app's stage numbering (-1..8). */
function toSrsStage(wkStage: number): number {
  return wkStage === 0 ? -1 : wkStage - 1
}

/** Convert an ISO-8601 timestamp to epoch ms, or null. */
function toAvailableAt(iso: string | null): number | null {
  return iso ? Date.parse(iso) : null
}

async function main(): Promise<void> {
  const key = apiKey()

  console.log('Fetching WaniKani subjects…')
  const subjects = await fetchAll<WkSubject>('/subjects?per_page=1000', key)
  const charactersBySubject = new Map<number, string>()
  for (const subject of subjects) {
    charactersBySubject.set(subject.id, (subject.data.characters ?? '').trim())
  }
  console.log(`Fetched ${subjects.length} subjects`)

  console.log('Fetching WaniKani assignments…')
  const assignments = await fetchAll<WkAssignment>('/assignments?per_page=500', key)
  console.log(`Fetched ${assignments.length} assignments`)

  // Aggregate each assignment into per-card progress, keyed by dataset+characters.
  const progress = new Map<string, AggregatedProgress>()
  let unresolved = 0

  for (const assignment of assignments) {
    const { subject_id, subject_type, srs_stage, available_at } = assignment.data
    const characters = charactersBySubject.get(subject_id)
    if (!characters) {
      unresolved++ // image-only subjects have no card to sync
      continue
    }

    const key = `${DATASET_BY_TYPE[subject_type]}\u0000${characters}`
    const stage = toSrsStage(srs_stage)
    const availableAt = toAvailableAt(available_at)

    const current = progress.get(key)
    if (!current) {
      progress.set(key, { stage, availableAt })
      continue
    }
    if (stage > current.stage) {
      current.stage = stage
      current.availableAt = availableAt
      continue
    }
    if (
      stage === current.stage &&
      availableAt !== null &&
      (current.availableAt === null || availableAt < current.availableAt)
    ) {
      current.availableAt = availableAt
    }
  }

  // Resolve each card's database id and write its progress.
  const db = dbc.open()
  const idByKey = new Map<string, number>()
  for (const dataset of SYNCED_DATASETS) {
    for (const item of dbc.practiceItems(db, dataset)) {
      idByKey.set(`${dataset}\u0000${item.characters}`, item.id)
    }
  }

  const update = db.prepare('UPDATE items SET srs_stage = ?, available_at = ? WHERE id = ?')
  let updated = 0
  let unmatched = 0

  const apply = db.transaction(() => {
    for (const [key, entry] of progress) {
      const id = idByKey.get(key)
      if (id === undefined) {
        unmatched++
        continue
      }
      update.run(entry.stage, entry.availableAt, id)
      updated++
    }
  })
  apply()
  db.close()

  console.log(`Synced ${updated} items (${unresolved} unresolved, ${unmatched} unmatched).`)
}

main().catch(error => {
  console.error('Sync failed:', error)
  process.exit(1)
})

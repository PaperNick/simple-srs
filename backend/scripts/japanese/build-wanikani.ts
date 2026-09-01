import fs from 'node:fs'
import path from 'node:path'
import type { DatasetConfig, DatasetItem } from '@shared/types'
import { toRomaji } from '../../src/syllabaries/japanese/romaji'

/*
 * Build WaniKani datasets from the WaniKani API (v2).
 *
 * Downloads every radical, kanji and vocabulary subject and writes one dataset
 * per subject type, each card carrying its level and its meanings/readings.
 * Subjects that share the same characters (e.g. homograph vocabulary) are
 * mashed into a single card with their meanings and readings combined.
 *
 * Usage (from backend/):
 *   WANIKANI_API_KEY=... npx tsx scripts/japanese/build-wanikani.ts
 *   npx tsx scripts/japanese/build-wanikani.ts <api-key>
 */

const API_ROOT = 'https://api.wanikani.com/v2'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const DATASETS_JSON = path.join(DATA_DIR, 'datasets.json')
const AUDIO_DIR = path.join(DATA_DIR, 'static', 'audio', 'japanese', 'wanikani', 'vocabulary')
const AUDIO_URL_PATH = '/static/audio/japanese/wanikani/vocabulary'

type SubjectType = 'radical' | 'kanji' | 'vocabulary'

interface WkMeaning {
  meaning: string
  primary: boolean
  accepted_answer: boolean
}

interface WkReading {
  reading: string
  primary: boolean
  accepted_answer: boolean
  type: string
}

interface WkPronunciationAudio {
  url: string
  content_type: string
}

interface WkSubjectData {
  level: number
  characters: string | null
  meanings: WkMeaning[]
  readings?: WkReading[]
  pronunciation_audios?: WkPronunciationAudio[]
}

interface WkSubject {
  id: number
  object: SubjectType
  data: WkSubjectData
}

interface WkCollection<T> {
  data: T[]
  pages: { next_url: string | null }
}

/** A pronunciation audio file to download for a vocabulary card. */
interface AudioDownload {
  url: string
  filename: string
}

/** One deck per WaniKani subject type. */
const DATASETS: Record<SubjectType, DatasetConfig> = {
  radical: {
    id: 'wanikani-radicals',
    name: 'WaniKani Radicals',
    file: 'japanese/wanikani-radicals.json',
    mode: 'srs',
    type: 'character',
    badge: 'SRS',
    description: 'WaniKani radicals. Spaced repetition with stages.',
  },
  kanji: {
    id: 'wanikani-kanji',
    name: 'WaniKani Kanji',
    file: 'japanese/wanikani-kanji.json',
    mode: 'srs',
    type: 'character',
    badge: 'SRS',
    description: 'WaniKani kanji. Spaced repetition with stages.',
  },
  vocabulary: {
    id: 'wanikani-vocabulary',
    name: 'WaniKani Vocabulary',
    file: 'japanese/wanikani-vocabulary.json',
    mode: 'srs',
    type: 'vocabulary',
    badge: 'SRS',
    description: 'WaniKani vocabulary. Spaced repetition with stages.',
  },
}

const SUBJECT_TYPES: readonly SubjectType[] = ['radical', 'kanji', 'vocabulary']

/** Read the API key from the environment or the first CLI argument. */
function apiKey(): string {
  const key = process.env.WANIKANI_API_KEY || process.argv[2]
  if (!key) {
    console.error('Missing WaniKani API key. Set WANIKANI_API_KEY or pass it as an argument:')
    console.error('  npx tsx scripts/japanese/build-wanikani.ts <api-key>')
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

/** Deduplicate a list of strings, dropping empty/whitespace-only entries. */
function dedupe(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

/** The accepted English meanings of a subject (falling back to all meanings). */
function meaningsOf(subject: WkSubject): string[] {
  const accepted = subject.data.meanings.filter(meaning => meaning.accepted_answer)
  const list = accepted.length ? accepted : subject.data.meanings
  return dedupe(list.map(meaning => meaning.meaning))
}

/** The accepted readings of a subject (falling back to all readings). */
function readingsOf(subject: WkSubject): string[] {
  const readings = subject.data.readings ?? []
  const accepted = readings.filter(reading => reading.accepted_answer)
  const list = accepted.length ? accepted : readings
  return dedupe(list.map(reading => reading.reading))
}

/** Add romanized alternatives so learners can type romaji instead of kana. */
function withRomaji(readings: string[]): string[] {
  const out = [...readings]
  for (const reading of readings) {
    const romaji = toRomaji(reading)
    if (!romaji || romaji === reading) {
      continue
    }
    out.push(romaji)
  }
  return dedupe(out)
}

/** The first pronunciation audio URL a subject exposes, or null. */
function pronunciationUrl(subject: WkSubject): string | null {
  return subject.data.pronunciation_audios?.[0]?.url ?? null
}

/**
 * Pick the vocabulary card's audio: the first pronunciation audio in the group.
 * Records the download and returns the local `/static/...` path, or null when
 * the deck isn't vocabulary or no subject has audio.
 */
function audioForGroup(
  group: WkSubject[],
  type: SubjectType,
  audio: AudioDownload[]
): string | null {
  if (type !== 'vocabulary') {
    return null
  }

  for (const subject of group) {
    const url = pronunciationUrl(subject)
    if (!url) {
      continue
    }
    const filename = `${subject.id}.mp3`
    audio.push({ url, filename })
    return `${AUDIO_URL_PATH}/${filename}`
  }

  return null
}

/**
 * Turn one subject type's subjects into cards, merging any that share the same
 * characters (their meanings and readings are combined). Image-only subjects
 * (no characters) are skipped. Vocabulary cards also collect their first
 * pronunciation audio for download.
 */
function buildCards(
  subjects: WkSubject[],
  type: SubjectType
): { cards: DatasetItem[]; skipped: number; audio: AudioDownload[] } {
  const byCharacters = new Map<string, WkSubject[]>()
  let skipped = 0
  for (const subject of subjects) {
    if (subject.object !== type) {
      continue
    }
    const characters = (subject.data.characters ?? '').trim()
    if (!characters) {
      skipped++ // image-only radicals have no usable characters
      continue
    }
    const group = byCharacters.get(characters) ?? []
    group.push(subject)
    byCharacters.set(characters, group)
  }

  const cards: DatasetItem[] = []
  const audio: AudioDownload[] = []
  for (const [characters, group] of byCharacters) {
    cards.push({
      type: type === 'vocabulary' ? 'vocabulary' : 'character',
      characters,
      meanings: dedupe(group.flatMap(meaningsOf)),
      readings: withRomaji(dedupe(group.flatMap(readingsOf))),
      level: Math.min(...group.map(subject => subject.data.level)),
      audio: audioForGroup(group, type, audio),
    })
  }
  return { cards, skipped, audio }
}

/** Download a remote file to disk, returning null on success or an error message. */
async function fetchToFile(url: string, dest: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return `HTTP ${response.status}`
    }
    fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
    return null
  } catch (error) {
    return (error as Error).message
  }
}

/** Download a batch of audio files into AUDIO_DIR (skipping any already cached). */
async function downloadAudio(
  entries: AudioDownload[]
): Promise<{ downloaded: number; skipped: number; cached: number }> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  let downloaded = 0
  let skipped = 0
  let cached = 0

  const CONCURRENCY = 20
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < entries.length) {
      const { url, filename } = entries[next++]
      const dest = path.join(AUDIO_DIR, filename)

      if (fs.existsSync(dest)) {
        cached++
        continue
      }

      const error = await fetchToFile(url, dest)
      if (error) {
        skipped++
        console.warn(`FAIL ${filename}: ${error}`)
        continue
      }
      downloaded++
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { downloaded, skipped, cached }
}

/** Read the dataset registry, returning [] when it is missing or unreadable. */
function readDatasets(): DatasetConfig[] {
  if (!fs.existsSync(DATASETS_JSON)) {
    return []
  }
  try {
    return JSON.parse(fs.readFileSync(DATASETS_JSON, 'utf8')) as DatasetConfig[]
  } catch {
    return []
  }
}

/** Add or refresh the given dataset entries in data/datasets.json (one write). */
function upsertDatasets(entries: DatasetConfig[]): void {
  const datasets = readDatasets()

  for (const entry of entries) {
    const index = datasets.findIndex(dataset => dataset.id === entry.id)
    if (index === -1) {
      datasets.push(entry)
    } else {
      datasets[index] = entry
    }
  }

  fs.writeFileSync(DATASETS_JSON, JSON.stringify(datasets, null, 2) + '\n')
}

async function main(): Promise<void> {
  const key = apiKey()
  fs.mkdirSync(path.join(DATA_DIR, 'japanese'), { recursive: true })

  console.log('Fetching WaniKani subjects…')
  const subjects = await fetchAll<WkSubject>(
    '/subjects?types=radical,kanji,vocabulary&per_page=1000',
    key
  )
  console.log(`Fetched ${subjects.length} subjects`)

  const allAudio: AudioDownload[] = []
  for (const type of SUBJECT_TYPES) {
    const { cards, skipped, audio } = buildCards(subjects, type)
    allAudio.push(...audio)
    const file = path.join(DATA_DIR, DATASETS[type].file)
    fs.writeFileSync(file, JSON.stringify(cards, null, 2) + '\n')
    console.log(
      `Wrote ${cards.length} ${type} cards to ${file}` +
        (skipped ? ` (${skipped} image-only skipped)` : '')
    )
  }
  upsertDatasets(SUBJECT_TYPES.map(type => DATASETS[type]))

  console.log(`\nDownloading ${allAudio.length} audio files…`)
  const summary = await downloadAudio(allAudio)
  console.log(
    `Audio: ${summary.downloaded} downloaded, ${summary.cached} cached, ${summary.skipped} failed`
  )

  console.log('\nDone. Restart the backend to seed the WaniKani decks.')
}

main().catch(error => {
  console.error('Build failed:', error)
  process.exit(1)
})

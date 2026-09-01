import fs from 'node:fs'
import path from 'node:path'
import type { DatasetConfig, DatasetItem } from '@shared/types'
import kanaJson from '../../src/syllabaries/japanese/kana.json'
import { hiraganaToKatakana, toRomaji } from '../../src/syllabaries/japanese/romaji'

/*
 * Build the Hiragana and Katakana datasets and download their audio.
 *
 * Both syllabaries share one set of audio files (the pronunciation is the same),
 * downloaded into data/static/audio/japanese/kana/. Cards carry their kana as
 * the prompt, the Hepburn romaji as the accepted reading, and a level so
 * practice can progress from the gojuuon through dakuten, handakuten and youon.
 */

const AUDIO_BASE = 'https://www.learn-japanese-adventure.com/media-files/'

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'data')
const DATASETS_JSON = path.join(DATA_DIR, 'datasets.json')
const JAPANESE_DATA_DIR = path.join(DATA_DIR, 'japanese')
const AUDIO_DIR = path.join(DATA_DIR, 'static', 'audio', 'japanese', 'kana')
const AUDIO_URL_PATH = '/static/audio/japanese/kana'

const HIRAGANA: Record<string, string> = kanaJson.HIRAGANA
const DIGRAPHS: Record<string, string> = kanaJson.DIGRAPHS

interface KanaEntry {
  kana: string
  level: number
}

/** Small kana and obsolete ゔ are not part of the practice decks. */
const EXCLUDED_KANA = new Set(['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ゔ'])

/**
 * The practice level for a kana, derived from its romaji: handakuten (p-*) are
 * level 3, dakuten (g/z/d/b/j-*) are level 2, everything else is the gojuuon.
 */
function levelFor(romaji: string): number {
  if (romaji.startsWith('p')) {
    return 3
  }
  if ('gzdjb'.includes(romaji[0])) {
    return 2
  }
  return 1
}

/** Sort entries by level, then by kana code point, for a predictable order. */
function compareEntries(a: KanaEntry, b: KanaEntry): number {
  if (a.level !== b.level) {
    return a.level - b.level
  }
  return a.kana < b.kana ? -1 : a.kana > b.kana ? 1 : 0
}

const HIRAGANA_DATASET: DatasetConfig = {
  id: 'hiragana',
  name: 'Hiragana',
  file: 'japanese/hiragana.json',
  mode: 'practice',
  type: 'character',
  badge: 'Practice',
  description: 'Practice recognizing Hiragana endlessly! Grind for as long as you like.',
}

const KATAKANA_DATASET: DatasetConfig = {
  id: 'katakana',
  name: 'Katakana',
  file: 'japanese/katakana.json',
  mode: 'practice',
  type: 'character',
  badge: 'Practice',
  description: 'Practice recognizing Katakana endlessly! Grind for as long as you like.',
}

/** Flatten the shared kana maps into entries, each with its level. */
function entries(): KanaEntry[] {
  const single = Object.keys(HIRAGANA)
    .filter(kana => !EXCLUDED_KANA.has(kana))
    .map(kana => ({ kana, level: levelFor(toRomaji(kana)) }))
    .sort(compareEntries)

  const digraphs = Object.keys(DIGRAPHS)
    .map(kana => ({ kana, level: 4 }))
    .sort(compareEntries)

  return [...single, ...digraphs]
}

/** The accepted romaji readings for a kana (を is also commonly typed "wo"). */
function readingsFor(kana: string): string[] {
  if (kana === 'を') {
    return ['o', 'wo']
  }
  return [toRomaji(kana)]
}

/** The romaji key used for the audio file (を is stored under "wo"). */
function audioKey(kana: string): string {
  return kana === 'を' ? 'wo' : toRomaji(kana)
}

/** Build the cards for one syllabary, mapping each kana to its glyph. */
function buildCards(glyph: (kana: string) => string): DatasetItem[] {
  return entries().map(({ kana, level }) => ({
    type: 'character',
    characters: glyph(kana),
    readings: readingsFor(kana),
    level,
    audio: `${AUDIO_URL_PATH}/${audioKey(kana)}.mp3`,
  }))
}

/** The unique audio files to download (both syllabaries share them). */
function audioDownloads(): Array<{ url: string; filename: string }> {
  const seen = new Set<string>()
  const list: Array<{ url: string; filename: string }> = []

  for (const { kana } of entries()) {
    const key = audioKey(kana)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    list.push({ url: `${AUDIO_BASE}kanasound-${key}.mp3`, filename: `${key}.mp3` })
  }

  return list
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

/** Download audio files into AUDIO_DIR (skipping any already cached). */
async function downloadAudio(
  entries: Array<{ url: string; filename: string }>
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
  fs.mkdirSync(JAPANESE_DATA_DIR, { recursive: true })

  const hiragana = buildCards(kana => kana)
  fs.writeFileSync(
    path.join(DATA_DIR, HIRAGANA_DATASET.file),
    JSON.stringify(hiragana, null, 2) + '\n'
  )
  console.log(`Wrote ${hiragana.length} cards to ${HIRAGANA_DATASET.file}`)

  const katakana = buildCards(hiraganaToKatakana)
  fs.writeFileSync(
    path.join(DATA_DIR, KATAKANA_DATASET.file),
    JSON.stringify(katakana, null, 2) + '\n'
  )
  console.log(`Wrote ${katakana.length} cards to ${KATAKANA_DATASET.file}`)

  upsertDatasets([HIRAGANA_DATASET, KATAKANA_DATASET])

  const audio = audioDownloads()
  console.log(`\nDownloading ${audio.length} audio files...`)
  const summary = await downloadAudio(audio)
  console.log(
    `Audio: ${summary.downloaded} downloaded, ${summary.cached} cached, ${summary.skipped} failed`
  )

  console.log('\nDone. Restart the backend to seed the kana decks.')
}

main().catch(error => {
  console.error('Build failed:', error)
  process.exit(1)
})

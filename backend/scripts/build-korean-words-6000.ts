import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import * as dbc from '../src/db'
import type { DatasetConfig, DatasetItem } from '@shared/types'

interface TopikEntry {
  meaning: string
  readings: string[]
  level: number
}

/*
 * Build a Korean words dataset by merging the TOPIK 6000 CSV (meaning +
 * readings) with audio from an Anki deck file. Words present in the deck get
 * their audio mapped from it; CSV-only words are kept with audio = null. The
 * result is written to korean-words-6000.json + audio + DB vocabulary.
 *
 * Deck: https://ankiweb.net/shared/info/408875623  (provides No | Word | Audio)
 * CSV:  TOPIK 6000 frequency list (word -> romanized + English + level)
 */

const ROOT = path.join(import.meta.dirname, '..', '..')
const DATA_DIR = path.join(ROOT, 'backend', 'data')
const DATASET_ID = 'korean-words-6000'
const WORDS_JSON = path.join(DATA_DIR, `${DATASET_ID}.json`)
const AUDIO_DIR = path.join(DATA_DIR, 'static', 'audio', 'korean', DATASET_ID)
const DATASETS_JSON = path.join(DATA_DIR, 'datasets.json')

// TOPIK 6000 frequency list CSV (word -> romanization + English + level),
// used to enrich the deck's words with meaning and readings.
const CSV_URL =
  'https://raw.githubusercontent.com/johnahnz0rs/frequency-lists/main/src/assets/Korean%20TOPIK%206000%20-%20vocabulary%20list%20final%20release%20v1%20-%20list.csv'
const TOPIK_CSV = path.join(DATA_DIR, 'topik-6000.csv')

// Registry entry for this dataset in data/datasets.json.
const WORDS_DATASET: DatasetConfig = {
  id: DATASET_ID,
  name: 'Korean Words',
  file: `${DATASET_ID}.json`,
  mode: 'srs',
  type: 'vocabulary',
  badge: 'SRS',
  description: 'Learn the most common Korean words. Spaced repetition with stages.',
}

/** Split a CSV line into its fields, honouring double-quoted cells. */
function parseLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (insideQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index++
        } else {
          insideQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      insideQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current)
  return fields
}

/** Parse the TOPIK CSV into a map of word -> { meaning, readings, level }. */
function parseTopik(csvPath: string): Map<string, TopikEntry> {
  const byWord = new Map<string, TopikEntry>()
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/)

  for (let index = 1; index < lines.length; index++) {
    const field = parseLine(lines[index])
    const rank = Number(field[1])
    const word = (field[3] || '').trim()
    const roman = (field[4] || '').trim()
    const english = (field[8] || '').trim()

    if (!rank || !word || !roman || !english) {
      continue
    }

    const existing = byWord.get(word)
    if (existing) {
      if (english && existing.meaning.indexOf(english) === -1) {
        existing.meaning += ' / ' + english
      }
    } else {
      byWord.set(word, {
        meaning: english,
        readings: [roman],
        level: Math.ceil(rank / 500),
      })
    }
  }

  return byWord
}

/** Download the TOPIK CSV (unless already cached) and return its path. */
async function ensureTopikCsv(): Promise<string> {
  if (fs.existsSync(TOPIK_CSV)) {
    return TOPIK_CSV
  }
  console.log('Downloading TOPIK CSV…')
  const response = await fetch(CSV_URL)
  if (!response.ok) {
    throw new Error(`CSV download failed: HTTP ${response.status}`)
  }
  fs.writeFileSync(TOPIK_CSV, Buffer.from(await response.arrayBuffer()))
  console.log(`Saved ${TOPIK_CSV}`)
  return TOPIK_CSV
}

/** Strip pronunciation annotations and semantic suffixes from a word. */
function cleanWord(word: string): string {
  return String(word)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[-–-].*$/, '')
    .trim()
}

/** Resolve the deck path from the required CLI argument. */
function resolveDeckPath(): string {
  const apkgPath = process.argv[2]
  if (apkgPath && fs.existsSync(apkgPath)) {
    return apkgPath
  }
  console.error('Missing Anki deck file.')
  console.error(
    'Download the deck from https://ankiweb.net/shared/info/408875623 and pass its path as an argument, e.g.'
  )
  console.error('  npx tsx scripts/build-korean-words-6000.ts path/to/deck.apkg')
  process.exit(1)
}

/** Create (or update) data/datasets.json for the given dataset entry. */
function upsertDataset(entry: DatasetConfig): void {
  let datasets: DatasetConfig[] = []
  if (fs.existsSync(DATASETS_JSON)) {
    try {
      datasets = JSON.parse(fs.readFileSync(DATASETS_JSON, 'utf8')) as DatasetConfig[]
    } catch (_) {
      datasets = []
    }
  }

  const index = datasets.findIndex(dataset => dataset.id === entry.id)
  if (index === -1) {
    datasets.push(entry)
  } else {
    datasets[index] = entry
  }

  fs.writeFileSync(DATASETS_JSON, JSON.stringify(datasets, null, 2) + '\n')
}

/** Unpack an Anki deck, emit audio + dataset JSON, register it, replace DB vocab. */
async function buildFromDeck(apkgPath: string): Promise<void> {
  if (!fs.existsSync(apkgPath)) {
    throw new Error(`APKG not found: ${apkgPath}`)
  }

  console.log('Opening APKG:', apkgPath)
  const zip = new AdmZip(apkgPath)

  // Media manifest: zipEntryName -> originalFilename
  const mediaEntry = zip.getEntry('media')!
  const manifest = JSON.parse(mediaEntry.getData().toString('utf8')) as Record<string, string>
  const nameToEntry: Record<string, string> = {}
  for (const [entryName, realName] of Object.entries(manifest)) {
    nameToEntry[realName] = entryName
  }

  // Read the Anki notes
  const ankiEntry = zip.getEntry('collection.anki2')!
  const ankiPath = path.join(os.tmpdir(), 'collection-import.anki2')
  fs.writeFileSync(ankiPath, ankiEntry.getData())

  const db = new Database(ankiPath, { readonly: true })
  const notes = (db.prepare('SELECT flds FROM notes').all() as Array<{ flds: string }>).map(row =>
    row.flds.split('\x1f')
  )
  db.close()
  fs.rmSync(ankiPath, { force: true })

  console.log(`Found ${notes.length} notes`)

  // Collect the deck's word -> audio-file mapping (audio only for words present in the deck).
  const deckAudioByWord = new Map<string, string>()
  for (const fields of notes) {
    const word = cleanWord(fields[1] || '')
    const sound = (fields[2] || '').match(/\[sound:(.+?)\]/)
    const audioFile = sound ? sound[1] : null
    if (word && audioFile && nameToEntry[audioFile]) {
      deckAudioByWord.set(word, audioFile)
    }
  }

  // Build the dataset from the TOPIK CSV (meaning + readings), attaching audio
  // from the deck where the word is present; CSV-only words keep audio = null.
  const topikCsv = await ensureTopikCsv()
  const byWord = parseTopik(topikCsv)

  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const cards: DatasetItem[] = []
  let audioWritten = 0
  let withAudio = 0

  for (const [word, known] of byWord) {
    const audioFile = deckAudioByWord.get(word)
    let audio: string | null = null
    if (audioFile) {
      const entry = zip.getEntry(nameToEntry[audioFile])
      if (entry) {
        fs.writeFileSync(path.join(AUDIO_DIR, audioFile), entry.getData())
        audioWritten++
      }
      audio = `/static/audio/korean/${DATASET_ID}/${audioFile}`
      withAudio++
    }

    cards.push({
      type: 'vocabulary',
      characters: word,
      meaning: known.meaning,
      readings: known.readings,
      level: known.level,
      audio,
    })
  }

  fs.writeFileSync(WORDS_JSON, JSON.stringify(cards, null, 2) + '\n')
  upsertDataset(WORDS_DATASET)

  console.log(`Extracted ${audioWritten} audio files to ${AUDIO_DIR}`)
  console.log(`Wrote ${cards.length} words (${withAudio} with audio) to ${WORDS_JSON}`)
  console.log(`Registered '${WORDS_DATASET.id}' in ${DATASETS_JSON}`)

  // Write into the SQLite DB
  const dataDb = dbc.open()
  const count = dbc.replaceVocab(dataDb, cards, DATASET_ID)
  dataDb.close()
  console.log(`Replaced ${count} vocabulary items in the DB.`)

  console.log('\nDone. Restart the backend to serve the new words.')
}

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  await buildFromDeck(resolveDeckPath())
}

main().catch(error => {
  console.error('Build failed:', error)
  process.exit(1)
})

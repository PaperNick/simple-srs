import fs from 'node:fs'
import path from 'node:path'
import type { DatasetConfig, DatasetItem } from '@shared/types'

/*
 * Build the complete hangul dataset (data/hangul.json) and download its audio.
 *
 * The character data (characters, readings, level) and the audio source URLs are
 * all defined inline below, so the script is self-contained and works offline:
 * hangul.json is always written, and any audio that can't be fetched is simply
 * skipped with a warning.
 */

const DATA_DIR = path.join(import.meta.dirname, '..', 'data')
const DATASET_ID = 'hangul'
const OUT = path.join(DATA_DIR, `${DATASET_ID}.json`)
const AUDIO_DIR = path.join(DATA_DIR, 'static', 'audio', 'korean', DATASET_ID)
const DATASETS_JSON = path.join(DATA_DIR, 'datasets.json')

const S3 = 'https://90daykoreanaudiobytes.s3-us-west-1.amazonaws.com/'

// Registry entry for this dataset in data/datasets.json.
const HANGUL_DATASET: DatasetConfig = {
  id: DATASET_ID,
  name: 'Hangul Alphabet',
  file: `${DATASET_ID}.json`,
  mode: 'practice',
  type: 'character',
  badge: 'Practice',
  description: 'Practice recognizing Hangul endlessly! Grind for as long as you like.',
}

// [characters, readings, level, audioUrl]
const CARDS: Array<[string, string[], number, string]> = [
  ['ㄱ', ['g', 'k'], 1, S3 + 'audio-giyeok.mp3'],
  ['ㄴ', ['n'], 1, S3 + 'audio-nieun-new.mp3'],
  ['ㄷ', ['d', 't'], 1, S3 + 'audio-digeut.mp3'],
  ['ㄹ', ['r', 'l'], 1, S3 + 'audio-rieul.mp3'],
  ['ㅁ', ['m'], 1, S3 + 'audio-mieum.mp3'],
  ['ㅂ', ['b', 'p'], 1, S3 + 'audio-bieup.mp3'],
  ['ㅅ', ['s', 't'], 1, S3 + 'audio-siot.mp3'],
  ['ㅇ', ['ng', 'silent', 'no sound'], 1, S3 + 'audio-ieung.mp3'],
  ['ㅈ', ['j', 't'], 1, 'https://members.90daykorean.com/wp-content/uploads/2017/01/%E3%85%88.mp3'],
  ['ㅊ', ['ch', 't'], 1, S3 + 'audio-chieut.mp3'],
  ['ㅋ', ['k'], 1, S3 + 'audio-kieuk.mp3'],
  ['ㅌ', ['t'], 1, S3 + 'audio-tieut-new.mp3'],
  ['ㅍ', ['p'], 1, S3 + 'audio-pieup-new.mp3'],
  ['ㅎ', ['h'], 1, S3 + 'audio-hieut.mp3'],
  ['ㅏ', ['a'], 2, S3 + 'audio-a.mp3'],
  ['ㅑ', ['ya'], 2, S3 + 'audio-ya.mp3'],
  ['ㅓ', ['eo'], 2, S3 + 'audio-eo.mp3'],
  ['ㅕ', ['yeo'], 2, S3 + 'audio-yeo.mp3'],
  ['ㅗ', ['o'], 2, S3 + 'audio-o.mp3'],
  ['ㅛ', ['yo'], 2, S3 + 'audio-yo.mp3'],
  ['ㅜ', ['u'], 2, S3 + 'audio-u.mp3'],
  ['ㅠ', ['yu'], 2, S3 + 'audio-yu.mp3'],
  ['ㅡ', ['eu'], 2, S3 + 'audio-eu.mp3'],
  ['ㅣ', ['i'], 2, S3 + 'audio-i.mp3'],
  ['ㄲ', ['kk'], 3, S3 + 'audio-giyeok.mp3'],
  ['ㄸ', ['tt'], 3, S3 + 'audio-ssangdigeut.mp3'],
  ['ㅃ', ['pp'], 3, S3 + 'audio-ssangbieup.mp3'],
  ['ㅆ', ['ss', 't'], 3, S3 + 'audio-ssangsiot.mp3'],
  ['ㅉ', ['jj'], 3, S3 + 'audio-ssangjieut.mp3'],
  ['ㅐ', ['ae'], 4, S3 + 'audio-ae.mp3'],
  ['ㅒ', ['yae'], 4, S3 + 'audio-yae.mp3'],
  ['ㅔ', ['e'], 4, S3 + 'audio-e.mp3'],
  ['ㅖ', ['ye'], 4, S3 + 'audio-ye.mp3'],
  ['ㅘ', ['wa'], 4, S3 + 'audio-wa.mp3'],
  ['ㅙ', ['wae'], 4, S3 + 'audio-wae.mp3'],
  ['ㅚ', ['oe'], 4, S3 + 'audio-oe.mp3'],
  ['ㅝ', ['wo'], 4, S3 + 'audio-wo.mp3'],
  ['ㅞ', ['we'], 4, S3 + 'audio-we.mp3'],
  ['ㅟ', ['wi'], 4, S3 + 'audio-wi.mp3'],
  ['ㅢ', ['ui'], 4, S3 + 'audio-ui.mp3'],
]

/** Stable, unique, ASCII-safe filename per character (e.g. ㄱ -> 3131.mp3). */
function filenameFor(char: string): string {
  return char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0') + '.mp3'
}

/** Build the hangul.json card entries from the inline CARDS data. */
function buildCards(): DatasetItem[] {
  return CARDS.map(([characters, readings, level]): DatasetItem => ({
    type: 'character',
    characters,
    readings,
    level,
    audio: `/static/audio/korean/${DATASET_ID}/${filenameFor(characters)}`,
  }))
}

/** Fetch a remote file and write it to disk. */
async function download(url: string, dest: string): Promise<number> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(dest, buffer)
  return buffer.length
}

/** Download every card's audio, reporting any that fail (never fatal). */
async function downloadAudio(): Promise<{ downloaded: number; skipped: number; bytes: number }> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  let downloaded = 0
  let skipped = 0
  let bytes = 0

  for (const [characters, , , url] of CARDS) {
    const file = filenameFor(characters)
    try {
      const size = await download(url, path.join(AUDIO_DIR, file))
      downloaded++
      bytes += size
      console.log(`ok ${file}  (${size} bytes)  <- ${characters}`)
    } catch (error) {
      skipped++
      console.warn(`FAIL ${characters} ${file}: ${(error as Error).message}`)
    }
  }

  return { downloaded, skipped, bytes }
}

/**
 * Create (or update) data/datasets.json, adding or refreshing the given dataset
 * entry while preserving any other configured datasets.
 */
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

/** Write the dataset, register it, then fetch the audio for each character. */
async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const cards = buildCards()
  fs.writeFileSync(OUT, JSON.stringify(cards, null, 2) + '\n')
  console.log(`Wrote ${cards.length} characters to ${OUT}`)

  upsertDataset(HANGUL_DATASET)
  console.log(`Registered '${HANGUL_DATASET.id}' in ${DATASETS_JSON}`)

  const summary = await downloadAudio()
  console.log(
    `\nDownloaded ${summary.downloaded} audio files (${(summary.bytes / 1024).toFixed(0)} KiB)` +
      (summary.skipped ? ` - ${summary.skipped} skipped` : '')
  )
  console.log(`Stored in ${AUDIO_DIR}`)
}

main().catch(error => {
  console.error('Build failed:', error)
  process.exit(1)
})

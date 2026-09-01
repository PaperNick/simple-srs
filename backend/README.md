# Simple SRS - Backend

Express + SQLite API that powers Simple SRS. It exposes the REST endpoints and runs the spaced-repetition (SRS) scheduling for vocabulary, plus the no-SRS alphabet practice grader.

## Stack

- **Express 5** - HTTP server + static serving of the built frontend
- **better-sqlite3** - local SQLite database
- **Node.js** (sqlite driver requires a Node with prebuilt binaries)

## Setup

```bash
npm ci
```

This creates the local database on first run at `data/simple_srs.sqlite` and seeds every dataset declared in `data/datasets.json`.

## Run

### Production

The backend serves the React UI from `../frontend/dist`. Build it first:

```bash
cd ../frontend && npm ci && npm run build
cd ../backend
npm start
```

Then open http://localhost:3000

### Development

```bash
npm run dev
```

This auto-reloads (`tsx watch`). The API is served on http://localhost:3000

### Port & env

- Port defaults to `3000` - override with `BACKEND_PORT`.
- DB path defaults to `data/simple_srs.sqlite` - override with `SIMPLE_SRS_DB`.

```bash
BACKEND_PORT=8080 SIMPLE_SRS_DB=/tmp/srs.sqlite npm start
```

## Data

Datasets are declared in [`data/datasets.json`](data/datasets.json). Each entry is one JSON **file** that becomes its own deck in the UI.

It carries the metadata the frontend renders, so the client never hardcodes anything about a particular dataset:

```json
[
  {
    "id": "hangul",
    "name": "Hangul Alphabet",
    "file": "korean/hangul.json",
    "mode": "practice",
    "type": "character",
    "badge": "Practice",
    "description": "Practice recognizing Hangul endlessly! Grind for as long as you like."
  },
  {
    "id": "korean-words-6000",
    "name": "Korean Words",
    "file": "korean/korean-words-6000.json",
    "mode": "srs",
    "type": "vocabulary",
    "badge": "SRS",
    "description": "Learn the most common Korean words. Spaced repetition with stages."
  }
]
```

- `mode: "practice"` - endless grind, no SRS. Shows the practice UI only.
- `mode: "srs"` - lessons + stage-based reviews (e.g. words). Automatically populates the lesson/review buttons and the SRS stats/stage breakdown.
- `badge` / `description` - the deck's label and subtitle. The total count is always shown with the unit `items`.

All dataset files share **one unified item schema**:
```
{ type, characters, meanings[], readings[], level, audio }
```

The `audio` path points at the local MP3 under `data/static/`.

The Korean words dataset is built from the Anki shared deck **[Korean 1000 most common words (audio)](https://ankiweb.net/shared/info/408875623)** (for audio).
Word meanings/romanizations are enriched from the **TOPIK 6000 word frequency list** CSV , sourced from the [`johnahnz0rs/frequency-lists`](https://github.com/johnahnz0rs/frequency-lists) dataset.

Seeding: on start, each dataset file that isn't already in the DB is imported (one row per entry), tagged with its `dataset` id.
Add a new dataset by adding a JSON file + an entry in `datasets.json` - it appears as its own deck.

You can also add a single word at runtime (the `dataset` field is required):

```bash
curl -X POST localhost:3000/api/vocab \
  -H 'Content-Type: application/json' \
  -d '{"characters":"가","meanings":["to go"],"readings":["ga"],"dataset":"korean-words-6000"}'
```

## API

| Method | Route                  | Description                                        |
| ------ | ---------------------- | -------------------------------------------------- |
| GET    | `/api/stats`           | Per-dataset statistics                             |
| GET    | `/api/datasets`        | Dataset decks (name, mode, counts)                 |
| GET    | `/api/practice/items`  | Items for a dataset (`?dataset=` required)         |
| POST   | `/api/practice/answer` | Grade a practice answer (no SRS state)             |
| GET    | `/api/lesson/start`   | New (unlearned) words for a lesson (`?dataset=`)   |
| POST   | `/api/lesson/complete`| Mark lesson words as learned                       |
| GET    | `/api/review/start`   | Due words for review (SRS, `?dataset=`)            |
| POST   | `/api/review/answer`  | Grade a review answer + advance the SRS stage      |
| POST   | `/api/vocab`          | Add a single vocabulary item (body needs `dataset`)|

## How the SRS works

Words progress through stages - `Apprentice I..IV - Guru I/II - Master - Enlightened - Burned`.

A correct answer advances one stage and schedules the next review; a wrong answer drops the word back to `Apprentice I`. Practice items are excluded from SRS stages.

## Korean datasets

### Hangul alphabet

The Hangul alphabet dataset (`data/korean/hangul.json`) is fully self-contained: the characters, readings, levels, and audio source URLs are defined inline in `scripts/korean/build-hangul.ts`.

```bash
# With the backend stopped
npx tsx scripts/korean/build-hangul.ts
```

It writes `data/korean/hangul.json`, registers the `hangul` dataset in `data/datasets.json`, and downloads each character's audio into `data/static/audio/korean/hangul/`. Audio that can't be fetched is skipped with a warning - the dataset is still written and usable.

### Korean words (TOPIK 6000)

The Korean words dataset is built from an Anki deck file (for audio). Download the **Korean 1000 most common words (audio)** deck from https://ankiweb.net/shared/info/408875623, then run `build-korean-words-6000.ts` with its path:

```bash
# With the backend stopped
npx tsx scripts/korean/build-korean-words-6000.ts path/to/deck.apkg
```

The script downloads (and caches) the TOPIK 6000 CSV, reads the Anki notes (word + `[sound:...mp3]`), enriches each word with meanings + romanization from the CSV by matching the word (`audio = null` for words not in the deck), extracts the audio into `data/static/audio/korean/korean-words-6000/`, and **replaces** the vocabulary in the database (clearing prior word SRS progress).

Each raw sense string is split into discrete `meanings[]` entries at build time by `src/meanings.ts` (on numbered senses, `;`, `/`, `,`, and `or`/`and` alternatives), so a word like *절* is stored as `["A Buddhist temple", "bow", "greeting", "paragraph", "passage", "clause", "verse"]` rather than one combined string.

The audio path is stored in each item's `audio` column and returned by the API, so word cards can play it.

## Japanese datasets

### Hiragana & Katakana

`scripts/japanese/build-kana.ts` builds both syllabaries from the shared kana -> romaji map in `src/syllabaries/japanese/kana.json` and downloads their audio:

```bash
# With the backend stopped
npx tsx scripts/japanese/build-kana.ts
```

It writes `data/japanese/hiragana.json` and `data/japanese/katakana.json`, registers both decks, and downloads the shared audio into `data/static/audio/japanese/kana/`.

## Testing

Tests live in [`tests/`](tests) and use Node's built-in test runner (run through `tsx`).
They cover the Levenshtein similarity, answer grading (reading, meaning, and self-grading), and the SRS scheduling transitions.

```bash
npm test
```

## Grading

A typed answer is graded as **correct if it is at least 80% similar** (by Levenshtein edit distance) to an accepted answer - exact and case-insensitive matches always pass.

Meaning answers compare the typed answer against each stored `meanings[]` entry as a full-string match, dropping common stopwords (`a`/`the`/`in`/`to`/etc.) and ignoring punctuation/case - so `middle` matches *In the middle* - while rejecting bare stopwords.

Cards with no `readings` and no `meanings` are **self-graded**: the review answer endpoint takes a `recalled` flag (true = "Got it", false = "Missed it") instead of a typed input, and the user's accept/reject decision drives the SRS stage change.

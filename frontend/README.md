# Simple SRS - Frontend

React + Vite single-page app that renders the Simple SRS UI: an endless practice mode (any dataset, e.g. the Hangul alphabet) and a spaced-repetition flow for Korean words.

## Stack

- **React 18** - UI
- **Vite 6** - dev server + production bundling

## Setup

```bash
npm install
```

> The frontend is a client of the backend API, which runs on port **3000**.
> Start the backend first (see [../backend/README.md](../backend/README.md)).

## Run (development)

```bash
npm start      # same as: npm run dev
# or
npm run dev
```

Vite serves the app at http://localhost:5173 and proxies `/api/*` requests to `http://localhost:3000`, so you can use it alongside the API dev server.

## Build (production)

```bash
npm run build
```

Outputs a static bundle to `dist/`.
The backend serves this folder directly at http://localhost:3000, so in production you only need to run the backend.

```bash
npm run preview   # optional: preview the production build locally on :4173
```

## Modes

- **Practice** - endless, shuffled grinding of a dataset's items (e.g. the 40 Hangul jamo). No SRS; answer by typing the romanization. Runs until you press **Stop**. Shows a running tally (answered / correct / wrong / streak).
- **Lesson / Review (Words SRS)** - teaches new words, then reviews them on a stage-based spaced-repetition schedule. Words must be added first (check the backend scripts that build datasets).

Cards with no `readings` and no `meanings` are **self-graded**: instead of an input field, the card shows **Missed it** / **Got it** buttons so you decide whether you recalled it.

## Configuration

Dev server port defaults to `5173` and proxies `/api` to `http://localhost:3000` (see `vite.config.js`).
Adjust the proxy target there for a different backend port.

## Keyboard shortcuts

Keyboard shortcuts are centralized in `src/shortcuts.ts` and can be rebound with Vite env vars (only `VITE_`-prefixed vars are exposed to the client).
Put them in `frontend/.env`, `frontend/.env.local`, or pass them on the command line when starting Vite.

| Shortcut            | Default | Env override          |
| ------------------- | ------- | --------------------- |
| Play audio          | `p`     | `VITE_KEY_PLAY_AUDIO` |
| Expand details      | `e`     | `VITE_KEY_EXPAND_DETAILS` |
| Missed it           | `1`     | `VITE_KEY_MISSED_IT`  |
| Got it              | `2`     | `VITE_KEY_GOT_IT`     |
| Submit / Reveal / Next | `Enter` | - (not configurable)  |

Example - bind "play audio" to the space bar and "expand details" to `x`:

```ini
# frontend/.env.local
VITE_KEY_PLAY_AUDIO=space
VITE_KEY_EXPAND_DETAILS=x
```

> Keys are matched case-insensitively against `KeyboardEvent.key`, so `p`, `P`, `' '` (space), `Spacebar`, etc. all work.
> See `.env.example` for the available overrides.

The on-screen shortcut hints automatically reflect the configured keys.

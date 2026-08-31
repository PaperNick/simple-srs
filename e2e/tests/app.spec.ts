import { test, expect } from '@playwright/test'
import type { Page, Response } from '@playwright/test'

/**
 * The app mutates its SQLite DB as tests run, and the flows build on each other
 * (a lesson must run before a review has anything to review). Run serially.
 */
test.describe.configure({ mode: 'serial' })

/** Fetch a JSON endpoint and assert the request succeeded. */
async function getJson<T>(page: Page, endpoint: string): Promise<T> {
  const response = await page.request.get(endpoint)
  expect(response.ok(), `GET ${endpoint} failed`).toBeTruthy()
  return (await response.json()) as T
}

/** Walk a lesson to completion: reveal each card, then continue until it finishes. */
async function completeLesson(page: Page): Promise<void> {
  const reveal = page.getByRole('button', { name: 'Reveal' })
  await expect(reveal).toBeVisible()
  for (let iteration = 0; iteration < 40; iteration++) {
    if ((await page.getByRole('button', { name: 'Reveal' }).count()) === 0) {
      break
    }
    await page.getByRole('button', { name: 'Reveal' }).click()
    const next = page.getByRole('button', { name: /Continue|Finish Lesson/ })
    await expect(next).toBeVisible()
    const label = (await next.textContent()) || ''
    await next.click()
    await page.waitForTimeout(150)
    if (/Finish Lesson/.test(label)) {
      break
    }
  }
}

const HANGUL_AUDIO = /\/static\/audio\/korean\/hangul\/.+\.mp3$/
const WORD_AUDIO = /\/static\/audio\/korean\/word\/.+\.mp3$/
const AUTOPLAY_REVIEW = 'simplesrs-autoplay-review'
const AUTOPLAY_LESSON = 'simplesrs-autoplay-lesson'

/** Set an autoplay preference in localStorage before the app boots (default is off). */
async function enableAutoplay(page: Page, storageKey: string): Promise<void> {
  await page.addInitScript((key: string) => {
    ;(globalThis as { localStorage: Storage }).localStorage.setItem(key, 'on')
  }, storageKey)
}

/** Wait for an audio request matching `regex` to fire and return the response. */
function waitForAudio(page: Page, regex: RegExp) {
  return page.waitForResponse(res => regex.test(res.url()))
}

/** Count audio requests matching `regex` as they fire. */
function trackAudio(page: Page, regex: RegExp) {
  let count = 0
  const listener = (res: Response) => {
    if (regex.test(res.url())) {
      count++
    }
  }
  page.on('response', listener)
  return {
    count: () => count,
    stop: () => page.off('response', listener),
  }
}

/** Map each hangul character to its accepted readings. */
async function getHangulReadingsByChar(page: Page): Promise<Record<string, string[]>> {
  const { items } = await getJson<{ items: Array<{ characters: string; readings: string[] }> }>(
    page,
    '/api/practice/items?dataset=hangul'
  )
  return Object.fromEntries(items.map(i => [i.characters, i.readings]))
}

test('dashboard lists each dataset as its own card', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')

  // Practice card - metadata comes from data/datasets.json, not the UI
  await expect(page.getByText('Hangul Alphabet')).toBeVisible()
  await expect(page.getByRole('button', { name: /Practice/ }).first()).toBeVisible()

  // Words (SRS) card - seeded words exist
  await expect(page.getByRole('heading', { name: 'Korean Words' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Start Lesson/ })).toBeVisible()

  // Dataset stats from the API line up with the UI
  const alpha = await getJson<{ items: { length: number } }>(
    page,
    '/api/practice/items?dataset=hangul'
  )
  expect(alpha.items.length).toBe(3)
  const { datasets } = await getJson<{
    datasets: Array<{ id: string; total: number; mode: string }>
  }>(page, '/api/datasets')
  expect(datasets.length).toBe(3)
  const words = datasets.find(d => d.id === 'words')
  expect(words!.total).toBeGreaterThan(0)

  // Card labels/badge/description are surfaced from the dataset metadata
  await expect(page.locator('.mode-card .badge').first()).toHaveText('Practice')
  await expect(page.locator('.mode-card').first()).toContainText('Grind for as long as you like.')
  const { datasets: ui } = await getJson<{
    datasets: Array<{ id: string; mode: string }>
  }>(page, '/api/datasets')
  const compacts = page.locator('.stat.compact .lbl')
  await expect(compacts.nth(0)).toHaveText('items')
  await expect(compacts.nth(1)).toHaveText('items')
  expect(ui.find(d => d.id === 'words')!.mode).toBe('srs')
})

test('renders a card purely from datasets.json metadata', async ({ page }) => {
  await page.route('**/api/datasets', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        datasets: [
          {
            id: 'xyz',
            name: 'Mystery Deck',
            mode: 'practice',
            type: 'character',
            badge: 'Custom',
            description: 'A made-up dataset.',
            total: 7,
          },
        ],
      }),
    })
  )

  await page.goto('/')
  await expect(page.getByText('Mystery Deck')).toBeVisible()
  await expect(page.locator('.mode-card .badge')).toHaveText('Custom')
  await expect(page.locator('.mode-card')).toContainText('A made-up dataset.')
  await expect(page.locator('.stat.compact .num')).toHaveText('7')
  await expect(page.locator('.stat.compact .lbl')).toHaveText('items')
  // A practice dataset shows only practice UI
  await expect(page.getByRole('button', { name: /Practice/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Start Lesson/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Start Review/ })).toHaveCount(0)
})

test('shows the empty state when no datasets are configured', async ({ page }) => {
  await page.route('**/api/datasets', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ datasets: [] }),
    })
  )

  await page.goto('/')
  // Rendered as a dataset-style card, with the "no items" note as its body.
  await expect(page.locator('.mode-card')).toHaveCount(1)
  const card = page.locator('.mode-card').first()
  await expect(card).toContainText('No practice items yet.')
  await expect(card.locator('.badge')).toHaveText('Empty')
  await expect(card).toContainText('data/datasets.json')
  await expect(card.locator('.stat.compact .num')).toHaveText('0')
  await expect(card.locator('.empty-note')).toBeVisible()
})

test('theme toggle does not reset the current practice item', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('button', { name: /Practice/ })
    .first()
    .click()
  const charBefore = await page.locator('.banner-char').textContent()

  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: 'Light' }).click()

  const charAfter = await page.locator('.banner-char').textContent()
  expect(charAfter).toBe(charBefore)
})

test('theme: auto-detects OS preference and toggles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  // No saved choice -> follows the OS (dark)
  await expect(page.locator('html')).toHaveClass(/dark/)

  // Toggle to light -> persisted, so it survives a reload even though the OS is dark
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('button', { name: 'Light' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('alphabet practice: grading, tally, input clears, Enter advances, stop', async ({ page }) => {
  await page.goto('/')
  const readingsByChar = await getHangulReadingsByChar(page)

  await page
    .getByRole('button', { name: /Practice/ })
    .first()
    .click()

  await expect(page.locator('.stat-chip').first()).toHaveText('#0')

  const firstChar = (await page.locator('.banner-char').textContent())!.trim()
  expect(readingsByChar[firstChar]).toBeTruthy()

  // Audio lives in the Reading tab, which only appears once the card is answered
  await expect(page.locator('.speak-btn')).toHaveCount(0)

  // Correct answer -> green result + tally
  await page.locator('.answer-input').fill(readingsByChar[firstChar][0])
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.locator('.result-bar')).toHaveClass(/green/)
  await expect(page.locator('.stat-chip.ok')).toHaveText('✓ 1')

  // After answering, the Reading-tab speaker button and banner play button are present.
  await expect(page.locator('.speak-btn').first()).toBeVisible()
  await expect(page.locator('.banner-audio-btn')).toBeVisible()

  // Pressing "p" plays the character audio (first play -> real request).
  const pAudioPromise = waitForAudio(page, HANGUL_AUDIO)
  await page.keyboard.press('p')
  const pAudioRes = await pAudioPromise
  expect(pAudioRes.ok()).toBeTruthy()

  // Enter acts as "Next" and the input clears for the new item (regression)
  await page.locator('.banner').click() // move focus off the card
  await page.keyboard.press('Enter')
  await expect(page.locator('.answer-input')).toHaveValue('')
  const secondChar = (await page.locator('.banner-char').textContent())!.trim()
  expect(secondChar.length).toBeGreaterThan(0)

  // Wrong answer -> red result, miss tallied, streak resets
  await page.locator('.answer-input').fill('zzzzzz')
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.locator('.result-bar')).toHaveClass(/red/)
  await expect(page.locator('.stat-chip.no')).toHaveText('✗ 1')
  await expect(page.locator('.stat-chip.streak')).toHaveText('🔥 0')

  // Show/reveal path also works
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(page.locator('.result-bar')).toBeVisible()
  if ((await page.getByRole('button', { name: 'Next' }).count()) > 0) {
    await page.getByRole('button', { name: 'Next' }).click()
  }

  // Stop -> back to dashboard
  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

test('practice: self-grade cards accept/reject via button click', async ({ page }) => {
  await page.goto('/')

  const card = page.locator('.mode-card', { hasText: 'Hangul - Seen' })
  await card.getByRole('button', { name: 'Practice' }).click()

  // No input field - the card is self-graded with accept/reject buttons.
  await expect(page.locator('.answer-input')).toHaveCount(0)

  // Accept -> green, correct tally increments.
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.locator('.card')).toHaveClass(/result-correct/)
  await expect(page.locator('.stat-chip.ok')).toHaveText('✓ 1')

  await page.getByRole('button', { name: 'Next' }).click()

  // Reject -> red, wrong tally increments.
  await page.getByRole('button', { name: 'Missed it' }).click()
  await expect(page.locator('.card')).toHaveClass(/result-incorrect/)
  await expect(page.locator('.stat-chip.no')).toHaveText('✗ 1')

  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

test('practice: self-grade cards accept/reject via keyboard shortcut', async ({ page }) => {
  await page.goto('/')

  const card = page.locator('.mode-card', { hasText: 'Hangul - Seen' })
  await card.getByRole('button', { name: 'Practice' }).click()

  await expect(page.locator('.answer-input')).toHaveCount(0)

  // Accept via keyboard shortcut -> green, correct tally increments.
  await page.keyboard.press('2')
  await expect(page.locator('.card')).toHaveClass(/result-correct/)
  await expect(page.locator('.stat-chip.ok')).toHaveText('✓ 1')

  await page.getByRole('button', { name: 'Next' }).click()

  // Reject via keyboard shortcut -> red, wrong tally increments.
  await page.keyboard.press('1')
  await expect(page.locator('.card')).toHaveClass(/result-incorrect/)
  await expect(page.locator('.stat-chip.no')).toHaveText('✗ 1')

  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

test('practice: play button appears after answering', async ({ page }) => {
  await page.goto('/')

  const card = page.locator('.mode-card', { hasText: 'Hangul - Seen' })
  await card.getByRole('button', { name: 'Practice' }).click()

  // No play button before answering.
  await expect(page.locator('.banner-audio-btn')).toHaveCount(0)

  await page.getByRole('button', { name: 'Got it' }).click()

  // The play button is visible after answering and plays the audio.
  const play = page.locator('.banner-audio-btn')
  await expect(play).toBeVisible()

  const audioPromise = waitForAudio(page, HANGUL_AUDIO)
  await play.click()
  const audioRes = await audioPromise
  expect(audioRes.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

test('practice: auto-plays audio after answering when autoplay is enabled', async ({ page }) => {
  // Enable auto-play before the app boots, so it reads "on" from storage.
  await enableAutoplay(page, AUTOPLAY_REVIEW)
  await page.goto('/')

  const readingsByChar = await getHangulReadingsByChar(page)

  await page
    .getByRole('button', { name: /Practice/ })
    .first()
    .click()

  const firstChar = (await page.locator('.banner-char').textContent())!.trim()
  expect(readingsByChar[firstChar]).toBeTruthy()

  // Answer the card; with autoplay on the audio request fires without pressing "p".
  const audioPromise = waitForAudio(page, HANGUL_AUDIO)
  await page.locator('.answer-input').fill(readingsByChar[firstChar][0])
  await page.getByRole('button', { name: 'Enter' }).click()

  const audioRes = await audioPromise
  expect(audioRes.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
})

test('practice: self-grade cards auto-play audio when autoplay is enabled', async ({ page }) => {
  await enableAutoplay(page, AUTOPLAY_REVIEW)
  await page.goto('/')

  // "Hangul - Seen" cards have no readings/meanings (self-grade) but do carry audio.
  const card = page.locator('.mode-card', { hasText: 'Hangul - Seen' })
  await card.getByRole('button', { name: 'Practice' }).click()
  await expect(page.locator('.answer-input')).toHaveCount(0) // self-grade card

  // Self-grading ("Got it") fires the audio request automatically (no "p" pressed).
  const audioPromise = waitForAudio(page, HANGUL_AUDIO)
  await page.getByRole('button', { name: 'Got it' }).click()

  const audioRes = await audioPromise
  expect(audioRes.ok()).toBeTruthy()
})

test('word lesson: auto-plays word audio only on the Reading step, not Meaning', async ({
  page,
}) => {
  await enableAutoplay(page, AUTOPLAY_LESSON)
  await page.goto('/')

  const lesson = await getJson<{ items: Array<{ audio: string | null }> }>(
    page,
    '/api/lesson/start?dataset=words'
  )
  expect(lesson.items.length).toBeGreaterThan(0)
  if (!lesson.items[0].audio) {
    return // nothing to verify if the first word has no audio
  }

  await page.getByRole('button', { name: /Start Lesson/ }).click()

  // Track any word-audio requests fired during the lesson.
  const audio = trackAudio(page, WORD_AUDIO)

  // Step 1 is a Meaning prompt (the lesson teaches meaning, then reading).
  await expect(page.locator('.subtitle-bar')).toContainText('Meaning')
  await page.getByRole('button', { name: 'Reveal' }).click()
  await page.waitForTimeout(400)
  expect(audio.count()).toBe(0) // no autoplay on a Meaning card

  // Continue to the Reading step: auto-play should now fire.
  await page.getByRole('button', { name: /Continue/ }).click()
  await expect(page.locator('.subtitle-bar')).toContainText('Reading')
  await page.getByRole('button', { name: 'Reveal' }).click()
  await expect.poll(() => audio.count()).toBeGreaterThan(0)

  audio.stop()
})

test('word lesson: pressing "p" plays the word audio after reveal', async ({ page }) => {
  await page.goto('/')
  const lesson = await getJson<{ items: Array<{ audio: string | null }> }>(
    page,
    '/api/lesson/start?dataset=words'
  )
  expect(lesson.items.length).toBeGreaterThan(0)
  if (!lesson.items[0].audio) {
    return // nothing to verify if the word has no audio
  }

  await page.getByRole('button', { name: /Start Lesson/ }).click()
  await page.getByRole('button', { name: 'Reveal' }).click()
  const pAudioPromise = waitForAudio(page, WORD_AUDIO)
  await page.keyboard.press('p')
  const pAudioRes = await pAudioPromise
  expect(pAudioRes.ok()).toBeTruthy()
})

test('word lesson walks meaning + reading steps and completes', async ({ page }) => {
  await page.goto('/')
  const lesson = await getJson<{ items: Array<{ meanings: string[] }> }>(
    page,
    '/api/lesson/start?dataset=words'
  )
  expect(lesson.items.length).toBeGreaterThan(0)
  const expectedSteps = lesson.items.reduce((n, it) => n + (it.meanings.length ? 1 : 0) + 1, 0)

  await page.getByRole('button', { name: /Start Lesson/ }).click()
  await expect(page.locator('.subtitle-bar')).toContainText('Vocabulary')
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()

  await completeLesson(page)

  // Back on the dashboard, SRS stats moved (some words are now learning)
  await expect(page.getByRole('button', { name: /Start Lesson/ })).toBeVisible()
  const { datasets } = await getJson<{
    datasets: Array<{ id: string; learning: number }>
  }>(page, '/api/datasets')
  const words = datasets.find(d => d.id === 'words')
  expect(words!.learning).toBeGreaterThan(0)
  // the number of lesson steps we walked matches the words we learned
  expect(words!.learning).toBeGreaterThanOrEqual(expectedSteps / 2)
})

test('word review: auto-plays word audio only when prompted for Reading, not Meaning', async ({
  page,
}) => {
  await enableAutoplay(page, AUTOPLAY_REVIEW)
  await page.goto('/')

  // The preceding "lesson walks" test completed a lesson, so the words it learned
  // are now due. This test reuses those due items (it does NOT run its own lesson,
  // because the 10-word seed only supports two full lessons in this serial suite).
  await expect(page.getByRole('button', { name: /Start Review/ })).toBeEnabled()

  // Only some words carry audio. Pin the question types so the queue
  // deterministically contains a Reading card AND a Meaning card that both have
  // audio (otherwise we can't reliably observe autoplay vs no autoplay).
  const { due } = await getJson<{
    due: Array<{ characters: string; meanings: string[]; readings: string[]; audio: string | null }>
  }>(page, '/api/review/start?dataset=words')
  expect(due.length).toBeGreaterThan(0)
  expect(due.filter(d => d.audio).length).toBeGreaterThanOrEqual(2)

  let pinnedReading = false
  let pinnedMeaning = false
  const pinned = due.map(d => {
    if (d.audio && !pinnedReading) {
      pinnedReading = true
      return { ...d, question_type: 'reading' }
    }
    if (d.audio && !pinnedMeaning) {
      pinnedMeaning = true
      return { ...d, question_type: 'meaning' }
    }
    return { ...d, question_type: d.readings.length > 0 ? 'reading' : 'meaning' }
  })
  await page.route(/\/api\/review\/start/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ due: pinned }),
    })
  )

  await page.getByRole('button', { name: /Start Review/ }).click()

  // Track any word-audio requests fired during review.
  const audio = trackAudio(page, WORD_AUDIO)

  // Walk the (client-shuffled) queue: a Meaning prompt must NOT autoplay, a
  // Reading one must. Only cards that actually have audio can prove either.
  let sawReadingAutoplay = false
  let sawMeaningQuiet = false
  for (let index = 0; index < pinned.length; index++) {
    const subtitle = (await page.locator('.subtitle-bar').textContent())!
    const displayedChar = (await page.locator('.banner-char').textContent())!.trim()
    const item = pinned.find(d => d.characters === displayedChar)
    if (!item) {
      throw new Error(`Could not find a pinned review card for "${displayedChar}"`)
    }

    const isReading = /Reading/.test(subtitle)
    const answer = isReading ? item.readings[0] : item.meanings[0]

    const before = audio.count()
    await page.locator('.answer-input').fill(answer)
    await page.getByRole('button', { name: 'Enter' }).click()
    // Wait for grading to finish (the result bar signals the card was answered).
    await expect(page.locator('.result-bar')).toBeVisible()

    // Only cards with audio can produce an auditable request either way.
    if (item.audio) {
      if (isReading) {
        // Auto-play fires on a Reading card: wait for the audio request.
        await expect.poll(() => audio.count() - before, { timeout: 5_000 }).toBeGreaterThan(0)
        sawReadingAutoplay = true
      } else {
        // A Meaning card never auto-plays: give any stray request time to show up.
        await page.waitForTimeout(200)
        expect(audio.count() - before).toBe(0)
        sawMeaningQuiet = true
      }
    }

    if (sawReadingAutoplay && sawMeaningQuiet) {
      break
    }

    // Advance to the next card.
    await page.locator('.banner').click()
    await page.keyboard.press('Enter')
  }

  audio.stop()
  expect(sawReadingAutoplay).toBe(true)
  expect(sawMeaningQuiet).toBe(true)
})

test('word review: grading by meaning/reading, Enter to continue', async ({ page }) => {
  await page.goto('/')

  // Need due items: run a lesson first.
  await page.getByRole('button', { name: /Start Lesson/ }).click()
  await completeLesson(page)

  // `backToDashboard` refetches /api/datasets; wait until the dashboard shows
  // due items (the button is disabled whenever due === 0), so we're not racing
  // the refresh or the Loading state.
  await expect(page.getByRole('button', { name: /Start Review/ })).toBeEnabled()

  const { due } = await getJson<{
    due: Array<{ characters: string; meanings: string[]; readings: string[]; audio: string | null }>
  }>(page, '/api/review/start?dataset=words')
  expect(due.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: /Start Review/ }).click()

  // Read what's actually shown (the queue is shuffled), then find its answer.
  const subtitle = await page.locator('.subtitle-bar').textContent()
  expect(subtitle).toMatch(/Vocabulary (Meaning|Reading)/)
  const displayedChar = (await page.locator('.banner-char').textContent())!.trim()
  const item = due.find(d => d.characters === displayedChar)
  expect(item).toBeTruthy()

  // Answer as prompted (read from the API data)
  const isMeaning = /Meaning/.test(subtitle!)
  const answer = isMeaning ? item!.meanings[0] : item!.readings[0]
  await page.locator('.answer-input').fill(answer)
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.locator('.result-bar')).toHaveClass(/green/)
  await expect(page.locator('.details')).toBeVisible()

  // Pressing "e" after answering expands both the Meaning and Reading tabs
  await page.keyboard.press('e')
  await expect(page.locator('.detail-row.open')).toHaveCount(2)

  // Pressing "p" plays the word audio (only words that have audio).
  if (item!.audio) {
    const pAudioPromise = waitForAudio(page, WORD_AUDIO)
    await page.keyboard.press('p')
    const pAudioRes = await pAudioPromise
    expect(pAudioRes.ok()).toBeTruthy()
  }

  // Enter (not the button) continues to the next item and clears the input
  await page.locator('.banner').click()
  await page.keyboard.press('Enter')
  await expect(page.locator('.answer-input')).toHaveValue('')

  // Stop back to dashboard
  await page.getByRole('button', { name: 'Back to Dashboard' }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

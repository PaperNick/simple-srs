import { test, expect } from '@playwright/test'

/**
 * The app mutates its SQLite DB as tests run, and the flows build on each other
 * (a lesson must run before a review has anything to review). Run serially.
 */
test.describe.configure({ mode: 'serial' })

/**
 * Fetch a JSON endpoint and assert the request succeeded.
 *
 * @param {import('@playwright/test').Page} page The page (uses its request API).
 * @param {string} endpoint The endpoint path.
 * @returns {Promise<any>} The parsed JSON body.
 */
async function getJson(page, endpoint) {
  const response = await page.request.get(endpoint)
  expect(response.ok(), `GET ${endpoint} failed`).toBeTruthy()
  return response.json()
}

/**
 * Walk a lesson to completion: reveal each card, then continue until the lesson
 * finishes.
 *
 * @param {import('@playwright/test').Page} page The page.
 */
async function completeLesson(page) {
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
  const alpha = await getJson(page, '/api/practice/items?dataset=hangul')
  expect(alpha.items.length).toBe(3)
  const { datasets } = await getJson(page, '/api/datasets')
  expect(datasets.length).toBe(2)
  const words = datasets.find(d => d.id === 'words')
  expect(words.total).toBeGreaterThan(0)

  // Card labels/badge/description are surfaced from the dataset metadata
  await expect(page.locator('.mode-card .badge').first()).toHaveText('Practice')
  await expect(page.locator('.mode-card').first()).toContainText('Grind for as long as you like.')
  const { datasets: ui } = await getJson(page, '/api/datasets')
  const compacts = page.locator('.stat.compact .lbl')
  await expect(compacts.nth(0)).toHaveText('items')
  await expect(compacts.nth(1)).toHaveText('items')
  expect(ui.find(d => d.id === 'words').mode).toBe('srs')
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

  await page.getByRole('button', { name: 'Toggle theme' }).click()

  const charAfter = await page.locator('.banner-char').textContent()
  expect(charAfter).toBe(charBefore)
})

test('theme: auto-detects OS preference and toggles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  // No saved choice -> follows the OS (dark)
  await expect(page.locator('html')).toHaveClass(/dark/)

  // Toggle to light -> persisted, so it survives a reload even though the OS is dark
  await page.getByRole('button', { name: 'Toggle theme' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('alphabet practice: grading, tally, input clears, Enter advances, stop', async ({ page }) => {
  await page.goto('/')
  const items = (await getJson(page, '/api/practice/items?dataset=hangul')).items
  const readingsByChar = Object.fromEntries(items.map(i => [i.characters, i.readings]))

  await page
    .getByRole('button', { name: /Practice/ })
    .first()
    .click()

  await expect(page.locator('.stat-chip').first()).toHaveText('#0')

  const firstChar = (await page.locator('.banner-char').textContent()).trim()
  expect(readingsByChar[firstChar]).toBeTruthy()

  // Audio lives in the Reading tab, which only appears once the card is answered
  await expect(page.locator('.speak-btn')).toHaveCount(0)

  // Correct answer -> green result + tally
  await page.locator('.answer-input').fill(readingsByChar[firstChar][0])
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.locator('.result-bar')).toHaveClass(/green/)
  await expect(page.locator('.stat-chip.ok')).toHaveText('✓ 1')

  // After answering, the Reading-tab speaker button is present.
  await expect(page.locator('.speak-btn').first()).toBeVisible()

  // Pressing "p" plays the character audio (first play -> real request).
  const pAudioPromise = page.waitForResponse(res =>
    /\/static\/audio\/korean\/hangul\/.+\.mp3$/.test(res.url())
  )
  await page.keyboard.press('p')
  const pAudioRes = await pAudioPromise
  expect(pAudioRes.ok()).toBeTruthy()

  // Enter acts as "Next" and the input clears for the new item (regression)
  await page.locator('.banner').click() // move focus off the card
  await page.keyboard.press('Enter')
  await expect(page.locator('.answer-input')).toHaveValue('')
  const secondChar = (await page.locator('.banner-char').textContent()).trim()
  expect(secondChar.length).toBeGreaterThan(0)

  // Wrong answer -> red result, miss tallied, streak resets
  await page.locator('.answer-input').fill('zzzzzz')
  await page.getByRole('button', { name: 'Check' }).click()
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
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

test('word lesson: pressing "p" plays the word audio after reveal', async ({ page }) => {
  await page.goto('/')
  const lesson = await getJson(page, '/api/lesson/start?dataset=words')
  expect(lesson.items.length).toBeGreaterThan(0)
  if (!lesson.items[0].audio) {
    return // nothing to verify if the word has no audio
  }

  await page.getByRole('button', { name: /Start Lesson/ }).click()
  await page.getByRole('button', { name: 'Reveal' }).click()
  const pAudioPromise = page.waitForResponse(res =>
    /\/static\/audio\/korean\/word\/.+\.mp3$/.test(res.url())
  )
  await page.keyboard.press('p')
  const pAudioRes = await pAudioPromise
  expect(pAudioRes.ok()).toBeTruthy()
})

test('word lesson walks meaning + reading steps and completes', async ({ page }) => {
  await page.goto('/')
  const lesson = await getJson(page, '/api/lesson/start?dataset=words')
  expect(lesson.items.length).toBeGreaterThan(0)
  const expectedSteps = lesson.items.reduce((n, it) => n + (it.meaning ? 1 : 0) + 1, 0)

  await page.getByRole('button', { name: /Start Lesson/ }).click()
  await expect(page.locator('.subtitle-bar')).toContainText('Vocabulary')
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible()

  await completeLesson(page)

  // Back on the dashboard, SRS stats moved (some words are now learning)
  await expect(page.getByRole('button', { name: /Start Lesson/ })).toBeVisible()
  const { datasets } = await getJson(page, '/api/datasets')
  const words = datasets.find(d => d.id === 'words')
  expect(words.learning).toBeGreaterThan(0)
  // the number of lesson steps we walked matches the words we learned
  expect(words.learning).toBeGreaterThanOrEqual(expectedSteps / 2)
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

  const due = (await getJson(page, '/api/review/start?dataset=words')).due
  expect(due.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: /Start Review/ }).click()

  // Read what's actually shown (the queue is shuffled), then find its answer.
  const subtitle = await page.locator('.subtitle-bar').textContent()
  expect(subtitle).toMatch(/Vocabulary (Meaning|Reading)/)
  const displayedChar = (await page.locator('.banner-char').textContent()).trim()
  const item = due.find(d => d.characters === displayedChar)
  expect(item).toBeTruthy()

  // Answer as prompted (read from the API data)
  const isMeaning = /Meaning/.test(subtitle)
  const answer = isMeaning ? item.meaning : item.readings[0]
  await page.locator('.answer-input').fill(answer)
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.locator('.result-bar')).toHaveClass(/green/)
  await expect(page.locator('.details')).toBeVisible()

  // Pressing "e" after answering expands both the Meaning and Reading tabs
  await page.keyboard.press('e')
  await expect(page.locator('.detail-row.open')).toHaveCount(2)

  // Pressing "p" plays the word audio (only words that have audio).
  if (item.audio) {
    const pAudioPromise = page.waitForResponse(res =>
      /\/static\/audio\/korean\/word\/.+\.mp3$/.test(res.url())
    )
    await page.keyboard.press('p')
    const pAudioRes = await pAudioPromise
    expect(pAudioRes.ok()).toBeTruthy()
  }

  // Enter (not the button) continues to the next item and clears the input
  await page.locator('.banner').click()
  await page.keyboard.press('Enter')
  await expect(page.locator('.answer-input')).toHaveValue('')

  // Stop back to dashboard
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await expect(page.locator('.brand')).toHaveText('Simple.SRS')
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  toRomaji,
  katakanaToHiragana,
  hiraganaToKatakana,
} from '../src/syllabaries/japanese/romaji'

describe('toRomaji', () => {
  it('converts basic hiragana', () => {
    assert.equal(toRomaji('いち'), 'ichi')
    assert.equal(toRomaji('にほんご'), 'nihongo')
    assert.equal(toRomaji('たべる'), 'taberu')
  })

  it('converts digraphs (kana + small ゃゅょ)', () => {
    assert.equal(toRomaji('きょう'), 'kyou')
    assert.equal(toRomaji('しゃしん'), 'shashin')
    assert.equal(toRomaji('ちゃ'), 'cha')
    assert.equal(toRomaji('じゅう'), 'juu')
  })

  it('doubles consonants after small っ', () => {
    assert.equal(toRomaji('がっこう'), 'gakkou')
    assert.equal(toRomaji('きって'), 'kitte')
    assert.equal(toRomaji('いっしょ'), 'issho')
    assert.equal(toRomaji('いっち'), 'itchi')
  })

  it('converts katakana and the long vowel mark', () => {
    assert.equal(toRomaji('トーキョー'), 'tookyoo')
    assert.equal(toRomaji('コーヒー'), 'koohii')
    assert.equal(toRomaji('アメリカ'), 'amerika')
  })

  it('passes non-kana characters through unchanged', () => {
    assert.equal(toRomaji('あか&blue'), 'aka&blue')
    assert.equal(toRomaji('一'), '一')
  })
})

describe('katakanaToHiragana', () => {
  it('converts katakana to hiragana', () => {
    assert.equal(katakanaToHiragana('カタカナ'), 'かたかな')
    assert.equal(katakanaToHiragana('トウキョウ'), 'とうきょう')
  })

  it('passes hiragana and non-kana through unchanged', () => {
    assert.equal(katakanaToHiragana('ひらがな'), 'ひらがな')
    assert.equal(katakanaToHiragana('ABC'), 'ABC')
  })
})

describe('hiraganaToKatakana', () => {
  it('converts hiragana to katakana', () => {
    assert.equal(hiraganaToKatakana('ひらがな'), 'ヒラガナ')
    assert.equal(hiraganaToKatakana('きゃ'), 'キャ')
  })

  it('passes katakana and non-kana through unchanged', () => {
    assert.equal(hiraganaToKatakana('カタカナ'), 'カタカナ')
    assert.equal(hiraganaToKatakana('ABC'), 'ABC')
  })
})

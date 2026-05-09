import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function parseXmlTvDate(value) {
  if (!value) return null
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/)
  if (!match) return null

  const [, year, month, day, hour, minute, second, offset = '+0000'] = match
  const offsetSign = offset.startsWith('-') ? -1 : 1
  const offsetHours = Number(offset.slice(1, 3))
  const offsetMinutes = Number(offset.slice(3, 5))
  const offsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return new Date(utcMs - offsetMs)
}

function uniqueIds(ids, validIds) {
  return Array.from(new Set(ids)).filter((id) => validIds.includes(id))
}

function sanitizeSettings(settings, parsedChannels) {
  const validIds = parsedChannels.map((channel) => channel.id)
  const visibleIds = uniqueIds(settings.visibleIds || [], validIds)
  const hiddenIds = uniqueIds(settings.hiddenIds || [], validIds).filter((id) => !visibleIds.includes(id))
  const missingIds = validIds.filter((id) => !visibleIds.includes(id) && !hiddenIds.includes(id))

  if (visibleIds.length === 0) {
    return {
      visibleIds: [validIds[0]].filter(Boolean),
      hiddenIds: validIds.slice(1),
    }
  }

  return { visibleIds, hiddenIds: [...hiddenIds, ...missingIds] }
}

describe('parseXmlTvDate', () => {
  it('respects UTC offsets without changing the represented instant', () => {
    assert.equal(parseXmlTvDate('20260509080000 +0000')?.toISOString(), '2026-05-09T08:00:00.000Z')
    assert.equal(parseXmlTvDate('20260509100000 +0200')?.toISOString(), '2026-05-09T08:00:00.000Z')
    assert.equal(parseXmlTvDate('20260109090000 +0100')?.toISOString(), '2026-01-09T08:00:00.000Z')
  })

  it('returns null for invalid values', () => {
    assert.equal(parseXmlTvDate('bad-date'), null)
    assert.equal(parseXmlTvDate(null), null)
  })
})

describe('normalize', () => {
  it('removes accents and symbols', () => {
    assert.equal(normalize('Canal Extremadura HD'), 'canalextremadurahd')
    assert.equal(normalize('laSexta.es'), 'lasextaes')
    assert.equal(normalize('À Punt TV'), 'apunttv')
  })
})

describe('sanitizeSettings', () => {
  const channels = [
    { id: 'la1', name: 'La 1' },
    { id: 'la2', name: 'La 2' },
    { id: 'a3', name: 'Antena 3' },
  ]

  it('removes duplicated and invalid ids', () => {
    assert.deepEqual(sanitizeSettings({ visibleIds: ['la1', 'bad', 'la1'], hiddenIds: ['la2', 'bad'] }, channels), {
      visibleIds: ['la1'],
      hiddenIds: ['la2', 'a3'],
    })
  })
})

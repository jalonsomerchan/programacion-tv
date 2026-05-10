import { defaultChannels } from './defaultChannels'
import type { Channel, ChannelRow, ChannelSettings, Programme, ProgrammeJson, TimeSlot } from './types'

export function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function slugify(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'canal'
}

export function cleanChannelName(name: string) {
  return name.replace(/\.es$/i, '').trim()
}

export function parseXmlTvDate(value: string | null) {
  if (!value) return null

  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/)
  if (!match) return null

  const [, year, month, day, hour, minute, second, offset = '+0000'] = match
  const offsetSign = offset.startsWith('-') ? -1 : 1
  const offsetHours = Number(offset.slice(1, 3))
  const offsetMinutes = Number(offset.slice(3, 5))

  if (Number.isNaN(offsetHours) || Number.isNaN(offsetMinutes)) return null

  const offsetMs = offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )

  return new Date(utcMs - offsetMs)
}

export function inflateProgramme(programme: ProgrammeJson): Programme {
  const start = new Date(programme.start)
  const stop = new Date(programme.stop)

  return {
    ...programme,
    start,
    stop,
    startMs: programme.startMs || start.getTime(),
    stopMs: programme.stopMs || stop.getTime(),
  }
}

export function groupProgrammes(items: Programme[]) {
  const groups = new Map<string, Programme[]>()

  for (const programme of items) {
    const channelProgrammes = groups.get(programme.channelId) || []
    channelProgrammes.push(programme)
    groups.set(programme.channelId, channelProgrammes)
  }

  return groups
}

export function buildRows(selectedChannels: Channel[], groups: Map<string, Programme[]>, currentDate: Date): ChannelRow[] {
  const currentTime = currentDate.getTime()

  return selectedChannels.map((channel) => {
    const schedule = groups.get(channel.id) || []
    const current = schedule.find((programme) => programme.startMs <= currentTime && programme.stopMs > currentTime)
    const next = schedule.find((programme) => programme.startMs > currentTime)

    return { channel, current, next, schedule }
  })
}

export function filterRows(items: ChannelRow[], query: string) {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return items

  return items.filter((row) => {
    return (
      row.channel.normalized.includes(normalizedQuery) ||
      row.schedule.some((programme) => normalize(`${programme.title} ${programme.description}`).includes(normalizedQuery))
    )
  })
}

export function getFilteredChannels(channelList: Channel[], search: string) {
  const normalizedSearch = normalize(search)

  return channelList
    .filter((channel) => !normalizedSearch || channel.normalized.includes(normalizedSearch) || normalize(channel.id).includes(normalizedSearch))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export function uniqueIds(ids: string[], validIds: string[]) {
  return Array.from(new Set(ids)).filter((id) => validIds.includes(id))
}

function findDefaultChannel(parsedChannels: Channel[], aliases: string[]) {
  const aliasSet = aliases.map(normalize)

  return (
    parsedChannels.find((channel) => aliasSet.includes(channel.normalized) || aliasSet.includes(normalize(channel.id))) ||
    parsedChannels.find((channel) => {
      const normalizedId = normalize(channel.id)
      return aliasSet.some((alias) => {
        const hdAlias = `${alias}hd`
        const uhdAlias = `${alias}uhd`
        return channel.normalized === hdAlias || normalizedId === hdAlias || channel.normalized === uhdAlias || normalizedId === uhdAlias
      })
    })
  )
}

export function getDefaultChannelIds(parsedChannels: Channel[]) {
  const ids = defaultChannels
    .map((defaultChannel) => findDefaultChannel(parsedChannels, defaultChannel.aliases)?.id)
    .filter((id): id is string => Boolean(id))

  return Array.from(new Set(ids))
}

export function sanitizeSettings(settings: Partial<ChannelSettings>, parsedChannels: Channel[]): ChannelSettings {
  const validIds = parsedChannels.map((channel) => channel.id)
  const visibleIds = uniqueIds(settings.visibleIds || [], validIds)
  const hiddenIds = uniqueIds(settings.hiddenIds || [], validIds).filter((id) => !visibleIds.includes(id))
  const missingIds = validIds.filter((id) => !visibleIds.includes(id) && !hiddenIds.includes(id))

  if (visibleIds.length === 0) {
    const defaultIds = getDefaultChannelIds(parsedChannels)
    return {
      visibleIds: defaultIds,
      hiddenIds: validIds.filter((id) => !defaultIds.includes(id)),
    }
  }

  return {
    visibleIds,
    hiddenIds: [...hiddenIds, ...missingIds],
  }
}

export function getAvailableDays(programmes: Programme[]) {
  return Array.from(new Set(programmes.map((programme) => getLocalDateKey(programme.start)))).sort()
}

export function getLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function filterProgrammesByDay(programmes: Programme[], dateKey: string) {
  if (!dateKey) return programmes
  return programmes.filter((programme) => getLocalDateKey(programme.start) === dateKey || getLocalDateKey(programme.stop) === dateKey)
}

export function filterProgrammesByTimeSlot(programmes: Programme[], slot: TimeSlot, now = new Date()) {
  if (slot === 'all') return programmes
  if (slot === 'now') return programmes.filter((programme) => programme.startMs <= now.getTime() && programme.stopMs > now.getTime())

  return programmes.filter((programme) => {
    const hour = programme.start.getHours()

    if (slot === 'morning') return hour >= 6 && hour < 14
    if (slot === 'afternoon') return hour >= 14 && hour < 20
    if (slot === 'prime') return hour >= 20 && hour < 24
    if (slot === 'night') return hour < 6 || hour >= 0 && hour < 6

    return true
  })
}

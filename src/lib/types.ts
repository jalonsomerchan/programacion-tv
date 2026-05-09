export type Theme = 'light' | 'dark'

export type Channel = {
  id: string
  name: string
  normalized: string
  slug: string
}

export type Programme = {
  channelId: string
  title: string
  description: string
  start: Date
  stop: Date
  startMs: number
  stopMs: number
}

export type ProgrammeJson = Omit<Programme, 'start' | 'stop'> & {
  start: string
  stop: string
}

export type GuideMetadata = {
  source: string
  generatedAt: string
  programmeCount: number
  channelCount: number
  fallbackUsed?: boolean
}

export type GuideJson = {
  metadata: GuideMetadata
  channels: Channel[]
  programmes: ProgrammeJson[]
}

export type ChannelSettings = {
  visibleIds: string[]
  hiddenIds: string[]
}

export type ExportedSettings = ChannelSettings & {
  app: 'programacion-tv'
  version: 2
  exportedAt: string
}

export type ChannelRow = {
  channel: Channel
  current?: Programme
  next?: Programme
  schedule: Programme[]
}

export type DefaultChannel = {
  label: string
  aliases: string[]
}

export type TimeSlot = 'all' | 'now' | 'morning' | 'afternoon' | 'prime' | 'night'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const inputPath = process.argv[2] || 'public/data/spain4.xml'
const outputPath = process.argv[3] || 'public/data/guide.json'
const sourceUrl = 'https://www.open-epg.com/files/spain4.xml.gz'

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function slugify(value) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'canal'
  )
}

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
}

function getAttribute(node, name) {
  return node.match(new RegExp(`${name}="([^"]*)"`))?.[1] || ''
}

function getText(node, tag) {
  const match = node.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return decodeXml(match?.[1] || '')
}

function cleanChannelName(name) {
  return name.replace(/\.es$/i, '').trim()
}

function parseXmlTvDate(value) {
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

function withUniqueSlugs(channels) {
  const seen = new Map()

  return channels.map((channel) => {
    const baseSlug = slugify(channel.name)
    const count = seen.get(baseSlug) || 0
    seen.set(baseSlug, count + 1)

    return {
      ...channel,
      slug: count === 0 ? baseSlug : `${baseSlug}-${count + 1}`,
    }
  })
}

const xml = await readFile(inputPath, 'utf-8')

const rawChannels = Array.from(xml.matchAll(/<channel\b[\s\S]*?<\/channel>/gi)).map(([node]) => {
  const id = decodeXml(getAttribute(node, 'id'))
  const name = cleanChannelName(getText(node, 'display-name') || id)

  return {
    id,
    name,
    normalized: normalize(name),
    slug: slugify(name),
  }
})

const channels = withUniqueSlugs(rawChannels.filter((channel) => channel.id))
const channelIds = new Set(channels.map((channel) => channel.id))

const programmes = Array.from(xml.matchAll(/<programme\b[\s\S]*?<\/programme>/gi))
  .map(([node]) => {
    const channelId = decodeXml(getAttribute(node, 'channel'))
    const start = parseXmlTvDate(getAttribute(node, 'start'))
    const stop = parseXmlTvDate(getAttribute(node, 'stop'))

    if (!channelId || !channelIds.has(channelId) || !start || !stop || stop <= start) return null

    return {
      channelId,
      title: getText(node, 'title') || 'Programa sin título',
      description: getText(node, 'desc'),
      start: start.toISOString(),
      stop: stop.toISOString(),
      startMs: start.getTime(),
      stopMs: stop.getTime(),
    }
  })
  .filter(Boolean)
  .sort((a, b) => a.startMs - b.startMs)

if (channels.length === 0 || programmes.length === 0) {
  throw new Error(`La guía no es válida: ${channels.length} canales y ${programmes.length} programas.`)
}

const guide = {
  metadata: {
    source: sourceUrl,
    generatedAt: new Date().toISOString(),
    programmeCount: programmes.length,
    channelCount: channels.length,
  },
  channels,
  programmes,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(guide)}\n`, 'utf-8')

console.log(`Guide created at ${outputPath}: ${channels.length} channels, ${programmes.length} programmes.`)

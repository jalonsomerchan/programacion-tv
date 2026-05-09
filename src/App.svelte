<script lang="ts">
  import { onMount } from 'svelte'

  const EPG_XML_URL = 'https://www.open-epg.com/files/spain4.xml'
  const EPG_GZIP_URL = 'https://www.open-epg.com/files/spain4.xml.gz'
  const SETTINGS_KEY = 'programacion-tv-channel-order-v1'
  const THEME_KEY = 'programacion-tv-theme'

  type Theme = 'light' | 'dark'

  type Channel = {
    id: string
    name: string
    normalized: string
  }

  type Programme = {
    channelId: string
    title: string
    description: string
    start: Date
    stop: Date
    startMs: number
    stopMs: number
  }

  type ChannelRow = {
    channel: Channel
    current?: Programme
    next?: Programme
  }

  type DefaultChannel = {
    label: string
    aliases: string[]
  }

  const defaultChannels: DefaultChannel[] = [
    { label: 'La 1', aliases: ['la1', 'la1es', 'tve1', 'launo'] },
    { label: 'La 2', aliases: ['la2', 'la2es', 'tve2', 'lados'] },
    { label: 'Antena 3', aliases: ['antena3', 'antena3es', 'a3'] },
    { label: 'Cuatro', aliases: ['cuatro', 'cuatroes'] },
    { label: 'Telecinco', aliases: ['telecinco', 'telecincoes', 't5'] },
    { label: 'laSexta', aliases: ['lasexta', 'lasextaes', 'sexta'] },
    { label: 'Canal Extremadura', aliases: ['canalextremadura', 'extremadura', 'cextremadura'] },
    { label: 'Neox', aliases: ['neox', 'neoxes'] },
    { label: 'Nova', aliases: ['nova', 'novaes'] },
    { label: 'Mega', aliases: ['mega', 'megaes'] },
    { label: 'TRECE TV', aliases: ['trecetv', 'trece', '13tv', '13tves'] },
    { label: 'DMAX', aliases: ['dmax', 'dmaxes'] },
    { label: 'DKISS', aliases: ['dkiss', 'dkisses'] },
    { label: 'Divinity', aliases: ['divinity', 'divinityes', 'divnity'] },
    { label: 'Atreseries', aliases: ['atreseries', 'atreserieses', 'atreseriesinternacional'] },
  ]

  const timeFormatter = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const dateFormatter = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  let channels: Channel[] = []
  let programmes: Programme[] = []
  let selectedChannelIds: string[] = []
  let channelSearch = ''
  let rows: ChannelRow[] = []
  let now = new Date()
  let lastUpdated: Date | null = null
  let loading = true
  let errorMessage = ''
  let settingsOpen = false
  let theme: Theme = 'light'

  $: channelMap = new Map(channels.map((channel) => [channel.id, channel]))
  $: programmesByChannel = groupProgrammes(programmes)
  $: visibleChannels = selectedChannelIds
    .map((channelId) => channelMap.get(channelId))
    .filter((channel): channel is Channel => Boolean(channel))
  $: rows = buildRows(visibleChannels, programmesByChannel, now)
  $: filteredChannels = getFilteredChannels(channels, channelSearch)
  $: sourceSummary = programmes.length
    ? `${programmes.length.toLocaleString('es-ES')} programas cargados de ${channels.length.toLocaleString('es-ES')} canales`
    : 'Cargando la guía de programación'

  onMount(() => {
    setupTheme()
    loadEpg()

    const interval = window.setInterval(() => {
      now = new Date()
    }, 60_000)

    return () => window.clearInterval(interval)
  })

  function normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  }

  function setupTheme() {
    const storedTheme = window.localStorage.getItem(THEME_KEY) as Theme | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    theme = storedTheme || (prefersDark ? 'dark' : 'light')
    document.documentElement.dataset.theme = theme
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }

  async function loadEpg() {
    loading = true
    errorMessage = ''

    try {
      const xml = await fetchXmlText()
      parseXmlTv(xml)
      lastUpdated = new Date()
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'No se ha podido cargar la programación.'
    } finally {
      loading = false
    }
  }

  async function fetchXmlText() {
    try {
      const response = await fetch(EPG_XML_URL, { cache: 'no-store' })

      if (!response.ok) {
        throw new Error(`La fuente ha respondido con estado ${response.status}`)
      }

      return await response.text()
    } catch (xmlError) {
      const response = await fetch(EPG_GZIP_URL, { cache: 'no-store' })

      if (!response.ok || !response.body || !('DecompressionStream' in window)) {
        throw xmlError instanceof Error
          ? xmlError
          : new Error('No se ha podido leer el XML de programación.')
      }

      const DecompressionStreamCtor = (window as unknown as { DecompressionStream: typeof DecompressionStream }).DecompressionStream
      const decompressedStream = response.body.pipeThrough(new DecompressionStreamCtor('gzip'))
      return await new Response(decompressedStream).text()
    }
  }

  function parseXmlTv(xmlText: string) {
    const parser = new DOMParser()
    const xml = parser.parseFromString(xmlText, 'application/xml')
    const parserError = xml.querySelector('parsererror')

    if (parserError) {
      throw new Error('La guía de programación no tiene un formato XML válido.')
    }

    const parsedChannels = Array.from(xml.querySelectorAll('channel')).map((node) => {
      const id = node.getAttribute('id')?.trim() || ''
      const name = node.querySelector('display-name')?.textContent?.trim() || id

      return {
        id,
        name: cleanChannelName(name),
        normalized: normalize(name),
      }
    })

    const parsedProgrammes = Array.from(xml.querySelectorAll('programme'))
      .map((node) => {
        const channelId = node.getAttribute('channel')?.trim() || ''
        const start = parseXmlTvDate(node.getAttribute('start'))
        const stop = parseXmlTvDate(node.getAttribute('stop'))

        if (!channelId || !start || !stop) {
          return null
        }

        return {
          channelId,
          title: node.querySelector('title')?.textContent?.trim() || 'Programa sin título',
          description: node.querySelector('desc')?.textContent?.trim() || '',
          start,
          stop,
          startMs: start.getTime(),
          stopMs: stop.getTime(),
        }
      })
      .filter((programme): programme is Programme => Boolean(programme))
      .sort((a, b) => a.startMs - b.startMs)

    channels = parsedChannels
    programmes = parsedProgrammes
    selectedChannelIds = getInitialChannelOrder(parsedChannels)
  }

  function parseXmlTvDate(value: string | null) {
    if (!value) return null

    const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/)
    if (!match) return null

    const [, year, month, day, hour, minute, second, offset = '+0000'] = match
    const offsetSign = offset.startsWith('-') ? -1 : 1
    const offsetHours = Number(offset.slice(1, 3))
    const offsetMinutes = Number(offset.slice(3, 5))
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

  function cleanChannelName(name: string) {
    return name.replace(/\.es$/i, '').trim()
  }

  function getInitialChannelOrder(parsedChannels: Channel[]) {
    const stored = window.localStorage.getItem(SETTINGS_KEY)

    if (stored) {
      try {
        const storedIds = JSON.parse(stored) as string[]
        const validStoredIds = storedIds.filter((id) => parsedChannels.some((channel) => channel.id === id))

        if (validStoredIds.length > 0) {
          return validStoredIds
        }
      } catch {
        window.localStorage.removeItem(SETTINGS_KEY)
      }
    }

    return getDefaultChannelIds(parsedChannels)
  }

  function getDefaultChannelIds(parsedChannels: Channel[]) {
    const ids = defaultChannels
      .map((defaultChannel) => {
        const aliasSet = defaultChannel.aliases.map(normalize)

        return parsedChannels.find((channel) => {
          const normalizedId = normalize(channel.id)
          return aliasSet.some(
            (alias) => channel.normalized === alias || normalizedId === alias || channel.normalized.includes(alias) || normalizedId.includes(alias),
          )
        })?.id
      })
      .filter((id): id is string => Boolean(id))

    return Array.from(new Set(ids))
  }

  function groupProgrammes(items: Programme[]) {
    const groups = new Map<string, Programme[]>()

    for (const programme of items) {
      const channelProgrammes = groups.get(programme.channelId) || []
      channelProgrammes.push(programme)
      groups.set(programme.channelId, channelProgrammes)
    }

    return groups
  }

  function buildRows(selectedChannels: Channel[], groups: Map<string, Programme[]>, currentDate: Date): ChannelRow[] {
    const currentTime = currentDate.getTime()

    return selectedChannels.map((channel) => {
      const channelProgrammes = groups.get(channel.id) || []
      const current = channelProgrammes.find((programme) => programme.startMs <= currentTime && programme.stopMs > currentTime)
      const next = channelProgrammes.find((programme) => programme.startMs > currentTime)

      return { channel, current, next }
    })
  }

  function getFilteredChannels(channelList: Channel[], search: string) {
    const normalizedSearch = normalize(search)

    return channelList
      .filter((channel) => !normalizedSearch || channel.normalized.includes(normalizedSearch) || normalize(channel.id).includes(normalizedSearch))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  function saveChannelOrder(ids = selectedChannelIds) {
    selectedChannelIds = [...ids]
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(selectedChannelIds))
  }

  function toggleChannel(channelId: string, checked: boolean) {
    if (checked) {
      if (!selectedChannelIds.includes(channelId)) {
        saveChannelOrder([...selectedChannelIds, channelId])
      }
      return
    }

    saveChannelOrder(selectedChannelIds.filter((id) => id !== channelId))
  }

  function moveChannel(channelId: string, direction: -1 | 1) {
    const index = selectedChannelIds.indexOf(channelId)
    const targetIndex = index + direction

    if (index === -1 || targetIndex < 0 || targetIndex >= selectedChannelIds.length) return

    const newOrder = [...selectedChannelIds]
    const [removed] = newOrder.splice(index, 1)
    newOrder.splice(targetIndex, 0, removed)
    saveChannelOrder(newOrder)
  }

  function resetChannels() {
    const defaultIds = getDefaultChannelIds(channels)
    saveChannelOrder(defaultIds)
    channelSearch = ''
  }

  function formatTime(date: Date) {
    return timeFormatter.format(date)
  }

  function formatDate(date: Date) {
    return dateFormatter.format(date)
  }

  function formatDuration(programme: Programme) {
    const minutes = Math.max(1, Math.round((programme.stopMs - programme.startMs) / 60_000))

    if (minutes < 60) return `${minutes} min`

    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`
  }

  function getProgress(programme?: Programme) {
    if (!programme) return 0

    const total = programme.stopMs - programme.startMs
    if (total <= 0) return 0

    return Math.min(100, Math.max(0, Math.round(((now.getTime() - programme.startMs) / total) * 100)))
  }
</script>

<svelte:head>
  <meta
    name="description"
    content="Consulta la programación de la televisión en España: qué están emitiendo ahora y qué programa viene después en cada cadena."
  />
</svelte:head>

<div class="app-shell">
  <a class="skip-link" href="#programacion">Saltar a la programación</a>

  <header class="site-header">
    <nav class="topbar" aria-label="Navegación principal">
      <a class="brand" href="/" aria-label="Programación TV España">
        <span class="brand-mark" aria-hidden="true">TV</span>
        <span>
          <strong>Programación TV</strong>
          <small>España</small>
        </span>
      </a>

      <div class="topbar-actions">
        <button class="btn btn-secondary" type="button" on:click={() => (settingsOpen = !settingsOpen)} aria-expanded={settingsOpen}>
          Canales
        </button>
        <button class="btn btn-ghost" type="button" on:click={toggleTheme}>
          {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        </button>
      </div>
    </nav>
  </header>

  <main id="programacion">
    <section class="hero-section" aria-labelledby="page-title">
      <div class="hero-content">
        <p class="eyebrow">Guía de televisión en directo</p>
        <h1 id="page-title">Qué están echando ahora en la tele</h1>
        <p class="hero-text">
          Consulta de un vistazo el programa actual y el siguiente en las principales cadenas de España. Texto grande, orden claro y pensado para móvil.
        </p>
      </div>

      <aside class="status-card" aria-label="Estado de la programación">
        <span class="status-dot" class:loading-dot={loading}></span>
        <div>
          <strong>{loading ? 'Cargando programación' : 'Programación actualizada'}</strong>
          <p>{lastUpdated ? `Última consulta: ${formatTime(lastUpdated)}` : sourceSummary}</p>
        </div>
      </aside>
    </section>

    {#if settingsOpen}
      <section class="settings-panel" aria-labelledby="settings-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Configurable</p>
            <h2 id="settings-title">Elige canales y orden</h2>
          </div>
          <button class="btn btn-secondary" type="button" on:click={resetChannels}>Restablecer orden</button>
        </div>

        <div class="settings-grid">
          <div class="card settings-card">
            <h3>Canales visibles</h3>
            <p class="help-text">Usa las flechas para poner arriba tus cadenas favoritas.</p>

            {#if visibleChannels.length}
              <ol class="selected-list">
                {#each visibleChannels as channel, index (channel.id)}
                  <li>
                    <span>{channel.name}</span>
                    <div class="mini-actions">
                      <button class="icon-button" type="button" on:click={() => moveChannel(channel.id, -1)} disabled={index === 0} aria-label={`Subir ${channel.name}`}>
                        ↑
                      </button>
                      <button
                        class="icon-button"
                        type="button"
                        on:click={() => moveChannel(channel.id, 1)}
                        disabled={index === visibleChannels.length - 1}
                        aria-label={`Bajar ${channel.name}`}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                {/each}
              </ol>
            {:else}
              <p class="empty-text">No hay canales seleccionados.</p>
            {/if}
          </div>

          <div class="card settings-card">
            <label class="label" for="channel-search">Buscar canal</label>
            <input id="channel-search" class="input" type="search" bind:value={channelSearch} placeholder="Ejemplo: La 1, Neox, DMAX" />
            <p class="help-text">Marca o desmarca cadenas. La selección se guarda en este navegador.</p>

            <div class="channel-picker" aria-label="Listado de canales disponibles">
              {#each filteredChannels as channel (channel.id)}
                <label class="channel-option">
                  <input
                    type="checkbox"
                    checked={selectedChannelIds.includes(channel.id)}
                    on:change={(event) => toggleChannel(channel.id, event.currentTarget.checked)}
                  />
                  <span>{channel.name}</span>
                </label>
              {/each}
            </div>
          </div>
        </div>
      </section>
    {/if}

    <section class="toolbar" aria-label="Resumen de la guía">
      <div>
        <strong>{formatDate(now)}</strong>
        <span>Ahora son las {formatTime(now)}</span>
      </div>
      <button class="btn btn-primary" type="button" on:click={loadEpg} disabled={loading}>
        {loading ? 'Actualizando...' : 'Actualizar'}
      </button>
    </section>

    {#if errorMessage}
      <section class="alert alert-danger" role="alert">
        <h2>No se ha podido cargar la programación</h2>
        <p>{errorMessage}</p>
        <p>Prueba de nuevo en unos segundos. La guía depende de la fuente externa Open-EPG.</p>
      </section>
    {/if}

    {#if loading && !programmes.length}
      <section class="loading-list" aria-label="Cargando canales">
        {#each Array(6) as _}
          <div class="skeleton-card"></div>
        {/each}
      </section>
    {:else}
      <section class="tv-grid" aria-label="Programación por cadenas">
        {#each rows as row (row.channel.id)}
          <article class="channel-card card">
            <header class="channel-header">
              <h2>{row.channel.name}</h2>
              {#if row.current}
                <span class="badge live-badge">Ahora</span>
              {:else}
                <span class="badge muted-badge">Sin emisión actual</span>
              {/if}
            </header>

            {#if row.current}
              <div class="programme current-programme">
                <div class="programme-time">
                  <strong>{formatTime(row.current.start)} - {formatTime(row.current.stop)}</strong>
                  <span>{formatDuration(row.current)}</span>
                </div>
                <h3>{row.current.title}</h3>
                {#if row.current.description}
                  <p>{row.current.description}</p>
                {/if}
                <div class="progress" aria-label={`Progreso aproximado del programa: ${getProgress(row.current)}%`}>
                  <span style={`width: ${getProgress(row.current)}%`}></span>
                </div>
              </div>
            {:else}
              <div class="programme empty-programme">
                <h3>No aparece ningún programa en emisión ahora</h3>
                <p>Puede que la cadena no tenga datos para esta franja horaria.</p>
              </div>
            {/if}

            <div class="next-programme">
              <span class="next-label">A continuación</span>
              {#if row.next}
                <strong>{formatTime(row.next.start)} - {formatTime(row.next.stop)}</strong>
                <h3>{row.next.title}</h3>
                {#if row.next.description}
                  <p>{row.next.description}</p>
                {/if}
              {:else}
                <p>No hay más programas próximos en la guía cargada.</p>
              {/if}
            </div>
          </article>
        {/each}
      </section>
    {/if}
  </main>

  <footer class="site-footer">
    <p>
      Datos de programación de <a href="https://www.open-epg.com/" target="_blank" rel="noreferrer">Open-EPG</a>. Los horarios se muestran en tu hora local.
    </p>
  </footer>
</div>

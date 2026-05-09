<script lang="ts">
  import { onMount } from 'svelte'

  const EPG_LOCAL_URL = `${import.meta.env.BASE_URL}data/spain4.xml`
  const SETTINGS_KEY = 'programacion-tv-channel-order-v2'
  const OLD_SETTINGS_KEY = 'programacion-tv-channel-order-v1'
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

  type ChannelSettings = {
    visibleIds: string[]
    hiddenIds: string[]
  }

  type ChannelRow = {
    channel: Channel
    current?: Programme
    next?: Programme
    schedule: Programme[]
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
  let visibleChannelIds: string[] = []
  let hiddenChannelIds: string[] = []
  let expandedChannelIds: string[] = []
  let channelSearch = ''
  let now = new Date()
  let lastUpdated: Date | null = null
  let loading = true
  let errorMessage = ''
  let settingsOpen = false
  let theme: Theme = 'light'

  $: channelMap = new Map(channels.map((channel) => [channel.id, channel]))
  $: programmesByChannel = groupProgrammes(programmes)
  $: visibleChannels = visibleChannelIds
    .map((channelId) => channelMap.get(channelId))
    .filter((channel): channel is Channel => Boolean(channel))
  $: rows = buildRows(visibleChannels, programmesByChannel, now)
  $: filteredChannels = getFilteredChannels(channels, channelSearch)
  $: selectedCount = visibleChannelIds.length
  $: sourceSummary = programmes.length
    ? `${programmes.length.toLocaleString('es-ES')} programas · ${channels.length.toLocaleString('es-ES')} canales`
    : 'Cargando la guía'

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
    const response = await fetch(EPG_LOCAL_URL, { cache: 'no-store' })

    if (!response.ok) {
      throw new Error(
        'No se ha encontrado la guía local. Vuelve a ejecutar el despliegue para descargar la programación desde Open-EPG.',
      )
    }

    return await response.text()
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

    const initialSettings = getInitialSettings(parsedChannels)

    channels = parsedChannels
    programmes = parsedProgrammes
    visibleChannelIds = initialSettings.visibleIds
    hiddenChannelIds = initialSettings.hiddenIds
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

  function getInitialSettings(parsedChannels: Channel[]): ChannelSettings {
    const stored = window.localStorage.getItem(SETTINGS_KEY)

    if (stored) {
      try {
        return sanitizeSettings(JSON.parse(stored) as Partial<ChannelSettings>, parsedChannels)
      } catch {
        window.localStorage.removeItem(SETTINGS_KEY)
      }
    }

    const oldStored = window.localStorage.getItem(OLD_SETTINGS_KEY)
    if (oldStored) {
      try {
        const oldIds = JSON.parse(oldStored) as string[]
        return sanitizeSettings({ visibleIds: oldIds, hiddenIds: [] }, parsedChannels)
      } catch {
        window.localStorage.removeItem(OLD_SETTINGS_KEY)
      }
    }

    const visibleIds = getDefaultChannelIds(parsedChannels)
    const hiddenIds = parsedChannels.map((channel) => channel.id).filter((id) => !visibleIds.includes(id))
    return { visibleIds, hiddenIds }
  }

  function sanitizeSettings(settings: Partial<ChannelSettings>, parsedChannels: Channel[]): ChannelSettings {
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

  function uniqueIds(ids: string[], validIds: string[]) {
    return Array.from(new Set(ids)).filter((id) => validIds.includes(id))
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
      const schedule = groups.get(channel.id) || []
      const current = schedule.find((programme) => programme.startMs <= currentTime && programme.stopMs > currentTime)
      const next = schedule.find((programme) => programme.startMs > currentTime)

      return { channel, current, next, schedule }
    })
  }

  function getFilteredChannels(channelList: Channel[], search: string) {
    const normalizedSearch = normalize(search)

    return channelList
      .filter((channel) => !normalizedSearch || channel.normalized.includes(normalizedSearch) || normalize(channel.id).includes(normalizedSearch))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  function saveSettings(nextVisibleIds = visibleChannelIds, nextHiddenIds = hiddenChannelIds) {
    visibleChannelIds = [...nextVisibleIds]
    hiddenChannelIds = [...nextHiddenIds]
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ visibleIds: visibleChannelIds, hiddenIds: hiddenChannelIds }))
  }

  function showChannel(channelId: string) {
    if (visibleChannelIds.includes(channelId)) return
    saveSettings([...visibleChannelIds, channelId], hiddenChannelIds.filter((id) => id !== channelId))
  }

  function hideChannel(channelId: string) {
    if (!visibleChannelIds.includes(channelId)) return
    saveSettings(
      visibleChannelIds.filter((id) => id !== channelId),
      [...hiddenChannelIds.filter((id) => id !== channelId), channelId],
    )
    expandedChannelIds = expandedChannelIds.filter((id) => id !== channelId)
  }

  function toggleChannelVisibility(channelId: string) {
    if (visibleChannelIds.includes(channelId)) {
      hideChannel(channelId)
    } else {
      showChannel(channelId)
    }
  }

  function moveChannel(channelId: string, direction: -1 | 1) {
    const index = visibleChannelIds.indexOf(channelId)
    const targetIndex = index + direction

    if (index === -1 || targetIndex < 0 || targetIndex >= visibleChannelIds.length) return

    const newOrder = [...visibleChannelIds]
    const [removed] = newOrder.splice(index, 1)
    newOrder.splice(targetIndex, 0, removed)
    saveSettings(newOrder, hiddenChannelIds)
  }

  function resetChannels() {
    const defaultIds = getDefaultChannelIds(channels)
    saveSettings(defaultIds, channels.map((channel) => channel.id).filter((id) => !defaultIds.includes(id)))
    expandedChannelIds = []
    channelSearch = ''
  }

  function showAllChannels() {
    const allIds = channels.map((channel) => channel.id)
    saveSettings(allIds, [])
  }

  function hideAllChannels() {
    const defaultIds = getDefaultChannelIds(channels)
    const firstDefault = defaultIds[0] || channels[0]?.id
    if (!firstDefault) return
    saveSettings([firstDefault], channels.map((channel) => channel.id).filter((id) => id !== firstDefault))
  }

  function toggleExpanded(channelId: string) {
    expandedChannelIds = expandedChannelIds.includes(channelId)
      ? expandedChannelIds.filter((id) => id !== channelId)
      : [...expandedChannelIds, channelId]
  }

  function isExpanded(channelId: string) {
    return expandedChannelIds.includes(channelId)
  }

  function isCurrent(programme: Programme) {
    const currentTime = now.getTime()
    return programme.startMs <= currentTime && programme.stopMs > currentTime
  }

  function isPast(programme: Programme) {
    return programme.stopMs <= now.getTime()
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
    content="Consulta la programación completa de la televisión en España por cadenas, con lo que se emite ahora y todos los programas del día."
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
          <small>{formatDate(now)}</small>
        </span>
      </a>

      <div class="topbar-actions">
        <button class="btn btn-secondary" type="button" on:click={() => (settingsOpen = !settingsOpen)} aria-expanded={settingsOpen}>
          Canales ({selectedCount})
        </button>
        <button class="btn btn-ghost" type="button" on:click={toggleTheme}>
          {theme === 'dark' ? 'Claro' : 'Oscuro'}
        </button>
      </div>
    </nav>
  </header>

  <main id="programacion">
    <section class="control-bar" aria-label="Estado de la guía">
      <div class="now-block">
        <span class="status-dot" class:loading-dot={loading}></span>
        <div>
          <strong>Ahora son las {formatTime(now)}</strong>
          <span>{lastUpdated ? `Actualizado: ${formatTime(lastUpdated)} · ${sourceSummary}` : sourceSummary}</span>
        </div>
      </div>

      <button class="btn btn-primary" type="button" on:click={loadEpg} disabled={loading}>
        {loading ? 'Actualizando...' : 'Actualizar guía'}
      </button>
    </section>

    {#if settingsOpen}
      <section class="settings-panel card" aria-labelledby="settings-title">
        <div class="settings-header">
          <div>
            <p class="eyebrow">Personalización</p>
            <h1 id="settings-title">Canales visibles y orden</h1>
            <p>Los cambios se guardan automáticamente en este navegador.</p>
          </div>
          <div class="settings-actions">
            <button class="btn btn-secondary" type="button" on:click={resetChannels}>Orden recomendado</button>
            <button class="btn btn-ghost" type="button" on:click={() => (settingsOpen = false)}>Cerrar</button>
          </div>
        </div>

        <div class="settings-layout">
          <section class="settings-column" aria-labelledby="visible-title">
            <div class="column-title">
              <h2 id="visible-title">Se ven en portada</h2>
              <span class="count-pill">{visibleChannelIds.length}</span>
            </div>

            {#if visibleChannels.length}
              <ol class="selected-list">
                {#each visibleChannels as channel, index (channel.id)}
                  <li>
                    <span class="drag-handle" aria-hidden="true">☰</span>
                    <span class="channel-name">{channel.name}</span>
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
                      <button class="icon-button danger" type="button" on:click={() => hideChannel(channel.id)} aria-label={`Ocultar ${channel.name}`}>
                        ×
                      </button>
                    </div>
                  </li>
                {/each}
              </ol>
            {:else}
              <p class="empty-text">No hay canales seleccionados.</p>
            {/if}
          </section>

          <section class="settings-column" aria-labelledby="all-channels-title">
            <div class="column-title">
              <h2 id="all-channels-title">Todos los canales</h2>
              <span class="count-pill">{channels.length}</span>
            </div>

            <div class="bulk-actions">
              <button class="btn btn-secondary" type="button" on:click={showAllChannels}>Mostrar todos</button>
              <button class="btn btn-secondary" type="button" on:click={hideAllChannels}>Dejar solo uno</button>
            </div>

            <label class="label" for="channel-search">Buscar canal</label>
            <input id="channel-search" class="input" type="search" bind:value={channelSearch} placeholder="Ejemplo: La 1, Neox, DMAX" />

            <div class="channel-picker" aria-label="Listado de canales disponibles">
              {#each filteredChannels as channel (channel.id)}
                <button
                  class:active={visibleChannelIds.includes(channel.id)}
                  class="channel-toggle"
                  type="button"
                  on:click={() => toggleChannelVisibility(channel.id)}
                  aria-pressed={visibleChannelIds.includes(channel.id)}
                >
                  <span>{channel.name}</span>
                  <strong>{visibleChannelIds.includes(channel.id) ? 'Visible' : 'Oculto'}</strong>
                </button>
              {/each}
            </div>
          </section>
        </div>
      </section>
    {/if}

    {#if errorMessage}
      <section class="alert alert-danger" role="alert">
        <h1>No se ha podido cargar la programación</h1>
        <p>{errorMessage}</p>
        <p>La web usa una copia local de Open-EPG para evitar errores de CORS. Ejecuta de nuevo el workflow de despliegue o de actualización de la guía.</p>
      </section>
    {/if}

    {#if loading && !programmes.length}
      <section class="loading-list" aria-label="Cargando canales">
        {#each Array(8) as _}
          <div class="skeleton-card"></div>
        {/each}
      </section>
    {:else}
      <section class="channel-list" aria-label="Programación completa por cadenas">
        {#each rows as row (row.channel.id)}
          <article class="channel-card card" class:is-open={isExpanded(row.channel.id)}>
            <button class="channel-summary" type="button" on:click={() => toggleExpanded(row.channel.id)} aria-expanded={isExpanded(row.channel.id)}>
              <span class="channel-title-block">
                <span class="channel-logo" aria-hidden="true">{row.channel.name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{row.channel.name}</strong>
                  <small>{row.schedule.length} programas en la guía</small>
                </span>
              </span>

              <span class="summary-programmes">
                <span>
                  <small>Ahora</small>
                  <strong>{row.current?.title || 'Sin datos ahora'}</strong>
                </span>
                <span>
                  <small>Después</small>
                  <strong>{row.next?.title || 'Sin siguiente programa'}</strong>
                </span>
              </span>

              <span class="expand-indicator" aria-hidden="true">{isExpanded(row.channel.id) ? '−' : '+'}</span>
            </button>

            {#if row.current}
              <div class="current-strip">
                <span>{formatTime(row.current.start)} - {formatTime(row.current.stop)}</span>
                <div class="progress" aria-label={`Progreso aproximado del programa: ${getProgress(row.current)}%`}>
                  <span style={`width: ${getProgress(row.current)}%`}></span>
                </div>
              </div>
            {/if}

            {#if isExpanded(row.channel.id)}
              <div class="full-schedule">
                {#if row.schedule.length}
                  <ol class="programme-list">
                    {#each row.schedule as programme (programme.channelId + programme.startMs)}
                      <li class:current-item={isCurrent(programme)} class:past-item={isPast(programme)}>
                        <time datetime={programme.start.toISOString()}>{formatTime(programme.start)}</time>
                        <div class="programme-detail">
                          <div class="programme-heading">
                            <h2>{programme.title}</h2>
                            <span>{formatTime(programme.start)} - {formatTime(programme.stop)} · {formatDuration(programme)}</span>
                          </div>
                          {#if programme.description}
                            <p>{programme.description}</p>
                          {/if}
                          {#if isCurrent(programme)}
                            <span class="badge live-badge">En emisión ahora</span>
                          {/if}
                        </div>
                      </li>
                    {/each}
                  </ol>
                {:else}
                  <div class="empty-schedule">
                    <strong>No hay programación para este canal.</strong>
                    <p>La fuente EPG no incluye emisiones para esta cadena en la guía cargada.</p>
                  </div>
                {/if}
              </div>
            {/if}
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

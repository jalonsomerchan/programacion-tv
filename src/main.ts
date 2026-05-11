import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

type ServiceWorkerGuideMessage = {
  type?: 'GUIDE_CACHE_USED' | 'GUIDE_CACHE_MISSING' | 'GUIDE_NETWORK_OK'
}

let pwaStatusElement: HTMLDivElement | null = null
let pwaStatusTimeout: number | undefined

function ensurePwaStatusElement() {
  if (pwaStatusElement) return pwaStatusElement

  const element = document.createElement('div')
  element.setAttribute('role', 'status')
  element.setAttribute('aria-live', 'polite')
  element.style.position = 'fixed'
  element.style.left = '50%'
  element.style.bottom = '1rem'
  element.style.zIndex = '120'
  element.style.maxWidth = 'min(36rem, calc(100% - 2rem))'
  element.style.transform = 'translateX(-50%) translateY(150%)'
  element.style.border = '1px solid color-mix(in srgb, var(--color-primary) 32%, var(--color-border))'
  element.style.borderRadius = 'var(--radius-xl)'
  element.style.background = 'var(--color-surface)'
  element.style.boxShadow = 'var(--shadow-md)'
  element.style.color = 'var(--color-text)'
  element.style.padding = '0.85rem 1rem'
  element.style.fontWeight = '850'
  element.style.lineHeight = '1.35'
  element.style.opacity = '0'
  element.style.transition = 'transform var(--transition-base), opacity var(--transition-base)'

  document.body.appendChild(element)
  pwaStatusElement = element
  return element
}

function showPwaStatus(message: string, persist = false) {
  const element = ensurePwaStatusElement()
  window.clearTimeout(pwaStatusTimeout)
  element.textContent = message
  element.style.opacity = '1'
  element.style.transform = 'translateX(-50%) translateY(0)'

  if (!persist) {
    pwaStatusTimeout = window.setTimeout(() => hidePwaStatus(), 5500)
  }
}

function hidePwaStatus() {
  if (!pwaStatusElement) return
  pwaStatusElement.style.opacity = '0'
  pwaStatusElement.style.transform = 'translateX(-50%) translateY(150%)'
}

function setupPwaStatusMessages() {
  if (!navigator.onLine) {
    showPwaStatus('Estás sin conexión. Se intentará mostrar la última guía guardada en este dispositivo.', true)
  }

  window.addEventListener('offline', () => {
    showPwaStatus('Estás sin conexión. La app usará la última programación guardada si existe.', true)
  })

  window.addEventListener('online', () => {
    showPwaStatus('Conexión recuperada. Puedes actualizar la guía para obtener los últimos datos.')
  })

  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<ServiceWorkerGuideMessage>) => {
    if (event.data?.type === 'GUIDE_CACHE_USED') {
      showPwaStatus('Mostrando una guía guardada porque no se ha podido conectar con la fuente de datos.', true)
    }

    if (event.data?.type === 'GUIDE_CACHE_MISSING') {
      showPwaStatus('No hay una guía guardada todavía. Abre la app una vez con conexión para poder usarla sin conexión.', true)
    }

    if (event.data?.type === 'GUIDE_NETWORK_OK' && navigator.onLine) {
      hidePwaStatus()
    }
  })
}

if ('serviceWorker' in navigator) {
  setupPwaStatusMessages()

  window.addEventListener('load', () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(serviceWorkerUrl).catch((error) => {
      console.warn('No se ha podido registrar el service worker de Programación TV.', error)
    })
  })
}

export default app

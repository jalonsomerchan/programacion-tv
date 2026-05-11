import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(serviceWorkerUrl).catch((error) => {
      console.warn('No se ha podido registrar el service worker de Programación TV.', error)
    })
  })
}

export default app

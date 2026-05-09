# Programación TV España

Aplicación estática para consultar la programación de televisión en España. Está hecha con Vite, Svelte 5 y TypeScript, y se despliega en GitHub Pages.

La guía se actualiza automáticamente desde Open-EPG, se convierte a un JSON ligero durante el workflow y se sirve como fichero estático para evitar CORS y reducir trabajo en el navegador.

## Funcionalidades

- Consulta de lo que se emite ahora y lo que viene después por canal.
- Parrilla completa por canal.
- Búsqueda por canal, título y descripción.
- Selección, ocultación y ordenación de canales.
- Exportación e importación de la configuración en JSON.
- Filtros por día y franja horaria: ahora, mañana, tarde, prime time y madrugada.
- Tema claro/oscuro persistente.
- Metadatos SEO, sitemap, robots.txt y datos estructurados.

## Requisitos

- Node.js 24 o compatible con las versiones usadas por Vite y Svelte.
- npm.

## Instalación

```bash
npm ci
npm run dev
```

La aplicación se abrirá en el servidor local de Vite.

## Scripts disponibles

```bash
npm run dev          # servidor de desarrollo
npm run check        # svelte-check y TypeScript
npm test             # tests básicos con node:test
npm run build        # build de producción
npm run preview      # previsualiza el build
npm run build:guide  # convierte public/data/spain4.xml en public/data/guide.json
```

## Origen de datos

La programación se descarga desde:

```text
https://www.open-epg.com/files/spain4.xml.gz
```

El workflow descomprime el XML en `public/data/spain4.xml` y ejecuta `scripts/build-guide.mjs` para generar `public/data/guide.json`.

El parser respeta el offset horario incluido en cada atributo XMLTV `start` y `stop`. No reescribe las fechas a mano, porque cambiar solo el offset sin convertir el instante puede desplazar la programación.

## Actualización y despliegue

El despliegue está en `.github/workflows/deploy.yml`.

Se ejecuta:

- en cada push a `main`;
- cada 6 horas mediante cron;
- manualmente con `workflow_dispatch`.

Pasos principales:

1. Instala dependencias con `npm ci`.
2. Descarga `spain4.xml.gz` desde Open-EPG.
3. Valida que el XML contiene `<tv>` y `<programme>`.
4. Genera `public/data/guide.json`.
5. Ejecuta `npm run check`.
6. Ejecuta `npm test`.
7. Construye la web con `npm run build`.
8. Publica `dist` en GitHub Pages.

Si Open-EPG falla temporalmente, el workflow intenta reutilizar la última guía publicada en GitHub Pages. En ese caso marca `metadata.fallbackUsed` dentro de `guide.json`.

## Estructura principal

```text
.github/workflows/deploy.yml  # actualización de EPG y despliegue
public/                       # assets públicos, robots, sitemap y datos generados
scripts/build-guide.mjs        # conversor XMLTV -> JSON
scripts/*.test.mjs             # tests básicos sin dependencias extra
src/App.svelte                 # interfaz principal
src/app.css                    # estilos globales
src/lib/                       # tipos, canales por defecto y utilidades puras
```

## Solución de problemas

### No se ha encontrado la guía local

Ejecuta el workflow de despliegue o genera la guía localmente:

```bash
mkdir -p public/data
# descarga manualmente spain4.xml en public/data/spain4.xml
npm run build:guide
npm run dev
```

### Los horarios aparecen desplazados

Comprueba el offset de las fechas en el XML original. El parser interpreta el instante usando el offset incluido en XMLTV. No se debe sustituir `+0000` por `+0100` o `+0200` sin convertir también la hora.

### Falla la descarga de Open-EPG

El workflow tiene reintentos y fallback a la última guía publicada. Si no existe una guía válida previa, el despliegue fallará para evitar publicar una app sin datos.

## SEO

La aplicación incluye:

- `canonical` absoluto.
- Open Graph y Twitter Card.
- `public/robots.txt`.
- `public/sitemap.xml`.
- JSON-LD de tipo `WebApplication`.

Si se cambia la URL pública, actualiza `index.html`, `public/robots.txt`, `public/sitemap.xml` y la variable `DEPLOYED_GUIDE_URL` del workflow.

## Atribución

Los datos de programación proceden de Open-EPG. Revisa sus condiciones de uso antes de redistribuir o reutilizar la guía fuera de este proyecto.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const htmlPath = join(dist, 'index.html')
let html = readFileSync(htmlPath, 'utf8')

const assets = readdirSync(join(dist, 'assets'))
const jsName = assets.find((f) => f.endsWith('.js'))
const cssName = assets.find((f) => f.endsWith('.css'))
if (!jsName || !cssName) throw new Error('missing assets')

const js = readFileSync(join(dist, 'assets', jsName), 'utf8')
const css = readFileSync(join(dist, 'assets', cssName), 'utf8')

html = html
  .replace(/\s*<script[^>]*src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/\s*<link[^>]*rel="stylesheet"[^>]*>/g, '')
html = html.replace(
  '</head>',
  `    <link rel="stylesheet" href="./assets/${cssName}">\n    <script defer src="./assets/${jsName}"></script>\n  </head>`
)
writeFileSync(htmlPath, html)

const standalone = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UFC Offline Viewer</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
${js}
    </script>
  </body>
</html>
`
writeFileSync(join(dist, 'ufc-offline-viewer.html'), standalone)
console.log('Wrote dist/index.html (classic scripts) and dist/ufc-offline-viewer.html (single-file)')

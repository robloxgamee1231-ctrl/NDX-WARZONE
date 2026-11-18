import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const scopes = ['src', 'server', 'test', 'tools']
const sourcePattern = /\.(?:js|mjs|css|html)$/u
const totals = new Map()

async function filesIn(directory) {
  const list = await readdir(directory, { withFileTypes: true })
  const entries = await Promise.all(
    list.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return filesIn(path)
      return entry.isFile() && sourcePattern.test(entry.name) ? [path] : []
    }),
  )
  return entries.flat()
}

export function physicalLines(text) {
  if (text === '') return 0
  const lines = text.split(/\r\n|\n|\r/u)
  return lines.length - Number(lines.at(-1) === '')
}

async function measure(label, entries) {
  let lines = 0
  let nonblank = 0
  for (const entry of entries) {
    const source = await readFile(entry, 'utf8')
    lines += physicalLines(source)
    nonblank += source.split(/\r\n|\n|\r/u).filter((line) => line.trim()).length
  }
  totals.set(label, { files: entries.length, lines, nonblank })
}

export async function reportLines() {
  for (const scope of scopes)
    await measure(scope, await filesIn(join(root, scope)))
  await measure(
    'entry & build config',
    ['index.html', 'vite.config.js'].map((name) => join(root, name)),
  )
  const rows = [...totals]
  const sums = Object.fromEntries(
    ['files', 'lines', 'nonblank'].map((key) => [
      key,
      rows.reduce((n, [, v]) => n + v[key], 0),
    ]),
  )
  return { rows, sums }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { rows, sums } = await reportLines()
  console.table(Object.fromEntries([...rows, ['Total', sums]]))
  console.info(
    'Hand-maintained application, styles, server, tests, and tools. No vendor packages, build output, models, textures, HTML generated at runtime, or docs counted.',
  )
}

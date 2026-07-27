import { readFileSync } from 'node:fs'

const inputPath = process.argv[2]
if (!inputPath) throw new Error('usage: bun scripts/xhs-deobfuscate.mjs <script>')

const source = readFileSync(inputPath, 'utf8')
const marker = 'var glb='
const prefixEnd = source.indexOf(marker)
if (prefixEnd < 0) throw new Error('decoder prefix not found')

const prefix = source.slice(0, prefixEnd)
const decoder = Function(`${prefix}; return _0xe762c0;`)()
const decodeCall = /(?:_0xe762c0|_0x4ae35e)\((0x[\da-f]+|\d+)\)/gi
const decoded = source.replace(decodeCall, (_, rawIndex) => {
  const value = decoder(Number(rawIndex))
  return JSON.stringify(value)
})

process.stdout.write(decoded)

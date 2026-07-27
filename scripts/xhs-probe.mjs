import { readFileSync } from 'node:fs'
import { createCipheriv, createHash } from 'node:crypto'
import vm from 'node:vm'

const summaryOnly = process.argv.includes('--summary')
const inputPaths = process.argv.slice(2).filter((value) => value !== '--summary')
if (!inputPaths.length) throw new Error('usage: bun scripts/xhs-probe.mjs <script...>')
const writes = []
const generatedSources = []
const noop = () => undefined
const emptyNode = new Proxy({}, {
  get(object, property) {
    if (property === 'style') return object
    if (property === 'children') return []
    if (property === 'getContext') return noop
    if (property === 'appendChild' || property === 'removeChild') return noop
    return object[property]
  },
})
class EmptyMutationObserver {
  observe() {}
  disconnect() {}
  takeRecords() { return [] }
}
class EmptyCanvasRenderingContext2D {
  fillText() {}
  strokeText() {}
  measureText() { return { width: 0 } }
  getImageData() { return { data: new Uint8ClampedArray() } }
}
class EmptyHtmlCanvasElement {
  getContext() { return new EmptyCanvasRenderingContext2D() }
  toDataURL() { return 'data:image/png;base64,' }
}
const storage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  clear() {},
}
const addEventListener = () => undefined
const removeEventListener = () => undefined
const target = {
  console,
  Uint8Array,
  TextEncoder,
  TextDecoder,
  Array,
  Date,
  Error,
  Function,
  JSON,
  Map,
  Math,
  Number,
  Object,
  Promise,
  Proxy,
  RegExp,
  Set,
  String,
  Symbol,
  URL,
  CanvasRenderingContext2D: EmptyCanvasRenderingContext2D,
  HTMLCanvasElement: EmptyHtmlCanvasElement,
  atob,
  btoa,
  decodeURIComponent,
  encodeURIComponent,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  addEventListener,
  removeEventListener,
  document: {
    body: emptyNode,
    documentElement: emptyNode,
    createElement: (tagName) => tagName === 'canvas' ? new EmptyHtmlCanvasElement() : emptyNode,
    querySelector: () => null,
    addEventListener,
    removeEventListener,
  },
  performance: { now: () => 0, timeOrigin: 0 },
  MutationObserver: EmptyMutationObserver,
  localStorage: storage,
  sessionStorage: storage,
  Reflect: new Proxy(Reflect, {
    get(object, property) {
      if (property !== 'construct') return object[property]
      return (Constructor, args, NewTarget) => {
        if (typeof Constructor !== 'function') {
          console.error('invalid Reflect.construct', { Constructor, args, NewTarget })
          return {}
        }
        return NewTarget === undefined
          ? Reflect.construct(Constructor, args)
          : Reflect.construct(Constructor, args, NewTarget)
      }
    },
  }),
  __probeNew(Constructor, index, stack) {
    if (typeof Constructor !== 'function') {
      console.error('invalid constructor', { index, stack: stack.slice(Math.max(0, index - 4), index + 5) })
      return {}
    }
    return Reflect.construct(Constructor, [])
  },
  __probeApply(callable, thisValue, args, sourceValue) {
    if (typeof callable !== 'function') {
      console.error('invalid apply target', { callable, thisValue, args, sourceValue })
      return undefined
    }
    return callable.apply(thisValue, args)
  },
  __probeGet(object, property) {
    if (object == null) {
      console.error('invalid property read', { object, property })
      return undefined
    }
    return object[property]
  },
  __probeAssign(object, property, value) {
    object[property] = value
    const lengths = [4, 16, 44, 52, 60]
    if (object && lengths.includes(object.length)) {
      const values = Array.from(object)
      if (values.every((item) => Number.isInteger(item))) {
        target.__recordArray?.(`assign:${object.length}:${String(property)}`, values, new Error().stack)
      }
    }
    if (value && lengths.includes(value.length)) {
      const values = Array.from(value)
      if (values.every((item) => Number.isInteger(item))) {
        target.__recordArray?.(`assign-value:${value.length}`, values, new Error().stack)
      }
    }
    return value
  },
}
const context = new Proxy(target, {
  get(object, property) {
    if (!(property in object) && typeof property === 'string') {
      console.error('missing global', property)
    }
    return object[property]
  },
  set(object, property, value) {
    writes.push({ property: String(property), type: typeof value })
    object[property] = value
    return true
  },
})

target.global = context
target.globalThis = context
target.window = context
target.location = new URL('https://www.xiaohongshu.com/explore')
target.navigator = {
  language: 'zh-CN',
  languages: ['zh-CN', 'zh'],
  platform: 'Win32',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
}
target.screen = { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 }
vm.createContext(context)
const arrayRecords = []
target.__recordArray = (kind, values, stack) => {
  if (arrayRecords.length >= 500) return
  arrayRecords.push({ kind, values, stack })
}
vm.runInContext(`
  (() => {
    const originalPush = Array.prototype.push;
    const originalJoin = Array.prototype.join;
    const originalSlice = Array.prototype.slice;
    Array.prototype.push = function (...values) {
      const result = originalPush.apply(this, values);
      if ([16, 44, 52, 60].includes(this.length)
        && this.every((value) => Number.isInteger(value))) {
        __recordArray('push:' + this.length, this.slice(), new Error().stack);
      }
      return result;
    };
    Array.prototype.join = function (...args) {
      const result = originalJoin.apply(this, args);
      if (result.length === 16) {
        __recordArray('join:16:' + result, originalSlice.call(this), new Error().stack);
      }
      return result;
    };
    Array.prototype.slice = function (...args) {
      const result = originalSlice.apply(this, args);
      if (result.length === 16 && result.every((value) => Number.isInteger(value))) {
        __recordArray('slice:16', result, new Error().stack);
      }
      return result;
    };
  })();
`, context)
const ContextFunction = vm.runInContext('(function() {}).constructor', context)
target.Function = new Proxy(ContextFunction, {
  apply(callable, thisValue, args) {
    generatedSources.push(args.map(String))
    return Reflect.apply(callable, thisValue, args)
  },
  construct(callable, args, newTarget) {
    generatedSources.push(args.map(String))
    return Reflect.construct(callable, args, newTarget)
  },
})
const scriptErrors = []
const literalStrings = new Set()
for (const inputPath of inputPaths) {
  const rawSource = readFileSync(inputPath, 'utf8')
  for (const match of rawSource.matchAll(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)) {
    try {
      literalStrings.add(vm.runInNewContext(match[0]))
    } catch {}
  }
  const source = rawSource
    .replaceAll(
      'new _0x795c5c[_0x17e91c]()',
      '__probeNew(_0x795c5c[_0x17e91c], _0x17e91c, _0x795c5c)',
    )
    .replaceAll(
      "i5[nq(RQ.U)](U['cMfnX'](typeof i4['_sabo_93a3'],nq(0x27b))?D:i4[nq(RQ.b)],i3)",
      "__probeApply(i5,U['cMfnX'](typeof i4['_sabo_93a3'],nq(0x27b))?D:i4[nq(RQ.b)],i3,i4)",
    )
    .replaceAll(
      '_0x795c5c[_0x17e91c][_0x795c5c[_0x17e91c+0x1]]',
      '__probeGet(_0x795c5c[_0x17e91c],_0x795c5c[_0x17e91c+0x1])',
    )
    .replaceAll(
      'F0[C4(0x1fd)][F0[C4(R9.h)]]=F1',
      '__probeAssign(F0[C4(0x1fd)],F0[C4(R9.h)],F1)',
    )
  try {
    vm.runInContext(source, context, { filename: inputPath, timeout: 10_000 })
  } catch (error) {
    scriptErrors.push({ inputPath, error: String(error), stack: error.stack })
    break
  }
}

const exported = Object.fromEntries(
  writes.map(({ property }) => property).map((property) => {
    const value = target[property]
    if (typeof value === 'function') {
      return [property, { type: 'function', name: value.name, length: value.length }]
    }
    if (typeof value === 'string') {
      return [property, value.length > 500 ? `${value.slice(0, 500)}... (${value.length})` : value]
    }
    if (value && typeof value === 'object') {
      return [property, { type: value.constructor?.name ?? 'object', keys: Object.keys(value).slice(0, 20) }]
    }
    return [property, value]
  }),
)
const calls = {}
const captureCall = async (name, callback) => {
  try {
    calls[name] = await callback()
  } catch (error) {
    calls[name] = { error: String(error), stack: error.stack }
  }
}
if (typeof target._dsf === 'function') {
  try {
    calls._dsf = target._dsf()
  } catch (error) {
    calls._dsf = { error: String(error), stack: error.stack }
  }
}
if (typeof target.A === 'function') {
  calls.A = Object.fromEntries([507, 570, 591, 635, 793, 816].map((index) => [index, target.A(index)]))
}
if (typeof target.F === 'function') {
  calls.FStrings = target.F()
    .map((value, index) => ({ index, value }))
    .filter(({ value }) => typeof value === 'string' && value.length >= 8 && value.length <= 80)
}
if (typeof target._webmsxyw === 'function') {
  await captureCall('_webmsxyw', () => target._webmsxyw())
  await captureCall('_webmsxywFeed', () => target._webmsxyw(
    '/api/sns/web/v1/feed',
    { source_note_id: '6a41f69d00000000160252c9' },
  ))
}

const digestInput = {
  path: '/api/sns/web/v1/feed',
  body: '{"source_note_id":"6a41f69d00000000160252c9"}',
  timestamp: '1785147000000',
}
const digestValues = {
  path: digestInput.path,
  body: digestInput.body,
  pathBody: digestInput.path + digestInput.body,
  bodyPath: digestInput.body + digestInput.path,
  urlPath: 'url=' + digestInput.path,
  urlPathBody: 'url=' + digestInput.path + digestInput.body,
  pathBodyTimestamp: digestInput.path + digestInput.body + digestInput.timestamp,
  timestampPathBody: digestInput.timestamp + digestInput.path + digestInput.body,
}
const digestCandidates = Object.fromEntries(Object.entries(digestValues).map(([name, value]) => [
  name,
  Object.fromEntries(['md5', 'sha1', 'sha256'].map((algorithm) => [
    algorithm,
    createHash(algorithm).update(value).digest('hex'),
  ])),
]))
const plaintextBlock = Buffer.from('eDE9MDA4Y2Y0M2Ey')
const keyText = Buffer.from('4uzjr7mbsibcaldp')
const keyCandidates = {
  direct: keyText,
  md5: createHash('md5').update(keyText).digest(),
  sha256: createHash('sha256').update(keyText).digest().subarray(0, 16),
}
const aesCandidates = Object.fromEntries(Object.entries(keyCandidates).map(([name, key]) => {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  cipher.setAutoPadding(false)
  return [name, Buffer.concat([cipher.update(plaintextBlock), cipher.final()]).toString('hex')]
}))
const transpose4 = (input) => Buffer.from(Array.from({ length: 16 }, (_, index) => {
  const row = Math.floor(index / 4)
  const column = index % 4
  return input[column * 4 + row]
}))
const reverseWords = (input) => Buffer.from(Array.from({ length: 16 }, (_, index) => {
  const word = Math.floor(index / 4)
  return input[word * 4 + (3 - (index % 4))]
}))
const reverseAll = (input) => Buffer.from(input).reverse()
const layouts = {
  identity: (input) => Buffer.from(input),
  transpose4,
  reverseWords,
  reverseAll,
  transposeReverseWords: (input) => transpose4(reverseWords(input)),
  reverseWordsTranspose: (input) => reverseWords(transpose4(input)),
}
const expectedFirstBlock = '534e71815a6b794e652929f843f728fc'
const aesLayoutMatches = []
for (const [inputName, inputLayout] of Object.entries(layouts)) {
  for (const [keyName, keyLayout] of Object.entries(layouts)) {
    const cipher = createCipheriv('aes-128-ecb', keyLayout(keyText), null)
    cipher.setAutoPadding(false)
    const encrypted = Buffer.concat([cipher.update(inputLayout(plaintextBlock)), cipher.final()])
    for (const [outputName, outputLayout] of Object.entries(layouts)) {
      const result = outputLayout(encrypted).toString('hex')
      if (result === expectedFirstBlock) aesLayoutMatches.push({ inputName, keyName, outputName })
    }
  }
}
const ivBytes = Buffer.from('4uzjr7mbsibcaldp')
const keySearchMatches = []
const testedKeys = new Set()
const testKey = (source, derivation, key) => {
  const keyHex = key.toString('hex')
  if (testedKeys.has(keyHex)) return
  testedKeys.add(keyHex)
  const cipher = createCipheriv('aes-128-cbc', key, ivBytes)
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(plaintextBlock), cipher.final()]).toString('hex')
  if (encrypted === expectedFirstBlock) keySearchMatches.push({ source, derivation, keyHex })
}
for (const value of literalStrings) {
  if (typeof value !== 'string') continue
  const encoded = Buffer.from(value)
  if (encoded.length === 16) testKey(value, 'direct', encoded)
  if (encoded.length >= 16 && encoded.length <= 256) {
    for (let offset = 0; offset <= encoded.length - 16; offset++) {
      testKey(value, `substring:${offset}`, encoded.subarray(offset, offset + 16))
    }
  }
  testKey(value, 'md5', createHash('md5').update(encoded).digest())
  testKey(value, 'sha256', createHash('sha256').update(encoded).digest().subarray(0, 16))
}
if (target.xhsFingerprintV3) {
  await captureCall('getCurMiniUa', () => target.xhsFingerprintV3.getCurMiniUa())
  await captureCall('getV18', () => target.xhsFingerprintV3.getV18())
}
const dsFunctionNames = [
  '_0c6b9e549fef9ab9b4798ad1f12ea82b',
  '_1619d69735e1d480a72d7e01c4a40b7f',
  '_5616f326aabc524df57a5dcc766497a0',
  '_f26d64f11eb0f2731d1d03fabcf87c5c',
]
for (const name of dsFunctionNames) {
  const callable = target[name]
  if (typeof callable !== 'function') continue
  await captureCall(`${name}:empty`, () => callable())
  await captureCall(`${name}:abc`, () => callable('abc'))
  await captureCall(`${name}:bytes`, () => callable(new Uint8Array([97, 98, 99])))
  await captureCall(`${name}:feed`, () => callable(
    '/api/sns/web/v1/feed',
    '{"source_note_id":"6a41f69d00000000160252c9"}',
    1785147000000,
  ))
}
const output = { writes, exported, calls, digestCandidates, aesCandidates, arrayRecords, generatedSources, scriptErrors, keys: Object.keys(target).sort() }
console.log(JSON.stringify(summaryOnly ? {
  digestCandidates,
  aesCandidates,
  aesLayoutMatches,
  keySearch: { candidates: testedKeys.size, matches: keySearchMatches },
  arrayRecords,
  strings: calls.FStrings,
  feed: calls._webmsxywFeed,
  scriptErrors,
} : output, null, 2))

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

async function text(path) {
  return readFile(new URL(path, root), 'utf8')
}

async function json(path) {
  return JSON.parse(await text(path))
}

test('package.json describes one self-contained bundle', async () => {
  const pkg = await json('package.json')
  assert.equal(pkg.name, 'dsh-workspace-status')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'index.js')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.publishConfig.access, 'public')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  for (const id of [
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-ui-session',
  ]) {
    assert.ok(pkg.dsh.client.inject.includes(id), `${id} is injected`)
  }
  assert.match(pkg.dsh.compatibility.dsh, /^>=0\.2\.1-rc\.\d+ <0\.3\.0-0$/)
})

test('the published entries and export map exist', async () => {
  const pkg = await json('package.json')
  for (const [specifier, target] of Object.entries(pkg.exports)) {
    if (target.includes('*')) continue
    const info = await stat(new URL(target, root))
    assert.ok(info.isFile(), `${specifier} → ${target} resolves to a file`)
  }
  for (const entry of pkg.files) {
    if (entry.includes('*')) continue
    const info = await stat(new URL(entry, root))
    assert.ok(info.isFile(), `${entry} exists`)
  }
})

test('the bundle patch inserts exactly this package', async () => {
  const patch = await text('cordis.patch.yml')
  assert.match(patch, /^- insert:/m)
  assert.match(patch, /^\s+- id: workspace-status$/m)
  assert.match(patch, /^\s+name: dsh-workspace-status$/m)
  assert.equal(patch.match(/- insert:/g).length, 1)
})

test('the host half is a well-formed Cordis plugin', async () => {
  const host = await import(new URL('index.js', root))
  assert.equal(host.name, 'workspace-status')
  assert.deepEqual(host.inject, [])
  assert.equal(typeof host.apply, 'function')
})

test('the client half is the classic-script module envelope', async () => {
  const client = await text('client.js')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: 'dsh-workspace-status'/)
  assert.match(client, /factory\(require\)/)
  assert.match(client, /inject: \['slots'\]/)
})

test('locale dictionaries cover the same keys', async () => {
  const en = await json('locale/en.json')
  const zh = await json('locale/zh.json')
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.equal(typeof en.meta.title, 'string')
  assert.equal(typeof zh.meta.title, 'string')
  for (const key of [
    'activity.summary',
    'activity.waiting',
    'activity.running',
    'activity.done',
    'activity.unnamed',
    'activity.more',
    'activity.listSeparator',
  ]) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof zh[key], 'string', `zh.${key}`)
  }
})

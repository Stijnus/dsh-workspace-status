import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

/** A minimal React stand-in: the component only uses createElement/useRef/useMemo. */
function makeReact() {
  const Fragment = Symbol('Fragment')
  return {
    Fragment,
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useRef(initial) {
      return { current: initial }
    },
    useMemo(factory) {
      return factory()
    },
  }
}

/** Load the classic-script envelope under a sandbox and hand back its module. */
function loadClient() {
  let definition
  const window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }
  vm.runInNewContext(source, { window, document: undefined, navigator: undefined, console })
  assert.ok(definition, 'the client half registers through window.__ModuleLoader__.load')
  const react = makeReact()
  const module = definition.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
  return { definition, module, react }
}

/** Load and apply the client half against a fake slots service. */
function mountClient() {
  const { definition, module, react } = loadClient()
  const registrations = []
  const ctx = {
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(spec, component) {
        registrations.push({ spec, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  return { definition, module, react, registrations }
}

function workspace(workspaceId, title, sessionIds) {
  return { workspaceId, title, path: `/${workspaceId}`, sessionIds }
}

/**
 * Render the slot entry with the three standard feeds.
 * `statuses` is an object keyed by session id; missing entries mean "unknown".
 */
function render(component, { items = [], archived = [], sessions = {}, statuses = {} }) {
  const workspaces = { items, archivedSessionIds: archived }
  const sessionState = { byId: sessions }
  const statusMap = new Map(Object.entries(statuses))
  return component({
    useWorkspaces: (selector) => selector(workspaces),
    useSessions: (selector) => selector(sessionState),
    useSessionStatus: (selector) => selector(statusMap),
  })
}

function nodes(tree, out = []) {
  if (tree === null || tree === undefined) return out
  if (Array.isArray(tree)) {
    for (const child of tree) nodes(child, out)
    return out
  }
  if (typeof tree !== 'object') return out
  out.push(tree)
  for (const child of tree.children ?? []) nodes(child, out)
  return out
}

function styleText(tree) {
  const style = nodes(tree).find((node) => node.type === 'style')
  assert.ok(style, 'the entry publishes a stylesheet')
  assert.equal(style.props['data-plugin-css'], 'dsh-workspace-status/rows.css')
  return style.children.join('')
}

function srText(tree) {
  const span = nodes(tree).find((node) => node.type === 'span' && node.props.className === 'dsws-sr')
  assert.ok(span, 'the entry publishes a hidden description')
  return span.children.join('')
}

const NOW = Date.now()

test('the module registers exactly one additive footer entry', () => {
  const { definition, module, registrations } = mountClient()
  assert.equal(definition.id, 'dsh-workspace-status')
  assert.equal(typeof definition.factory, 'function')
  assert.equal(module.name, 'workspace-status')
  assert.equal(module.inject.length, 1)
  assert.equal(module.inject[0], 'slots')
  assert.equal(registrations.length, 1)
  const [{ spec }] = registrations
  assert.equal(spec.name, 'sidebar.footer.action')
  assert.equal(spec.id, 'workspace-status')
  assert.equal(typeof spec.order, 'number')
})

test('renders nothing when the standard hooks are absent', () => {
  const { registrations } = mountClient()
  assert.equal(registrations[0].component({}), null)
})

test('the session summary is the fallback when the status feed is unknown', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: { s1: { running: true, updatedAt: NOW } },
    statuses: {},
  })
  assert.ok(styleText(tree).includes('[data-row-key="workspace:api"]::after'))
})

test('an idle workspace publishes nothing', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: { s1: { running: false, updatedAt: NOW } },
    statuses: { s1: { running: false, completionUnread: false } },
  })
  assert.equal(tree, null)
})

test('a running session marks its workspace with the running ring', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1']), workspace('web', 'Web', ['s2'])],
    sessions: {
      s1: { running: true, updatedAt: NOW },
      s2: { running: false, updatedAt: NOW },
    },
    statuses: {
      s1: { running: true, completionUnread: false },
      s2: { running: false, completionUnread: false },
    },
  })
  const css = styleText(tree)
  assert.ok(css.includes('[data-row-key="workspace:api"]::after'))
  assert.ok(css.includes('dsws-spin'))
  assert.ok(css.includes('--dsw-static-deepseek-450'))
  assert.ok(!css.includes('workspace:web'))
  assert.match(srText(tree), /1 running/)
  assert.match(srText(tree), /API/)
})

test('waiting for the user outranks running and uses the warning color', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: { s1: { running: true, updatedAt: NOW } },
    statuses: { s1: { running: true, pendingInteraction: { kind: 'approval' } } },
  })
  const css = styleText(tree)
  assert.ok(css.includes('[data-row-key="workspace:api"]::after'))
  assert.ok(css.includes('--dsw-alias-state-warn-primary'))
  assert.ok(!css.includes('dsws-spin'))
  assert.match(srText(tree), /1 waiting for you/)
})

test('a running subagent keeps its parent workspace busy', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: {
      s1: { running: false, updatedAt: NOW },
      s9: { running: true, updatedAt: 0, origin: 'subagent', parentId: 's1' },
    },
    statuses: {
      s1: { running: false, completionUnread: false },
      s9: { running: true },
    },
  })
  const css = styleText(tree)
  assert.ok(css.includes('[data-row-key="workspace:api"]::after'))
  assert.ok(css.includes('dsws-spin'))
})

test('archived sessions never mark a workspace', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    archived: ['s1'],
    sessions: { s1: { running: true, updatedAt: NOW } },
    statuses: { s1: { running: true } },
  })
  assert.equal(tree, null)
})

test('a recently finished unread session marks the workspace green', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: { s1: { running: false, updatedAt: NOW - 60_000 } },
    statuses: { s1: { running: false, completionUnread: true } },
  })
  const css = styleText(tree)
  assert.ok(css.includes('[data-row-key="workspace:api"]::after'))
  assert.ok(css.includes('--dsw-alias-state-success-primary'))
  assert.match(srText(tree), /1 recently finished/)
})

test('a stale unread completion does not mark the workspace', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: { s1: { running: false, updatedAt: NOW - 2 * 60 * 60 * 1000 } },
    statuses: { s1: { running: false, completionUnread: true } },
  })
  assert.equal(tree, null)
})

test('sessions outside every workspace mark the ungrouped bucket', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('api', 'API', ['s1'])],
    sessions: {
      s1: { running: false, updatedAt: NOW },
      s2: { running: true, updatedAt: NOW },
    },
    statuses: {
      s1: { running: false, completionUnread: false },
      s2: { running: true },
    },
  })
  const css = styleText(tree)
  assert.ok(css.includes('[data-row-key="workspace:"]::after'))
  assert.match(srText(tree), /Ungrouped/)
})

test('each state groups its workspaces into one selector list', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [
      workspace('api', 'API', ['s1']),
      workspace('web', 'Web', ['s2']),
      workspace('docs', 'Docs', ['s3']),
    ],
    sessions: {
      s1: { running: false, updatedAt: NOW },
      s2: { running: true, updatedAt: NOW },
      s3: { running: true, updatedAt: NOW },
    },
    statuses: {
      s1: { running: false, pendingInteraction: { kind: 'question' } },
      s2: { running: true },
      s3: { running: true },
    },
  })
  const css = styleText(tree)
  // Keys are sorted, so the shared running rule lists docs before web.
  assert.ok(css.includes('[data-row-key="workspace:docs"]::after,[data-row-key="workspace:web"]::after'))
  assert.match(srText(tree), /1 waiting for you/)
  assert.match(srText(tree), /2 running/)
  assert.match(srText(tree), /API/)
  assert.match(srText(tree), /Web/)
})

test('group keys are escaped for the CSS attribute string', () => {
  const { module } = loadClient()
  const { quote } = module.__test
  assert.equal(quote('plain'), 'plain')
  assert.equal(quote('a"b'), 'a\\"b')
  assert.equal(quote('a\\b'), 'a\\\\b')
  assert.equal(quote('a\nb'), 'a\\a b')
})

test('the finished window is one hour', () => {
  const { module } = loadClient()
  assert.equal(module.__test.FINISHED_WINDOW_MS, 60 * 60 * 1000)
})

test('the hidden description is bounded to four workspace names', () => {
  const { registrations } = mountClient()
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => workspace(id, id.toUpperCase(), [`s-${id}`]))
  const sessions = {}
  const statuses = {}
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    sessions[`s-${id}`] = { running: true, updatedAt: NOW }
    statuses[`s-${id}`] = { running: true }
  }
  const tree = render(registrations[0].component, { items, sessions, statuses })
  const text = srText(tree)
  assert.match(text, /5 running/)
  assert.match(text, /and 1 more/)
})

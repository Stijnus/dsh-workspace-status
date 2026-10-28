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
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
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
    if (name === 'react-dom') return { createPortal: (children) => children }
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
function render(component, { items = [], archived = [], pinned = [], sessions = {}, statuses = {} }) {
  const workspaces = { items, archivedSessionIds: archived, pinnedSessionIds: pinned }
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
  assert.equal(style.props['data-plugin-css'], 'dsh-workspace-status/sidebar.css')
  return style.children.join('')
}

function srText(tree) {
  const span = nodes(tree).find((node) => node.type === 'span' && node.props.className === 'dsws-sr')
  return span === undefined ? null : span.children.join('')
}

const NOW = Date.now()

test('the module registers the footer entry and the quiet star-suite settings link', () => {
  const { definition, module, registrations } = mountClient()
  assert.equal(definition.id, 'dsh-workspace-status')
  assert.equal(typeof definition.factory, 'function')
  assert.equal(module.name, 'workspace-status')
  assert.equal(module.inject.length, 1)
  assert.equal(module.inject[0], 'slots')
  assert.equal(registrations.length, 2)
  const footer = registrations.find((entry) => entry.spec.name === 'sidebar.footer.action')
  assert.ok(footer, 'the footer entry is registered')
  assert.equal(footer.spec.id, 'workspace-status')
  assert.equal(typeof footer.spec.order, 'number')
  const star = registrations.find((entry) => entry.spec.name === 'settings.general.item')
  assert.ok(star, 'the quiet star link registers as a settings item')
  assert.equal(star.spec.id, 'workspace-status-star')
  assert.ok(!registrations.some((entry) => entry.spec.name === 'shell.overlay'), 'no timed star popup registers on the shell overlay')
})

test('renders nothing visible when the standard hooks are absent', () => {
  const { registrations } = mountClient()
  const tree = registrations[0].component({})
  assert.ok(!styleText(tree).includes('::after'))
  assert.equal(srText(tree), null)
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
  const css = styleText(tree)
  assert.ok(!css.includes('::after'))
  assert.equal(srText(tree), null)
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
  // The shared `@keyframes dsws-spin` is always present; the running RULE is not.
  assert.ok(!css.includes('[data-row-key="workspace:api"]::after{content:"";flex:none;box-sizing:border-box;width:10px'))
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
  const css = styleText(tree)
  assert.ok(!css.includes('::after'))
  assert.equal(srText(tree), null)
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
  const css = styleText(tree)
  assert.ok(!css.includes('::after'))
  assert.equal(srText(tree), null)
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

const PIN_NOW = Date.now()

function pinnedItems() {
  return [
    workspace('w-api', 'api', ['s1', 's2', 'u']),
    workspace('w-web', 'web', ['s3']),
  ]
}

function pinnedSessions() {
  return {
    s1: { id: 's1', displayTitle: 'API one', updatedAt: PIN_NOW, running: false },
    s2: { id: 's2', displayTitle: 'API two', updatedAt: PIN_NOW - 60_000, running: false },
    s3: { id: 's3', displayTitle: 'Web one', updatedAt: PIN_NOW - 3 * 60 * 60 * 1000, running: false },
    u: { id: 'u', displayTitle: 'Ungrouped one', updatedAt: PIN_NOW, running: false },
  }
}

test('pinned sessions group per workspace in workspace order', () => {
  const { module } = loadClient()
  const { buildPinnedView } = module.__test
  const statuses = new Map([['s1', { running: true }]])
  const view = buildPinnedView(['s3', 's2', 's1'], pinnedItems(), pinnedSessions(), statuses, [], PIN_NOW)
  assert.equal(view.groups.map((group) => group.key).join(','), 'w-api,w-web')
  assert.equal(view.groups[0].sessions.map((session) => session.id).join(','), 's2,s1')
  assert.equal(view.groups[1].sessions.map((session) => session.id).join(','), 's3')
  assert.equal(view.total, 3)
  assert.equal(view.ids.join(','), 's2,s1,s3')
  assert.equal(view.groups[0].sessions[1].mark, 'ongoing')
  assert.equal(view.groups[0].sessions[1].title, 'API one')
})

test('the pinned view skips archived, blank and subagent rows and ends ungrouped', () => {
  const { module } = loadClient()
  const { buildPinnedView } = module.__test
  const items = [workspace('w1', 'one', ['a', 'b', 'c', 'd'])]
  const sessions = {
    a: { id: 'a', displayTitle: 'A', updatedAt: PIN_NOW, running: false },
    b: { id: 'b', displayTitle: 'B', updatedAt: PIN_NOW, running: false },
    c: { id: 'c', displayTitle: '', updatedAt: PIN_NOW, running: false, blank: true },
    d: { id: 'd', displayTitle: 'D', updatedAt: 0, running: false, origin: 'subagent', parentId: 'a' },
    u: { id: 'u', displayTitle: 'U', updatedAt: PIN_NOW, running: false },
  }
  const view = buildPinnedView(['a', 'b', 'c', 'd', 'u'], items, sessions, undefined, ['b'], PIN_NOW)
  assert.equal(view.groups.map((group) => group.key).join(','), 'w1,')
  assert.equal(view.groups[0].sessions.map((session) => session.id).join(','), 'a')
  assert.equal(view.groups[1].sessions.map((session) => session.id).join(','), 'u')
  assert.equal(view.total, 2)
  // Blank and subagent rows have no ordinary row to lift; missing summaries are skipped too.
  assert.equal(buildPinnedView(['nope'], items, sessions, undefined, [], PIN_NOW).ids.length, 0)
})

test('session marks follow the shipped wait > run > finish precedence', () => {
  const { module } = loadClient()
  const { sessionMark } = module.__test
  const sessions = { s1: { running: false } }
  const statuses = new Map([
    ['s1', { running: true, pendingInteraction: { kind: 'approval' } }],
    ['s2', { running: true }],
    ['s3', { running: false, completionUnread: true }],
    ['s4', { running: false, completionUnread: false }],
  ])
  assert.equal(sessionMark('s1', sessions.s1, statuses, new Map(), sessions), 'warning')
  assert.equal(sessionMark('s2', {}, statuses, new Map(), sessions), 'ongoing')
  assert.equal(sessionMark('s3', {}, statuses, new Map(), sessions), 'done')
  assert.equal(sessionMark('s4', {}, statuses, new Map(), sessions), undefined)
  assert.equal(sessionMark('s5', { running: true }, undefined, new Map(), sessions), 'ongoing')
})

test('the hide rules lift only the rows the pinned section actually shows', () => {
  const { module } = loadClient()
  const { hideCss } = module.__test
  assert.equal(hideCss([]), '')
  const css = hideCss(['a', 'b"c'])
  assert.ok(css.includes('[data-row-key="session:a"]'))
  assert.ok(css.includes('display:none!important'))
  assert.ok(css.includes('[data-row-key="session:b\\"c"]'))
})

test('relative labels match the sidebar vocabulary', () => {
  const { module } = loadClient()
  const { relativeTime } = module.__test
  assert.equal(relativeTime(PIN_NOW, PIN_NOW), 'now')
  assert.equal(relativeTime(PIN_NOW - 5 * 60_000, PIN_NOW), '5min')
  assert.equal(relativeTime(PIN_NOW - 2 * 60 * 60_000, PIN_NOW), '2h')
  assert.equal(relativeTime(PIN_NOW - 3 * 24 * 60 * 60_000, PIN_NOW), '3d')
  assert.equal(relativeTime(0, PIN_NOW), '')
})

test('without a mounted host the pinned row stays visible in the official list', () => {
  // The hide rules are only emitted once the portal container is attached;
  // if DOM insertion ever fails, sessions must remain reachable in the tree.
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('w-api', 'api', ['s1', 's2'])],
    pinned: ['s1'],
    sessions: {
      s1: { id: 's1', displayTitle: 'One', updatedAt: PIN_NOW, running: false },
      s2: { id: 's2', displayTitle: 'Two', updatedAt: PIN_NOW, running: false },
    },
    statuses: {},
  })
  const css = styleText(tree)
  assert.ok(!css.includes('[data-row-key="session:s1"]'))
  assert.ok(!css.includes('[data-row-key="session:s2"]'))
})

test('an archived pinned session is neither shown nor hidden', () => {
  const { registrations } = mountClient()
  const tree = render(registrations[0].component, {
    items: [workspace('w-api', 'api', ['s1'])],
    archived: ['s1'],
    pinned: ['s1'],
    sessions: { s1: { id: 's1', displayTitle: 'One', updatedAt: PIN_NOW, running: false } },
    statuses: {},
  })
  const css = styleText(tree)
  assert.ok(!css.includes('data-row-key="session:s1"'))
})

test('notification diff is silent on first sight and fires on waiting transitions', () => {
  const { module } = loadClient()
  const { notificationEvents, notificationContent } = module.__test
  const base = { id: 's1', title: 'Book flights', workspace: 'travel', pendingKind: 'approval', running: true, completionUnread: false }
  const first = notificationEvents(new Map(), [base])
  assert.equal(first.events.length, 0)
  const same = notificationEvents(first.next, [base])
  assert.equal(same.events.length, 0)
  const changed = notificationEvents(first.next, [{ ...base, pendingKind: 'question' }])
  assert.equal(changed.events.length, 1)
  assert.equal(changed.events[0].type, 'waiting')
  const cleared = notificationEvents(changed.next, [{ ...base, pendingKind: null, running: false }])
  assert.equal(cleared.events.length, 0)
  const again = notificationEvents(cleared.next, [{ ...base, pendingKind: 'approval', running: true }])
  assert.equal(again.events.length, 1)
  const content = notificationContent(again.events[0])
  assert.match(content.title, /Book flights/)
  assert.match(content.body, /approval/i)
  assert.match(content.body, /travel/)
})

test('finished notifications fire once when a running pinned session stops unread', () => {
  const { module } = loadClient()
  const { notificationEvents } = module.__test
  const running = { id: 's1', title: 'Book flights', workspace: 'travel', pendingKind: null, running: true, completionUnread: false }
  const seen = notificationEvents(new Map(), [running])
  assert.equal(seen.events.length, 0)
  const finished = notificationEvents(seen.next, [{ ...running, running: false, completionUnread: true }])
  assert.equal(finished.events.length, 1)
  assert.equal(finished.events[0].type, 'finished')
  const repeat = notificationEvents(finished.next, [{ ...running, running: false, completionUnread: true }])
  assert.equal(repeat.events.length, 0)
  const late = { id: 's2', title: 'Late', workspace: 'travel', pendingKind: null, running: false, completionUnread: false }
  const lateSeen = notificationEvents(new Map(), [late])
  const lateFinished = notificationEvents(lateSeen.next, [{ ...late, completionUnread: true }])
  assert.equal(lateFinished.events.length, 1)
  assert.equal(lateFinished.events[0].session.id, 's2')
})

test('notification state is pruned when a session stops being pinned', () => {
  const { module } = loadClient()
  const { notificationEvents } = module.__test
  const session = { id: 's1', title: 'One', workspace: 'w', pendingKind: null, running: false, completionUnread: false }
  const first = notificationEvents(new Map(), [session])
  assert.ok(first.next.has('s1'))
  const removed = notificationEvents(first.next, [])
  assert.equal(removed.events.length, 0)
  assert.equal(removed.next.size, 0)
})

test('pinned entries carry the notification facts and workspace title', () => {
  const { module } = loadClient()
  const { buildPinnedView } = module.__test
  const statuses = new Map([['s1', { running: true, pendingInteraction: { kind: 'approval' } }]])
  const view = buildPinnedView(['s1'], pinneededItems(), pinneededSessions(), statuses, [], PIN_NOW)
  const entry = view.groups[0].sessions[0]
  assert.equal(entry.pendingKind, 'approval')
  assert.equal(entry.running, true)
  assert.equal(entry.workspace, 'api')
})

function pinneededItems() {
  return [workspace('w-api', 'api', ['s1'])]
}

function pinneededSessions() {
  return { s1: { id: 's1', displayTitle: 'One', updatedAt: PIN_NOW, running: true } }
}

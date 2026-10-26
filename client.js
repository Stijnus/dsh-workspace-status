/**
 * Browser half of workspace-status.
 *
 * Two surfaces, one plugin:
 *
 * 1. **Workspace-row status marks.** The sidebar draws a status dot on every
 *    Session row but nothing on the Workspace (folder) row above it, so a
 *    collapsed group hides whether a session inside is waiting, running, or
 *    just finished. Workspace rows declare no slot, so the mark is published as
 *    a stylesheet aimed at the row the browser already renders
 *    (`data-row-key="workspace:<id>"`), drawn as its trailing pseudo-element.
 *
 * 2. **Pinned section.** Conversations pinned through the shipped pin action
 *    are lifted out of the regular workspace groups into a dedicated section
 *    above the browsing region, grouped per Workspace with the same header
 *    treatment. The section is rendered through a portal into a container
 *    inserted before the sidebar's region area; the pinned rows are hidden from
 *    the official list with generated `display:none` rules. Pin state is the
 *    registry-global `pinnedSessionIds` feed, so it persists across restarts and
 *    unpinning updates both surfaces immediately.
 *
 * The footer entry stays the mount: it publishes the stylesheet, the hidden
 * description of workspace activity, and the portal host.
 *
 * Data comes from the same public feeds the browser itself reads:
 * `useWorkspaces` (items, archive set, pin set), `useSessions` (summaries,
 * including subagent rows) and `useSessionStatus` (running / pendingInteraction
 * / completionUnread). Pin, unpin and open are the shipped client services
 * (`ctx.workspaces`, `ctx.uiWorkspace`).
 */

window.__ModuleLoader__.load({
  id: 'dsh-workspace-status',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Additive seat beside Settings at the sidebar foot. */
    const SLOT = 'sidebar.footer.action'
    /** Stable list id; reusing it would shadow this entry rather than add one. */
    const ENTRY_ID = 'workspace-status'
    /** The stylesheet this mount owns; unmounting the entry removes it. */
    const STYLE_ID = 'dsh-workspace-status/sidebar.css'
    /** Last among the shipped footer actions. */
    const ENTRY_ORDER = 950

    /**
     * How long a finished-but-unread Session keeps its Workspace marked.
     *
     * The browser's finished reminder persists until the Session is opened.
     * A folder row owns no timestamp that could age it out, so it would keep a
     * green dot on a workspace whose work stopped days ago. This mark is a
     * notice: it lapses once the Session's last update stops reading in
     * minutes. A Session watched stopping keeps the mark for the same window
     * even when its last prompt is older than that.
     */
    const FINISHED_WINDOW_MS = 60 * 60 * 1000

    /** How many workspace names the hidden description lists. */
    const MAX_NAMES = 4

    /** The visually hidden description's class. */
    const SR_CLASS = 'dsws-sr'

    /** Attribute marking the portal container inserted above the browser. */
    const SECTION_ATTR = 'data-dsws-pinned'

    /** Browser-local collapse memory for the pinned section. */
    const VIEW_STORE_KEY = 'dsh-workspace-status/pinned-view/v1'

    /** The insertion anchor: SidebarRoot's region area owns the browsing slot. */
    const REGION_SELECTOR = '[class*="_regionArea"]'

    /**
     * The hidden description's own rule. The visible marks carry no markup of
     * their own, so this sheet only has to keep the description and the portal
     * anchor out of the layout.
     */
    const BASE_CSS = [
      `.${SR_CLASS}{position:absolute;width:1px;height:1px;margin:-1px;padding:0;`,
      'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
      '.dsws-anchor{display:none!important}',
    ].join('')

    /**
     * Every user-facing string lives here rather than in a locale service: the
     * plugin keeps working without the locale face, and the `locale/*.json`
     * files mirror these dictionaries for tooling.
     */
    const DICTIONARIES = {
      en: {
        'activity.summary': 'Workspace activity: {clauses} — {names}',
        'activity.waiting': '{n} waiting for you',
        'activity.running': '{n} running',
        'activity.done': '{n} recently finished',
        'activity.unnamed': 'Ungrouped',
        'activity.more': 'and {n} more',
        'activity.listSeparator': ', ',
        'pinned.title': 'Pinned',
        'pinned.untitled': 'Untitled',
        'pinned.unpin': 'Unpin',
        'pinned.unpinAria': 'Unpin {title}',
        'pinned.sectionAria': 'Pinned conversations',
        'pinned.groupAria': 'Pinned in {workspace}',
        'pinned.rail': 'Pinned conversations',
        'time.now': 'now',
        'time.minutes': '{n}min',
        'time.hours': '{n}h',
        'time.days': '{n}d',
      },
      zh: {
        'activity.summary': '工作区状态：{clauses} — {names}',
        'activity.waiting': '{n} 个等待你处理',
        'activity.running': '{n} 个运行中',
        'activity.done': '{n} 个刚刚完成',
        'activity.unnamed': '未分组',
        'activity.more': '等 {n} 个',
        'activity.listSeparator': '、',
        'pinned.title': '已置顶',
        'pinned.untitled': '未命名',
        'pinned.unpin': '取消置顶',
        'pinned.unpinAria': '取消置顶 {title}',
        'pinned.sectionAria': '已置顶会话',
        'pinned.groupAria': '{workspace} 中的已置顶会话',
        'pinned.rail': '已置顶会话',
        'time.now': '刚刚',
        'time.minutes': '{n} 分钟',
        'time.hours': '{n} 小时',
        'time.days': '{n} 天',
      },
    }

    /**
     * Resolve the host's language without assuming the locale service exists.
     * @returns 'zh' for Chinese hosts, otherwise 'en'.
     */
    function currentLanguage() {
      const candidates = []
      if (typeof document !== 'undefined') {
        const lang = document?.documentElement?.lang
        if (typeof lang === 'string' && lang !== '') candidates.push(lang)
      }
      if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
        candidates.push(navigator.language)
      }
      for (const value of candidates) {
        if (/^zh/i.test(value)) return 'zh'
      }
      return 'en'
    }

    /** Interpolate `{name}` placeholders in one template. */
    function format(template, params) {
      return template.replace(/\{(\w+)\}/g, (match, name) => (
        params !== undefined && Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : match
      ))
    }

    /** One localized message, falling back to English and then the key. */
    function message(key, params) {
      const language = currentLanguage()
      const dictionary = DICTIONARIES[language] ?? DICTIONARIES.en
      const template = dictionary[key] ?? DICTIONARIES.en[key] ?? key
      return format(template, params)
    }

    /**
     * Escape one value for a double-quoted CSS attribute selector.
     *
     * A control character has no literal form inside a CSS string: an unescaped
     * newline ends the string token and the whole rule is dropped as invalid.
     * Each one is written as a hex escape with a trailing space, which stops a
     * following hex digit being absorbed. Host ids are UUIDs, so this is a
     * correctness guard, not a path expected in practice.
     * @param value - raw id or key.
     * @returns the value escaped for use inside quotes.
     */
    function quote(value) {
      let escaped = ''
      for (const char of String(value)) {
        const code = char.codePointAt(0) ?? 0
        if (char === '\\' || char === '"') escaped += `\\${char}`
        else if (code < 0x20 || code === 0x7f) escaped += `\\${code.toString(16)} `
        else escaped += char
      }
      return escaped
    }

    /**
     * The running mark, carried as an alpha mask rather than a border.
     *
     * A CSS border ring cannot read as a circle at this size: its corners are
     * mitred, so the gap between the two ends looks like a clipped square. The
     * mask keeps a round stroke with round caps and a faint track, matching the
     * geometry of the product's own running indicator.
     */
    const RING = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='4' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round' stroke-opacity='.25'/%3E%3Ccircle cx='5' cy='5' r='4' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='5 20'/%3E%3C/svg%3E\")"

    /** The sidebar's own right-pointing disclosure triangle, drawn inline. */
    const CHEVRON_PATH = 'M3.4 2.05 9.4 8l-6 5.95V2.05z'

    /** Closed-folder glyph in the shell's 16px slot. */
    const FOLDER_PATH = 'M1.6 3.9c0-.66.54-1.2 1.2-1.2h3.02c.32 0 .62.13.85.36l.7.7c.22.23.53.36.85.36h4.58c.66 0 1.2.54 1.2 1.2v7.03c0 .66-.54 1.2-1.2 1.2H2.8c-.66 0-1.2-.54-1.2-1.2V3.9z'

    /** Material push-pin path on a 24px grid. */
    const PIN_PATH = 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z'

    /** Render the disclosure triangle, rotated by the caller's CSS class. */
    function chevronIcon() {
      return h('svg', {
        width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: CHEVRON_PATH, fill: 'currentColor' }))
    }

    /** Render the closed-folder glyph. */
    function folderIcon() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: FOLDER_PATH, fill: 'currentColor' }))
    }

    /** Render the push-pin glyph used by the section header and row buttons. */
    function pinIcon(size = 14) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', { d: PIN_PATH, fill: 'currentColor' }))
    }

    /**
     * One Workspace's tally before the states are split.
     * @typedef {{ key: string, title: string, waiting: number, running: number, done: number }} GroupTally
     */

    /**
     * Whether a Session's own timestamp is recent enough to still deserve a
     * finished mark. A missing or zero timestamp cannot be corroborated, so it
     * never earns one (subagent rows carry a zero timestamp).
     * @param updatedAt - the Session summary's epoch-millisecond timestamp.
     * @param now - render-time clock.
     * @returns true while the timestamp reads within the notice window.
     */
    function isFresh(updatedAt, now) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return false
      return now - updatedAt <= FINISHED_WINDOW_MS
    }

    /**
     * What this mount has watched happen, keyed by Session id.
     *
     * `running` holds every Session seen running since the mount; `stoppedAt`
     * holds the time a Session was watched stop while still carrying the unread
     * mark, and only for Sessions first seen running. Together they let the
     * finished mark expire on its own rather than wait for the browser to clear
     * it — and they cover a Session that ran for hours, whose `updatedAt` is
     * the time of its last prompt, not the time it stopped.
     * @typedef {{ running: Set<string>, stoppedAt: Map<string, number> }} Watch
     */

    /** Drop one Session from the watch (archived or gone). */
    function forget(watch, sessionId) {
      watch.running.delete(sessionId)
      watch.stoppedAt.delete(sessionId)
    }

    /** Whether any direct subagent child of one Session is currently running. */
    function runsChild(sessionId, children, sessions, statuses) {
      const kids = children.get(sessionId)
      if (kids === undefined) return false
      for (const childId of kids) {
        const status = statuses?.get?.(childId)
        // The status feed is authoritative where it knows the child; the
        // summary's own running flag is the fallback, matching the browser's
        // precedence.
        const running = status?.running === undefined
          ? sessions[childId]?.running === true
          : status.running === true
        if (running) return true
      }
      return false
    }

    /** Direct subagent children per parent Session id. */
    function childMap(sessions) {
      const children = new Map()
      for (const sessionId of Object.keys(sessions)) {
        const row = sessions[sessionId]
        if (row?.origin !== 'subagent' || typeof row.parentId !== 'string') continue
        const list = children.get(row.parentId)
        if (list === undefined) children.set(row.parentId, [sessionId])
        else list.push(sessionId)
      }
      return children
    }

    /**
     * One Session's live mark, matching the shipped row precedence.
     * @param sessionId - Session to classify.
     * @param row - its summary.
     * @param statuses - Session UI status map.
     * @param children - subagent children map.
     * @param sessions - all summaries (subagent fallback).
     * @returns `warning`, `ongoing`, `done`, or undefined for idle.
     */
    function sessionMark(sessionId, row, statuses, children, sessions) {
      const status = statuses?.get?.(sessionId)
      if (status?.pendingInteraction !== undefined && status?.pendingInteraction !== null) return 'warning'
      const running = status?.running === true
        || (status?.running === undefined && row?.running === true)
        || runsChild(sessionId, children, sessions, statuses)
      if (running) return 'ongoing'
      if (status?.completionUnread === true) return 'done'
      return undefined
    }

    /**
     * Which Workspace groups own a waiting, running, or just-finished Session.
     *
     * Precedence matches the shipped Session row: waiting for the user outranks
     * running, which outranks the finished reminder. Each Session therefore
     * lands in exactly one tally, so the counts in the hidden description add
     * up to the number of marked Sessions. Archived Sessions are skipped, the
     * same way the default browser view hides them. A running subagent keeps
     * its parent's Workspace busy even when the parent turn already settled;
     * subagent rows are not workspace members, so they never create a mark of
     * their own.
     *
     * @param items - Workspace rows from the Workspace snapshot.
     * @param byId - Session summaries keyed by id.
     * @param statuses - Session UI status map (running / pendingInteraction / completionUnread).
     * @param archivedSessionIds - registry-global archive set.
     * @param now - render-time clock, epoch milliseconds.
     * @param watch - this mount's running/stopped observations.
     * @returns marked group keys by state, counts, and display titles.
     */
    function deriveActivity(items, byId, statuses, archivedSessionIds, now, watch) {
      const sessions = byId !== null && typeof byId === 'object' ? byId : {}
      const archived = new Set(Array.isArray(archivedSessionIds) ? archivedSessionIds : [])
      const statusMap = statuses !== null && typeof statuses?.get === 'function' ? statuses : undefined

      /** Session id → owning Workspace key (ungrouped bucket is `''`). */
      const workspaceOf = new Map()
      /** Workspace key → display title. */
      const titles = new Map()
      for (const workspace of Array.isArray(items) ? items : []) {
        if (workspace === null || typeof workspace !== 'object') continue
        const key = typeof workspace.workspaceId === 'string' ? workspace.workspaceId : ''
        titles.set(key, typeof workspace.title === 'string' ? workspace.title : '')
        for (const sessionId of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
          workspaceOf.set(sessionId, key)
        }
      }

      const children = childMap(sessions)

      /** @type {Map<string, GroupTally>} */
      const groups = new Map()
      const tally = (key) => {
        let group = groups.get(key)
        if (group === undefined) {
          group = { key, title: titles.get(key) ?? '', waiting: 0, running: 0, done: 0 }
          groups.set(key, group)
        }
        return group
      }

      for (const sessionId of Object.keys(sessions).sort()) {
        const row = sessions[sessionId]
        if (row === null || row === undefined) continue
        if (row.origin === 'subagent') continue
        if (archived.has(sessionId)) {
          forget(watch, sessionId)
          continue
        }

        const status = statusMap?.get?.(sessionId)
        const running = status?.running === true
          || (status?.running === undefined && row.running === true)
          || runsChild(sessionId, children, sessions, statusMap)
        const waiting = status?.pendingInteraction !== undefined && status?.pendingInteraction !== null

        if (running) {
          watch.running.add(sessionId)
          watch.stoppedAt.delete(sessionId)
        } else if (watch.running.delete(sessionId) && status?.completionUnread === true) {
          watch.stoppedAt.set(sessionId, now)
        }

        const recent = isFresh(row.updatedAt, now)
          || (watch.stoppedAt.get(sessionId) !== undefined
            && now - watch.stoppedAt.get(sessionId) <= FINISHED_WINDOW_MS)
        const key = workspaceOf.has(sessionId) ? workspaceOf.get(sessionId) : ''

        if (waiting) {
          tally(key).waiting += 1
        } else if (running) {
          tally(key).running += 1
        } else if (status?.completionUnread === true && recent) {
          tally(key).done += 1
        }
      }

      // Prune observations that can no longer produce a mark.
      for (const sessionId of watch.running) {
        if (sessions[sessionId] === undefined) watch.running.delete(sessionId)
      }
      for (const [sessionId, stoppedAt] of watch.stoppedAt) {
        if (sessions[sessionId] === undefined || now - stoppedAt > FINISHED_WINDOW_MS) {
          watch.stoppedAt.delete(sessionId)
        }
      }

      const waitingKeys = []
      const runningKeys = []
      const doneKeys = []
      const names = new Map()
      const totals = { waiting: 0, running: 0, done: 0 }
      let marked = 0
      for (const group of groups.values()) {
        const total = group.waiting + group.running + group.done
        if (total === 0) continue
        if (group.waiting > 0) waitingKeys.push(group.key)
        else if (group.running > 0) runningKeys.push(group.key)
        else doneKeys.push(group.key)
        totals.waiting += group.waiting
        totals.running += group.running
        totals.done += group.done
        marked += total
        names.set(group.key, group.title)
      }
      waitingKeys.sort()
      runningKeys.sort()
      doneKeys.sort()

      return { waiting: waitingKeys, running: runningKeys, done: doneKeys, totals, marked, names }
    }

    /**
     * The selectors for one state's rows, each carrying its own pseudo-element.
     *
     * Every rule repeats the whole selector list. A comma-joined list applies
     * the trailing `::after` to its last member only, so sharing one prefix
     * would leave every row but one undecorated once two Workspaces share a
     * state.
     */
    function selectors(keys, suffix) {
      return keys.map((key) => `[data-row-key="workspace:${quote(key)}"]${suffix}`).join(',')
    }

    /**
     * The stylesheet that draws each marked row's trailing mark.
     *
     * The mark is the row's `::after`, a flex child at the empty right-hand end
     * beside the row actions, so it never displaces the title and needs no
     * positioning. Waiting is a solid amber dot, running is the product's blue
     * as a stroked ring, finished is the product's green dot. Colors come from
     * the same theme tokens the Session rows use, so both levels agree and both
     * themes are covered.
     * @param activity - derived activity for the current render.
     * @returns CSS text (no base rules).
     */
    function rowCss(activity) {
      const parts = []

      if (activity.waiting.length > 0) {
        const waiting = selectors(activity.waiting, '::after')
        parts.push(
          `${waiting}{content:"";flex:none;box-sizing:border-box;width:6px;height:6px;`,
          'margin-inline-start:2px;border-radius:50%;',
          'background:var(--dsw-alias-state-warn-primary);',
          'box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)}',
        )
      }

      if (activity.running.length > 0) {
        const running = selectors(activity.running, '::after')
        parts.push(
          `${running}{content:"";flex:none;box-sizing:border-box;width:10px;height:10px;`,
          'margin-inline-start:2px;background-color:var(--dsw-static-deepseek-450);',
          `-webkit-mask-image:${RING};mask-image:${RING};`,
          '-webkit-mask-size:100% 100%;mask-size:100% 100%;',
          '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;',
          'animation:dsws-spin 1.5s linear infinite}',
          `@media (prefers-reduced-motion:reduce){${running}{animation:none;opacity:.7}}`,
        )
      }

      if (activity.done.length > 0) {
        const done = selectors(activity.done, '::after')
        parts.push(
          `${done}{content:"";flex:none;box-sizing:border-box;width:6px;height:6px;`,
          'margin-inline-start:2px;border-radius:50%;',
          'background:var(--dsw-alias-state-success-primary);',
          'box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}',
        )
      }

      return parts.join('')
    }

    /**
     * The hidden description of the same state.
     *
     * Pseudo-elements are not reliably announced, so the aggregate travels as
     * text: counts by state followed by the Workspace names, bounded so a large
     * fleet does not turn into a paragraph.
     * @param activity - derived activity for the current render.
     * @returns one localized sentence.
     */
    function describe(activity) {
      const separator = message('activity.listSeparator')
      const clauses = []
      if (activity.totals.waiting > 0) {
        clauses.push(message('activity.waiting', { n: activity.totals.waiting }))
      }
      if (activity.totals.running > 0) {
        clauses.push(message('activity.running', { n: activity.totals.running }))
      }
      if (activity.totals.done > 0) {
        clauses.push(message('activity.done', { n: activity.totals.done }))
      }
      const orderedKeys = [...activity.waiting, ...activity.running, ...activity.done]
      const names = orderedKeys.map((key) => {
        const title = activity.names.get(key)
        return title !== undefined && title !== '' ? title : message('activity.unnamed')
      })
      const listed = names.slice(0, MAX_NAMES)
      const rest = names.length - listed.length
      if (rest > 0) listed.push(message('activity.more', { n: rest }))
      return message('activity.summary', {
        clauses: clauses.join(separator),
        names: listed.join(separator),
      })
    }

    /** A short relative label matching the row timestamps the sidebar shows. */
    function relativeTime(updatedAt, now) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return ''
      const elapsed = Math.max(0, now - updatedAt)
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      if (elapsed < minute) return message('time.now')
      if (elapsed < hour) return message('time.minutes', { n: Math.floor(elapsed / minute) })
      if (elapsed < day) return message('time.hours', { n: Math.floor(elapsed / hour) })
      return message('time.days', { n: Math.floor(elapsed / day) })
    }

    /**
     * Group the registry-global pin set per Workspace for the pinned section.
     *
     * Order follows the pinned feed (most recently pinned first) inside each
     * group, while groups themselves follow the sidebar's Workspace order and
     * end with the ungrouped bucket. Archived, blank and subagent sessions are
     * skipped: they have no ordinary row to lift anyway.
     *
     * @param pinnedSessionIds - ordered registry pin set.
     * @param items - Workspace rows.
     * @param byId - Session summaries.
     * @param statuses - Session UI status map.
     * @param archivedSessionIds - registry archive set.
     * @param now - render clock for the relative label.
     * @returns groups, visible ids (for the hide rules), and the total.
     */
    function buildPinnedView(pinnedSessionIds, items, byId, statuses, archivedSessionIds, now) {
      const sessions = byId !== null && typeof byId === 'object' ? byId : {}
      const archived = new Set(Array.isArray(archivedSessionIds) ? archivedSessionIds : [])
      const statusMap = statuses !== null && typeof statuses?.get === 'function' ? statuses : undefined
      const children = childMap(sessions)

      const ownerOf = new Map()
      const titles = new Map()
      const workspaceOrder = []
      for (const workspace of Array.isArray(items) ? items : []) {
        if (workspace === null || typeof workspace !== 'object') continue
        const key = typeof workspace.workspaceId === 'string' ? workspace.workspaceId : ''
        workspaceOrder.push(key)
        titles.set(key, typeof workspace.title === 'string' ? workspace.title : '')
        for (const sessionId of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
          ownerOf.set(sessionId, key)
        }
      }

      const byGroup = new Map()
      const seen = new Set()
      for (const rawId of Array.isArray(pinnedSessionIds) ? pinnedSessionIds : []) {
        const id = typeof rawId === 'string' ? rawId : String(rawId)
        if (seen.has(id)) continue
        seen.add(id)
        const row = sessions[id]
        if (row === null || row === undefined) continue
        if (row.origin === 'subagent' || row.blank === true) continue
        if (archived.has(id)) continue
        const key = ownerOf.has(id) ? ownerOf.get(id) : ''
        const title = typeof row.displayTitle === 'string' && row.displayTitle !== ''
          ? row.displayTitle
          : typeof row.title === 'string' && row.title !== ''
            ? row.title
            : message('pinned.untitled')
        const entry = {
          id,
          title,
          time: relativeTime(row.updatedAt, now),
          mark: sessionMark(id, row, statusMap, children, sessions),
          current: (row.retainedBy?.mainView ?? 0) > 0,
        }
        const list = byGroup.get(key)
        if (list === undefined) byGroup.set(key, [entry])
        else list.push(entry)
      }

      const orderedKeys = workspaceOrder.filter((key) => byGroup.has(key))
      if (byGroup.has('')) orderedKeys.push('')

      const groups = []
      const ids = []
      for (const key of orderedKeys) {
        const listed = byGroup.get(key)
        if (listed === undefined) continue
        for (const entry of listed) ids.push(entry.id)
        groups.push({
          key,
          title: titles.get(key) ?? '',
          count: listed.length,
          containsCurrent: listed.some((entry) => entry.current),
          sessions: listed,
        })
      }
      return { groups, ids, total: ids.length }
    }

    /**
     * Hide the pinned rows inside the official browser list.
     *
     * Search-result rows carry no `data-row-key`, so their occurrence stays
     * visible; only the grouped/flat tree rows are lifted into the pinned
     * section.
     * @param ids - Session ids currently rendered in the pinned section.
     * @returns CSS text, empty when nothing is pinned.
     */
    function hideCss(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return ''
      const rows = ids.map((id) => `[data-row-key="session:${quote(id)}"]`).join(',')
      return `${rows}{display:none!important}`
    }

    /**
     * Static stylesheet for the pinned section. Geometry mirrors the shipped
     * sidebar: 34px workspace rows, 32px session rows, the same radii, gaps and
     * theme tokens, and a muted section header above them.
     */
    const PINNED_CSS = [
      '@keyframes dsws-spin{to{transform:rotate(360deg)}}',
      '.dsws-pinned{flex:none;box-sizing:border-box;max-height:min(40vh,320px);overflow-y:auto;overflow-x:hidden;',
      'margin:0 0 6px;padding:0 2px 2px;overscroll-behavior:contain;',
      '--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);',
      '--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
      '.dsws-pinned[data-rail="true"],.dsws-pinned:empty{display:none}',
      '.dsws-pinned-header{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;height:30px;',
      'margin:0;padding:0 8px;border:0;border-radius:var(--dsw-radius-md);background:none;',
      'color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:18px;font-weight:500;',
      'cursor:pointer;text-align:left;user-select:none}',
      '.dsws-pinned-header:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsws-pinned-header:focus-visible,.dsws-pinned-group-head:focus-visible,',
      '.dsws-pinned-row:focus-visible,.dsws-pinned-unpin:focus-visible{',
      'outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));',
      'outline-offset:-2px}',
      '.dsws-pinned-glyph{width:16px;height:16px;flex:none;display:inline-flex;align-items:center;justify-content:center}',
      '.dsws-pinned-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsws-pinned-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;',
      'font-variant-numeric:tabular-nums;font-weight:400}',
      '.dsws-pinned-chevron{flex:none;width:12px;height:12px;display:inline-flex;align-items:center;',
      'justify-content:center;color:var(--dsw-alias-label-tertiary);transform:rotate(0deg);',
      'transition:transform .15s ease}',
      '.dsws-pinned-chevron[data-open="true"]{transform:rotate(90deg)}',
      '.dsws-pinned-group{margin-top:1px}',
      '.dsws-pinned-group-head{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;height:34px;',
      'margin:0;padding:0 8px;border:0;border-radius:var(--dsw-radius-md);background:none;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;cursor:pointer;',
      'text-align:left;user-select:none}',
      '.dsws-pinned-group-head:hover,.dsws-pinned-group-head:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsws-pinned-fileglyph{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;',
      'justify-content:center;color:var(--dsw-alias-label-tertiary)}',
      '.dsws-pinned-fileglyph[data-active="true"]{color:var(--dsw-alias-state-business-primary)}',
      '.dsws-pinned-arrow{display:none;width:16px;height:20px;flex:none;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);',
      'transform:rotate(0deg);transition:transform .15s ease}',
      '.dsws-pinned-group[data-expanded="true"] .dsws-pinned-arrow{transform:rotate(90deg)}',
      '.dsws-pinned-group-head:hover .dsws-pinned-fileglyph,.dsws-pinned-group-head:focus-visible .dsws-pinned-fileglyph{display:none}',
      '.dsws-pinned-group-head:hover .dsws-pinned-arrow,.dsws-pinned-group-head:focus-visible .dsws-pinned-arrow{display:inline-flex}',
      '.dsws-pinned-group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsws-pinned-group-count{flex:none;color:var(--dsws-alias-label-tertiary);font-size:12px;line-height:17px;',
      'font-variant-numeric:tabular-nums}',
      '.dsws-pinned-row{display:flex;align-items:center;box-sizing:border-box;width:100%;height:32px;',
      'margin:0;padding:0 6px 0 28px;border:0;border-radius:var(--dsw-radius-md);background:none;',
      'color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;cursor:pointer;',
      'text-align:left;user-select:none}',
      '.dsws-pinned-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsws-pinned-row[data-current="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsws-pinned-dotslot{width:16px;height:20px;flex:none;display:inline-flex;align-items:center;',
      'justify-content:center;margin-right:4px}',
      '.dsws-pinned-dot{flex:none;border-radius:50%;box-sizing:border-box}',
      '.dsws-pinned-dot[data-state="warning"]{width:6px;height:6px;background:var(--dsw-alias-state-warn-primary);',
      'box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)}',
      '.dsws-pinned-dot[data-state="done"]{width:6px;height:6px;background:var(--dsw-alias-state-success-primary);',
      'box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}',
      '.dsws-pinned-dot[data-state="ongoing"]{width:10px;height:10px;background-color:var(--dsw-static-deepseek-450);',
      `-webkit-mask-image:${RING};mask-image:${RING};-webkit-mask-size:100% 100%;mask-size:100% 100%;`,
      '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;animation:dsws-spin 1.5s linear infinite}',
      '.dsws-pinned-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsws-pinned-time{flex:none;margin-left:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}',
      '.dsws-pinned-unpin{flex:none;width:22px;height:22px;margin-left:2px;display:inline-flex;',
      'align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--dsw-radius-sm);',
      'background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      '.dsws-pinned-unpin:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dsws-pinned-unpin:disabled{opacity:.45;cursor:default}',
      '@media (prefers-reduced-motion:reduce){',
      '.dsws-pinned-dot[data-state="ongoing"]{animation:none;opacity:.7}',
      '.dsws-pinned-chevron,.dsws-pinned-arrow{transition:none}}',
    ].join('')

    /** Read the browser-local collapse memory without assuming storage access. */
    function readViewState() {
      const fallback = { sectionCollapsed: false, groups: {} }
      if (typeof localStorage === 'undefined') return fallback
      try {
        const raw = localStorage.getItem(VIEW_STORE_KEY)
        if (typeof raw !== 'string' || raw === '') return fallback
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return fallback
        const groups = parsed.groups !== null && typeof parsed.groups === 'object' ? parsed.groups : {}
        return { sectionCollapsed: parsed.sectionCollapsed === true, groups }
      } catch {
        return fallback
      }
    }

    /** Persist the collapse memory and return the new value for a state update. */
    function writeViewState(state) {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(VIEW_STORE_KEY, JSON.stringify(state))
        } catch {
          // Storage may be unavailable or full; collapsing still works in memory.
        }
      }
      return state
    }

    /**
     * Insert the portal container before the browser region and keep it there.
     *
     * The container is a sibling of the region inside the sidebar column, so it
     * sits between the panel rows and the Workspaces header without entering
     * the browser's own React tree. A MutationObserver restores the insertion
     * if a shell re-render removes it and mirrors the sidebar's collapsed
     * state so the section disappears with the wide layout.
     * @param marker - the mount's own DOM node, used only to prove React mounted us.
     * @returns the container plus its disposer, or null outside a browser DOM.
     */
    function attachPinnedHost(marker) {
      if (typeof document === 'undefined' || marker === null) return null
      const region = document.querySelector(REGION_SELECTOR)
      if (region === null || region.parentElement === null) return null
      const parent = region.parentElement

      const host = document.createElement('div')
      host.className = 'dsws-pinned'
      host.setAttribute(SECTION_ATTR, '')

      const place = () => {
        const current = document.querySelector(REGION_SELECTOR)
        if (current === null || current.parentElement === null) return
        if (host.parentElement !== current.parentElement || host.nextElementSibling !== current) {
          current.parentElement.insertBefore(host, current)
        }
        const collapsed = Array.from(current.parentElement.classList ?? [])
          .some((token) => token.endsWith('_collapsed'))
        if (host.getAttribute('data-rail') !== String(collapsed)) {
          host.setAttribute('data-rail', String(collapsed))
        }
      }

      place()
      const observer = new MutationObserver(place)
      observer.observe(parent, { childList: true, attributes: true, attributeFilter: ['class'] })
      return {
        host,
        dispose() {
          observer.disconnect()
          host.remove()
        },
      }
    }

    /**
     * The pinned section. Rendered through the portal; walks the pin set from
     * the Workspace feed, groups it per Workspace, and unpins through the
     * Workspace service so the official tree and this section update together.
     */
    function PinnedSection({ model, openSession, unpinSession }) {
      const [view, setView] = React.useState(readViewState)
      const [pending, setPending] = React.useState(() => ({}))

      const toggleSection = () => {
        setView((previous) => writeViewState({
          ...previous,
          sectionCollapsed: !previous.sectionCollapsed,
        }))
      }

      const toggleGroup = (key) => {
        setView((previous) => {
          const groups = { ...previous.groups }
          if (groups[key] === true) delete groups[key]
          else groups[key] = true
          return writeViewState({ ...previous, groups })
        })
      }

      const unpin = (sessionId) => {
        if (pending[sessionId] === true) return
        setPending((previous) => ({ ...previous, [sessionId]: true }))
        Promise.resolve()
          .then(() => unpinSession(sessionId))
          .catch(() => {})
          .finally(() => {
            setPending((previous) => {
              const next = { ...previous }
              delete next[sessionId]
              return next
            })
          })
      }

      const open = (sessionId) => {
        openSession(sessionId)
      }

      const sectionOpen = view.sectionCollapsed !== true
      const rows = []

      rows.push(h(
        'button',
        {
          key: 'header',
          type: 'button',
          className: 'dsws-pinned-header',
          'aria-expanded': String(sectionOpen),
          'aria-label': message('pinned.sectionAria'),
          onClick: toggleSection,
        },
        h('span', { className: 'dsws-pinned-glyph' }, pinIcon(14)),
        h('span', { className: 'dsws-pinned-label' }, message('pinned.title')),
        h('span', { className: 'dsws-pinned-count' }, String(model.total)),
        h('span', {
          className: 'dsws-pinned-chevron',
          'data-open': sectionOpen ? 'true' : 'false',
        }, chevronIcon()),
      ))

      if (sectionOpen) {
        for (const group of model.groups) {
          const expanded = view.groups[group.key] !== true
          const title = group.title !== '' ? group.title : message('activity.unnamed')
          const groupRows = []
          groupRows.push(h(
            'button',
            {
              key: 'head',
              type: 'button',
              className: 'dsws-pinned-group-head',
              'aria-expanded': String(expanded),
              'aria-label': message('pinned.groupAria', { workspace: title }),
              onClick: () => toggleGroup(group.key),
            },
            h('span', { className: 'dsws-pinned-fileglyph', 'data-active': group.containsCurrent ? 'true' : 'false' }, folderIcon()),
            h('span', { className: 'dsws-pinned-arrow' }, chevronIcon()),
            h('span', { className: 'dsws-pinned-group-title' }, title),
            h('span', { className: 'dsws-pinned-group-count' }, String(group.count)),
          ))
          if (expanded) {
            for (const session of group.sessions) {
              groupRows.push(h(
                'div',
                {
                  key: session.id,
                  className: 'dsws-pinned-row',
                  role: 'treeitem',
                  tabIndex: 0,
                  'data-current': session.current ? 'true' : 'false',
                  'aria-current': session.current ? 'true' : undefined,
                  title: session.title,
                  onClick: () => open(session.id),
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    open(session.id)
                  },
                },
                h(
                  'span',
                  { className: 'dsws-pinned-dotslot' },
                  session.mark === undefined
                    ? null
                    : h('span', { className: 'dsws-pinned-dot', 'data-state': session.mark }),
                ),
                h('span', { className: 'dsws-pinned-row-title' }, session.title),
                session.time === '' ? null : h('span', { className: 'dsws-pinned-time' }, session.time),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsws-pinned-unpin',
                    title: message('pinned.unpin'),
                    'aria-label': message('pinned.unpinAria', { title: session.title }),
                    disabled: pending[session.id] === true,
                    onClick: (event) => {
                      event.stopPropagation()
                      unpin(session.id)
                    },
                  },
                  pinIcon(14),
                ),
              ))
            }
          }
          rows.push(h(
            'div',
            {
              key: group.key === '' ? 'ungrouped' : group.key,
              className: 'dsws-pinned-group',
              'data-expanded': expanded ? 'true' : 'false',
              role: 'group',
            },
            groupRows,
          ))
        }
      }

      return h('div', {
        className: 'dsws-pinned-inner',
        role: 'region',
        'aria-label': message('pinned.title'),
      }, rows)
    }

    /**
     * Read one standard selector hook, tolerating an assembly without it.
     * @param hook - the standard hook, possibly absent.
     * @param selector - projection over the hook's snapshot.
     * @param fallback - snapshot used when the hook is absent.
     * @returns the selected value.
     */
    function useStandard(hook, selector, fallback) {
      return typeof hook === 'function' ? hook(selector) : selector(fallback)
    }

    /** No-op for an absent navigation service. */
    function noop() {}

    /** No-op pin resolver for an assembly without the Workspace service. */
    function noopAsync() {
      return Promise.resolve()
    }

    const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
    const EMPTY_SESSIONS = { byId: {} }
    const EMPTY_STATUSES = new Map()

    /**
     * The slot entry: publishes the stylesheet, the hidden activity
     * description, the portal anchor, and the pinned section portal.
     * @param props - standard selector hooks plus the injected management actions.
     * @returns the style/anchor tree and, once attached, the portal.
     */
    function WorkspaceStatus({
      useWorkspaces,
      useSessions,
      useSessionStatus,
      externalPinSession,
      externalUnpinSession,
      externalOpenSession,
    }) {
      const items = useStandard(useWorkspaces, (state) => state?.items, EMPTY_WORKSPACES)
      const archived = useStandard(useWorkspaces, (state) => state?.archivedSessionIds, EMPTY_WORKSPACES)
      const pinned = useStandard(useWorkspaces, (state) => state?.pinnedSessionIds, EMPTY_WORKSPACES)
      const byId = useStandard(useSessions, (state) => state?.byId, EMPTY_SESSIONS)
      const statuses = useStandard(useSessionStatus, (state) => state, EMPTY_STATUSES)

      const watchRef = React.useRef(undefined)
      if (watchRef.current === undefined) {
        watchRef.current = { running: new Set(), stoppedAt: new Map() }
      }

      const activity = React.useMemo(
        // The window is measured at render time, the same way the browser reads
        // its own clock: no timer, because any feed change re-renders anyway.
        // Advancing the watch is idempotent, so a repeated render costs nothing.
        () => deriveActivity(items, byId, statuses, archived, Date.now(), watchRef.current),
        [items, byId, statuses, archived, watchRef],
      )

      const pinnedModel = React.useMemo(
        () => buildPinnedView(pinned, items, byId, statuses, archived, Date.now()),
        [pinned, items, byId, statuses, archived],
      )

      const markerRef = React.useRef(null)
      const [portalHost, setPortalHost] = React.useState(undefined)
      React.useEffect(() => {
        const attached = attachPinnedHost(markerRef.current)
        if (attached === null) return undefined
        setPortalHost(attached.host)
        return () => { attached.dispose() }
      }, [])





      const cssText = BASE_CSS + PINNED_CSS + rowCss(activity)
        + (portalHost === undefined ? '' : hideCss(pinnedModel.ids))
      const children = [h('style', { key: 'style', 'data-plugin-css': STYLE_ID }, cssText)]

      if (activity.marked > 0) {
        children.push(h('span', { key: 'activity', className: SR_CLASS }, describe(activity)))
      }
      children.push(h('span', {
        key: 'anchor', ref: markerRef, className: 'dsws-anchor', 'aria-hidden': 'true',
      }))

      if (portalHost !== undefined && pinnedModel.total > 0) {
        children.push(ReactDOM.createPortal(
          h(PinnedSection, {
            model: pinnedModel,
            openSession: typeof externalOpenSession === 'function' ? externalOpenSession : noop,
            unpinSession: typeof externalUnpinSession === 'function' ? externalUnpinSession : noopAsync,
          }),
          portalHost,
          ENTRY_ID,
        ))
      }

      return h(React.Fragment, null, children)
    }

    return {
      name: 'workspace-status',
      inject: ['slots'],
      apply(ctx) {
        // Services are read lazily: the Workspace and ui-workspace client
        // halves may activate after this entry registers, and pin/open must
        // still resolve once they exist.
        const service = (name) => {
          try {
            return ctx.get(name)
          } catch {
            return undefined
          }
        }
        ctx.slots.inject(SLOT, () => ctx.slots.register(
          {
            name: SLOT,
            id: ENTRY_ID,
            order: ENTRY_ORDER,
            inject: () => ({
              externalPinSession: (sessionId) => {
                const workspaces = service('workspaces')
                return workspaces === undefined ? noopAsync() : workspaces.pinSession(sessionId)
              },
              externalUnpinSession: (sessionId) => {
                const workspaces = service('workspaces')
                return workspaces === undefined ? noopAsync() : workspaces.unpinSession(sessionId)
              },
              externalOpenSession: (sessionId) => {
                const uiWorkspace = service('uiWorkspace')
                if (uiWorkspace !== undefined) uiWorkspace.openSession(sessionId)
              },
            }),
          },
          WorkspaceStatus,
        ))
      },
      /** Exposed for the package's own tests; the Loader ignores it. */
      __test: {
        deriveActivity,
        rowCss,
        describe,
        quote,
        relativeTime,
        buildPinnedView,
        hideCss,
        sessionMark,
        WorkspaceStatus,
        FINISHED_WINDOW_MS,
      },
    }
  },
})

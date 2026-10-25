/**
 * Browser half of workspace-status.
 *
 * The sidebar draws a status dot on every Session row but nothing on the
 * Workspace (folder) row above it, so a collapsed group — or a group scrolled
 * out of view — hides whether any agent inside it is waiting, running, or
 * just finished. Workspace rows declare no slot, so this package does not
 * render markup into them: it publishes one stylesheet aimed at the row the
 * Workspace browser already renders (`data-row-key="workspace:<id>"`) and
 * draws the mark as that row's trailing pseudo-element. React keeps owning
 * the row; nothing is written to the document and nothing is observed.
 *
 * The entry mounts in the additive `sidebar.footer.action` seat, which is
 * mounted for the whole browsing region even when no Session exists. It shows
 * no control of its own: it publishes the row rules plus a visually hidden
 * description of the same state for readers who cannot see the mark.
 *
 * Data comes from the same public feeds the browser itself reads:
 * `useWorkspaces` (items + archive set), `useSessions` (summaries, including
 * subagent rows) and `useSessionStatus` (running / pendingInteraction /
 * completionUnread). The precedence mirrors the shipped Session row:
 * waiting for the user outranks running, which outranks the finished
 * reminder; a subagent keeps its parent's workspace busy.
 */

window.__ModuleLoader__.load({
  id: 'dsh-workspace-status',
  factory(require) {
    const React = require('react')

    /** Additive seat beside Settings at the sidebar foot. */
    const SLOT = 'sidebar.footer.action'
    /** Stable list id; reusing it would shadow this entry rather than add one. */
    const ENTRY_ID = 'workspace-status'
    /** The stylesheet this mount owns; unmounting the entry removes it. */
    const STYLE_ID = 'dsh-workspace-status/rows.css'
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

    /**
     * The hidden description's own rule. The visible mark carries no markup of
     * its own (the generated row rules draw it), so this sheet only has to
     * keep the description out of the layout.
     */
    const BASE_CSS = [
      `.${SR_CLASS}{position:absolute;width:1px;height:1px;margin:-1px;padding:0;`,
      'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
    ].join('')

    /**
     * Every user-facing string lives here rather than in a locale service: the
     * only copy this package produces is a hidden description, so the built-in
     * dictionaries are enough and the plugin keeps working without the locale
     * face. The `locale/*.json` files mirror them for tooling.
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
      },
      zh: {
        'activity.summary': '工作区状态：{clauses} — {names}',
        'activity.waiting': '{n} 个等待你处理',
        'activity.running': '{n} 个运行中',
        'activity.done': '{n} 个刚刚完成',
        'activity.unnamed': '未分组',
        'activity.more': '等 {n} 个',
        'activity.listSeparator': '、',
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
     * Escape one group key for a double-quoted CSS attribute selector.
     *
     * A control character has no literal form inside a CSS string: an unescaped
     * newline ends the string token and the whole rule is dropped as invalid,
     * so the row would lose its mark silently. Each one is written as a hex
     * escape with a trailing space, which stops a following hex digit being
     * absorbed. Host Workspace ids are UUIDs, so this is a correctness guard,
     * not a path expected in practice.
     * @param value - raw group key.
     * @returns the key escaped for use inside quotes.
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
     * mask keeps a round 2px-equivalent stroke with round caps and a faint
     * track, matching the geometry of the product's own running indicator.
     */
    const RING = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='4' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round' stroke-opacity='.25'/%3E%3Ccircle cx='5' cy='5' r='4' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='5 20'/%3E%3C/svg%3E\")"

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

      /** Parent Session id → direct subagent child ids. */
      const children = new Map()
      for (const sessionId of Object.keys(sessions)) {
        const row = sessions[sessionId]
        if (row?.origin !== 'subagent' || typeof row.parentId !== 'string') continue
        const list = children.get(row.parentId)
        if (list === undefined) children.set(row.parentId, [sessionId])
        else list.push(sessionId)
      }

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
          '@keyframes dsws-spin{to{transform:rotate(360deg)}}',
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

    const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [] }
    const EMPTY_SESSIONS = { byId: {} }
    const EMPTY_STATUSES = new Map()

    /**
     * The slot entry. It shows no control of its own: it publishes the row
     * rules, plus a description of the same state for readers who cannot see
     * the mark.
     * @param props - standard selector hooks.
     * @returns the style + hidden description, or null when nothing is marked.
     */
    function WorkspaceStatus({ useWorkspaces, useSessions, useSessionStatus }) {
      const items = useStandard(useWorkspaces, (state) => state?.items, EMPTY_WORKSPACES)
      const archived = useStandard(useWorkspaces, (state) => state?.archivedSessionIds, EMPTY_WORKSPACES)
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

      if (activity.marked === 0) return null

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('style', { 'data-plugin-css': STYLE_ID }, BASE_CSS + rowCss(activity)),
        React.createElement('span', { className: SR_CLASS }, describe(activity)),
      )
    }

    return {
      name: 'workspace-status',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject(SLOT, () => ctx.slots.register(
          { name: SLOT, id: ENTRY_ID, order: ENTRY_ORDER },
          WorkspaceStatus,
        ))
      },
      /** Exposed for the package's own tests; the Loader ignores it. */
      __test: { deriveActivity, rowCss, describe, quote, WorkspaceStatus, FINISHED_WINDOW_MS },
    }
  },
})

# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-26

### Added

- Pinned-only notifications. The pinned section watches the live status of
  pinned conversations and notifies on transitions: a pinned conversation
  starts waiting for you (approval, plan review or question) or finishes
  unread. Running → idle with an unread completion fires once; repeated
  renders, kind changes and late unread states are deduplicated, and the
  first observation after a reload stays silent.
- Desktop/OS notifications when the window is in the background, plus in-app
  notices inside the pinned section so a focused window still surfaces the
  event. Clicking a row-shaped notice opens that pinned conversation; notices
  auto-dismiss after eight seconds or via the close button.
- A bell toggle in the pinned section header turns pinned notifications on or
  off and requests notification permission on first use; a speaker toggle
  enables an optional two-note chime. Both preferences persist in browser
  storage. The bell falls back to in-app notices when the OS blocks
  notifications, and enabling notifications shows a one-off test notice.
- Notifications are only emitted for transitions while the app is running;
  they are not external push and do not notify sessions outside the pin set.

## [0.2.0] - 2026-10-26

### Added

- Pinned conversations section above the Workspaces list. Pinned conversations
  are lifted out of the regular workspace groups and rendered per workspace
  with the shipped folder-header treatment, their live status dot, relative
  time, current-session highlight, group counts and a filled pin icon on every
  row. Clicking the pin unpins immediately.
- Section and group collapse state persisted in browser storage; the section
  caps its height and scrolls independently.
- The section is driven by the registry-global `pinnedSessionIds` Workspace
  feed, so pins survive restarts and stay in sync with the official browser;
  unpin uses `ctx.workspaces.unpinSession`, opening a row uses
  `ctx.uiWorkspace.openSession`.
- Pinned rows are hidden from the official grouped/flat tree with generated
  `display:none` rules; search-result rows are untouched.

### Changed

- Component now renders a React portal into a container inserted before the
  sidebar browsing region, in addition to the emitted row stylesheet. The
  official Workspace browser is still not replaced.
- The workspace-mark mount now always publishes the stylesheet and portal
  anchor, so pins added while mounted appear without a reload.

## [0.1.0] - 2026-10-25

### Added

- Workspace rows in the sidebar show a status mark aggregated from their
  sessions: amber dot while a session waits for the user (approval, plan
  review, answer), blue spinning ring while a session or subagent runs, green
  dot for a recently finished unread session (one-hour notice window).
- One mark per workspace with the shipped session-row precedence: waiting
  outranks running, which outranks the finished reminder.
- Hidden screen-reader description with per-state counts and workspace names.
- Archived sessions ignored; ungrouped sessions mark the Ungrouped bucket.
- Zero-fork implementation: an additive `sidebar.footer.action` entry that
  publishes row CSS keyed on `data-row-key="workspace:<id>"`, with no DOM
  writes, observers or host services.
- Declares `dsh.catalog` so plugin markets place it under UI with a real summary.

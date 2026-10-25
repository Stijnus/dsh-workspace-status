# Changelog

## 0.1.0 — 2026-10-25

### Added

- First public release: coloured status marks on workspace rows (waiting, running,
  recently finished) with locale-aware labels and a settings toggle.
- Declares `dsh.catalog` so plugin markets place it under UI with a real summary.

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

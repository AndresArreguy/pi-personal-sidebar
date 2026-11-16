# Changelog

## [1.0.0] - 2026-11-16

- Initial public release.
- Theme-aware right column via a layout-root `HStack`; no overlay, no chat coverage.
- Sections: Repo / Folder, To-do, Command Code usage, Subagents, NPM cache.
- Reads todos from `rpiv-todo` and hides its own overlay.
- Tracks `run_agent` calls with agent, task and elapsed time.
- Reuses the Command Code quota endpoints for 5h, weekly and monthly data.
- `npm cache clean --force` + `pnpm store prune`, with confirmation.
- Collapsible sections (`▾/▸`), mouse clicks, `/sidebar focus` keyboard mode.
- Spanish/English UI with `auto` detection, config language and `PI_SIDEBAR_LANG`.

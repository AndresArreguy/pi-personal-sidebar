# Contributing to πrsonal Sidebar

Thanks for taking the time to contribute. Issues and pull requests can be written
in English or Spanish.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- Report a bug with the bug report template.
- Request a feature or describe a workflow you want to support.
- Improve the docs, README translations or theme examples.
- Send a focused pull request for a bug fix, feature or polish.
- Share your setup or screenshots in an issue/discussion.

## Before you start

- For anything non-trivial, open an issue first so we can agree on scope and
  avoid duplicated work.
- Keep one PR focused on one change. Small PRs are reviewed faster.
- Check existing issues and PRs before opening a new one.
- Do not open a public issue for a security vulnerability; see
  [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Node.js **22.6+**
- Pi **1.5.x** with fullscreen mode (the default)
- Optional: `@juicesharp/rpiv-todo` for the To-do section

```bash
git clone https://github.com/AndresArreguy/pi-personal-sidebar.git
cd pi-personal-sidebar
npm run check          # syntax check; there is no build step
pi install .           # load the local package
```

Then run `/reload` in Pi. You can also try it without installing:

```bash
pi -e ./index.ts
```

### What to test

- Fullscreen TUI: the sidebar reserves the right column and never covers the chat.
- Collapse/expand each section, mouse clicks and `/sidebar focus`.
- `/sidebar show|hide`, `/sidebar width`, `/sidebar language`.
- Usage: bars for 5h/weekly, context window and session tokens; with and without
  a `commandcode` login.
- A non-commandcode provider: the quota line should say `quota n/a`, while
  context/tokens/model/thinking still render.
- The To-do section with and without `rpiv-todo`.
- Both languages (`es` and `en`) if you touch UI strings.

## Code guidelines

- TypeScript, no build step. Keep the package as Pi source.
- Keep `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer
  dependencies. Do not bundle or add them to `dependencies`.
- Use Pi theme tokens (`mdHeading`, `text`, `mdCode`, `getThinkingBorderColor`,
  `selectedBg`, `success`/`warning`/`error`). No hardcoded colors.
- The quota client is specific to Command Code. Keep the section itself
  provider-agnostic; other providers must still see context, tokens, model and
  thinking.
- Any new UI string goes in **both** dictionaries in `i18n.ts`.
- Avoid new runtime dependencies unless there is a clear reason.
- Keep the layout wrapper defensive: it patches `setLayoutRoot` and must restore
  it on shutdown.

## Commits

Use Conventional Commits:

```text
feat: add ...
fix: ...
docs: ...
test: ...
chore: ...
```

Do not bump the package version in a feature PR; maintainers handle releases.

## Pull requests

Include:

- What changed and why.
- How you tested it (commands, screenshots/GIFs for UI changes).
- The issue it closes, if any.
- A short note about platforms you tested (Windows/macOS/Linux).

Checklist:

- [ ] `npm run check` passes.
- [ ] Tested in Pi fullscreen.
- [ ] Docs/README updated if behavior changed.
- [ ] No hardcoded colors or provider-specific assumptions in generic UI.

## License

By contributing, you agree that your contributions are licensed under the MIT
license of this repository.

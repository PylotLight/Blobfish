# Getting started

Template repo: create your app with **Use this template** on GitHub (or clone and
re-point the remote). Everything below uses Bun only.

## Run it

```bash
bun install   # also guarantees the Electron binary via postinstall
bun run dev   # dev server + app (wrapped: cleans terminal state on exit)
```

## Verify it

CI requires lint and formatting checks on pull requests and pushes to `main`.
The linter job installs Bun canary separately; the other verification checks
continue using the Bun version pinned in `.bun-version`.

Use Bun canary for the built-in linter (`bun upgrade --canary`). Before opening
or updating a pull request, run the same checks locally:

```bash
bun lint
bun run format:check
bun test
bun run typecheck
bun run build
bun run check:css
```

`bun run format:check` is non-mutating; run `bun fmt` to apply formatting
changes, then rerun the check. You can return to the stable Bun channel with
`bun upgrade --stable` after linting.
The build writes `out/{main,preload,renderer}/`; use `bun run start` to launch
it locally.

## Make it yours

When starting a real app from this template, touch these and nothing else:

| #   | File                       | Change                                                                                                                            |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `package.json`             | `name`, `version`, `description`                                                                                                  |
| 2   | `src/shared/config.ts`     | `APP_NAME`, `APP_TAGLINE`, `APP_ID`, window size                                                                                  |
| 3   | `src/renderer/index.html`  | `<title>`                                                                                                                         |
| 4   | `assets/`                  | Replace tray icons, or regenerate: `bun run assets` (`trayTemplate.png` for macOS, `tray.png` elsewhere)                          |
| 5   | `LICENSE`                  | Copyright holder                                                                                                                  |
| 6   | `.github/workflows/ci.yml` | Keep the required `bun lint` and `bun run format:check` gates on pull requests and pushes to `main`; the lint job uses Bun canary |

## Scripts

| Script         | What it does                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `dev`          | `bun scripts/dev.ts` — dev server + app with terminal cleanup on exit                                        |
| `dev:bare`     | Raw `electron-vite dev` (no wrapper)                                                                         |
| `build`        | Production build into `out/`                                                                                 |
| `start`        | Launch the built app (`electron ./out/main/index.js`)                                                        |
| `preview`      | Serve the built renderer only                                                                                |
| `clean`        | Remove `out/`                                                                                                |
| `typecheck`    | `bun check` (Bun >= 1.4.3, pinned in `.bun-version`) over `src/`, `scripts/`, and config via `tsconfig.json` |
| `format`       | `bun fmt` — apply Bun's formatter                                                                            |
| `format:check` | `bun fmt --check` — check formatting without changing files                                                  |
| `assets`       | Regenerate tray PNGs, zero dependencies                                                                      |
| `postinstall`  | Runs automatically: downloads the Electron binary Bun skips                                                  |

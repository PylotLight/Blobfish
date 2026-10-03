# Blobfish

A fast, native Azure Blob Storage explorer — a lighter replacement for Azure Storage
Explorer. Built from the [bun-electron-app starter template](https://github.com/PylotLight/bun-electron-app)
(Bun + Electron + React + Vite + TypeScript).

> Status: day 0. Template identity applied, builds clean. Explorer features land next —
> see the roadmap.

## Why

Azure Storage Explorer is itself Electron-based but heavy and sluggish for large
containers. Blobfish aims for: instant startup, virtualized blob lists that stay smooth
at 100k+ items, background transfers that live in the tray, and first-class support for
local Azurite development.

## Install

**Homebrew (macOS):**

```bash
brew tap pylotlight/blobfish https://github.com/PylotLight/Blobfish.git
brew install --cask blobfish
```

Or download binaries (macOS dmg/zip, Apple Silicon + Intel) from
[Releases](https://github.com/PylotLight/Blobfish/releases). Builds are unsigned
for now — macOS Gatekeeper (stricter on macOS 26/Tahoe) may report
““Blobfish” is damaged and can’t be opened”. That means unsigned + quarantined,
not a bad build. Click Cancel (don't trash it), then clear the quarantine flag:

```bash
xattr -cr /Applications/Blobfish.app
```

and open again (right-click → Open on first launch). Or skip the quarantine
entirely with Homebrew:

```bash
brew install --cask blobfish --no-quarantine
```
Linux isn't packaged in releases yet; run from source below.

## Quickstart

```bash
bun install
bun run dev
bun run build && bun run start
```

Template docs (architecture, bridge rules, vibrancy, troubleshooting) live in `docs/`
and apply as-is. Cutting a release: `bun run release` — see
[docs/releasing.md](docs/releasing.md).

## Roadmap

- [ ] **Accounts** — connection strings, SAS tokens, Entra ID (device code); stored in the
  OS keychain via `safeStorage`, never on disk in plaintext
- [ ] **Browse** — containers → virtualized blob list, prefix navigation, search,
  sorting, blob properties + metadata
- [ ] **Transfer** — parallel block-blob upload/download with progress, pause/resume,
  background completion in the tray
- [ ] **Preview** — text/image preview in-app, external open for the rest
- [ ] **Azurite** — one-click local emulator profile for development
- [ ] **Polish** — branded tray icons, expiry-aware SAS warnings, transfer history

Planned SDK: `@azure/storage-blob` in main, chunked transfers in a utility worker,
all UI through the existing typed `window.api` bridge.

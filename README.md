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

## Quickstart

```bash
bun install
bun run dev
bun run build && bun run start
```

Template docs (architecture, bridge rules, vibrancy, troubleshooting) live in `docs/`
and apply as-is.

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

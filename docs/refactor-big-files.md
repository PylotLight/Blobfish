# Big-file cleanup — design (2026-10-26)

Split Blobfish's four biggest modules into small, cohesively named files so one
behaviour can be found, grepped and changed without loading a 2,500-line file.
**Pure refactor — behaviour must not change.** Existing tests and CI are the
guardrails.

Precedent and house pattern: Rowfish PR #16 and Inkfish's `refactor/big-files`.
Extract by stable identifiers, move code verbatim, keep facades so importers
never change, one commit per task, green gate at every step.

## Scope — round 1 (the four biggest)

| File | Lines | Shape |
|---|---|---|
| `src/renderer/src/views/Explorer.tsx` | 2,594 | one 2,333-line `Explorer` component + `BlobRow`/`Action`/`Th` |
| `src/renderer/src/App.tsx` | 1,736 | one 1,644-line `App` component (sidebar tree + shell) |
| `src/main/azure.ts` | 926 | flat module, clean seams |
| `src/main/transfers.ts` | 806 | flat module, clean seams |

**Deferred to a follow-up round** (the 660–854 tier): `AdminDialogs.tsx` (854),
`TransfersPanel.tsx` (722), `ipc.ts` (702), `Preview.tsx` (666).

Known findings (unbounded `Promise.all` in `deleteNames`/`moveBlobs`/
`undeleteBlobs`, broken README roadmap link) are behaviour work — **out of
scope** for this refactor; do not fix them drive-by.

## Target structure

### `views/Explorer.tsx` → `views/explorer/`

As of `277e070`: 1–105 imports + pure helpers; 106–2438 the `Explorer`
component; 2439–2594 `RowHandlers`, `BlobRow` (memo), `Action`, `Th`.

```
views/
  Explorer.tsx              facade: re-export default from ./explorer/Explorer
  explorer/
    helpers.ts              SortKey/SortDir, sasWarning, virtualization constants,
                            dateFormat, collator, formatWhen, keyOf, isSelectedPath,
                            PreviewTab, CtxMenu
    BlobRow.tsx             RowHandlers, BlobRow, Action, Th (bottom of file,
                            already self-contained)
    useExplorerNav.ts       container/blob loading (loadContainers, reloadBlobs)
                            + go/goBack/goForward/goUp/resetNav/switchContainer
                            + navPrefixRef/containerRef/containerSeq
    useBlobActions.ts       run + onNewContainer/onDeleteContainer/onNewFolder/
                            onUpload/onDownload/onPreviewDownload/onDelete/
                            onRename/onMoveOrCopy/submitMoveCopy/onRestore +
                            blobUrl/copyUrls/copyPaths/copyEndpoint
    usePreviewTabs.ts       preview-tab state + openPreviewTab/closePreviewTab/
                            dropTabsForNames
    useVirtualRows.ts       virtualization: measureViewport, onBodyScroll,
                            takeSyncMeasure, spacers, scrollFrame
    useExplorerDnd.ts       canDropFiles/endDrag/folderUnder/dropHandlers,
                            paletteAction, onUploadFolder
    Toolbar.tsx             toolbarFilter + historyButtons + actionBar +
                            addressStrip JSX fragments (~450 lines)
    CtxMenu.tsx             the ctxMenu JSX block (~160 lines)
    Explorer.tsx            root component, target < ~450 lines
```

`useBlobListing` and `useExplorerKeys` are already extracted hooks — keep using
them as-is.

### `views/App.tsx` → `app/` (or keep flat beside `App.tsx`)

As of `277e070`: 1–91 imports + types; 92–1729 the `App` component; the
sidebar tree logic (accounts, containers, pins, menus, SAS) dominates, then
`accountRow` (~300 lines) and the shell JSX (~520 lines).

```
  App.tsx                   facade: re-export default
  app/
    types.ts                CONTAINER_NAME_RE, SidebarMenu, LeaseProbe,
                            SelectionTarget, errMessage
    useSidebarTree.ts       tree state + refreshAccounts, loadContainers/
                            ensureContainers, group expand, selectAccount,
                            goHome, invalidateContainers, commitRename, pins
                            (isContainerPinned/toggleContainerPin), secrets
                            (copySecret/exportSecret), derived
                            visible/pinned/visibleAccounts/visibleContainers
    menu-items.ts           buildAccountMenuItems / buildGroupMenuItems /
                            buildContainerMenuItems — pure builders of
                            callbacks + data (Inkfish ctx-menu-items pattern)
    SidebarTree.tsx         accountRow + container rows, presentational
    Sidebar.tsx             the sidebar aside JSX
    App.tsx                 root: view switching, dialogs, ConnectWizard,
                            TransfersPanel, easter egg — target < ~450 lines
```

### `src/main/azure.ts` → `src/main/azure/`

Clean seams; the facade keeps every export so `ipc.ts`, `transfers.ts` and
tests compile unchanged.

```
main/
  azure.ts                  facade: re-export all public names
  azure/
    common.ts               joinKey, withSas
    errors.ts               friendlyError
    list.ts                 listContainers, listBlobs, listBlobVersions
    containers.ts           createContainer, deleteContainer, renameContainer,
                            createFolder
    copy.ts                 CopyPlan, expandBlobFolder, blobExists,
                            planBlobCopy, runBlobCopy, copyBlobs, moveBlobs
    delete.ts               expandFiles, expandBlobNames, deleteNames,
                            undeleteBlobs, restoreVersion
```

### `src/main/transfers.ts` → `src/main/transfers/`

Clean seams; module-level state (`transfers`, `byId`, `dirty`, `removed`,
timers) lives in one state module so the rest stay functions.

```
main/
  transfers.ts              facade: re-export all public names
  transfers/
    types.ts                ActiveTransfer, constants (concurrency, block size,
                            EMIT_MS, …)
    state.ts                registry + buildDelta/emitNow/markDirty/forget/
                            toInfo/summary/snapshot/connectionsFor
    queue.ts                enqueue, activeCount, startNext, tick, describe
    run.ts                  run, runBlobUpload, runDfsUpload, rangedDownload,
                            runBlobDownload, runDfsDownload, uniqueDownloadPath
    api.ts                  configureTransfers, enqueueUpload, enqueueDownload,
                            cancelTransfer, cancelAll, retryTransfer,
                            clearFinished, inFlightCounts, stopTransfersForQuit
```

## Phases (coarse — order per task is decided at execution, dependency-first)

1. **azure/** and **transfers/** — flat modules, lowest risk; do them first to
   establish the facade pattern in this repo.
2. **explorer/** — helpers → BlobRow → hooks (nav, actions, preview tabs,
   virtual rows, dnd) → Toolbar/CtxMenu → root.
3. **app/** — types → useSidebarTree → menu-items → SidebarTree/Sidebar → root.
4. **Final gate** + PR.

## Ground rules (every task)

1. **Extract by stable identifiers** (declaration names, JSX class markers),
   not line numbers — the line ranges above are as of `277e070`, orientation
   only.
2. **Each task ends green:** `bun run format:check && bun run typecheck &&
   bun test && bun run build`. Record the `bun test` pass/fail counts before
   starting; a new failure is a regression, the same set is not.
3. **One commit per task**, conventional prefix by area:
   `refactor(azure): …`, `refactor(transfers): …`, `refactor(explorer): …`,
   `refactor(app): …`.
4. **Move code verbatim.** Only imports, prop types and wiring are new. Rename
   a symbol only when its current name is actively misleading.
5. **Keep facades** for `Explorer.tsx`, `App.tsx`, `azure.ts`, `transfers.ts`
   so every existing importer (including `ipc.ts` and tests) keeps compiling
   unchanged.
6. **Grep moved identifiers** after each move (`grep -rn "<name>" src`): one
   occurrence outside the new home = import-only = dead import to remove.
7. Presentational components receive **value + setter/named-callback props**;
   state stays in the parent. Hooks own derived state and return typed objects.
8. Watch for doc comments when slicing: a slice must include the comment above
   its first declaration, and header rebuilds must not leave a stale import
   block behind (both bit the Inkfish run).

## Branch + merge

- `git checkout main && git pull && git checkout -b refactor/big-files`.
- Push the branch; open the PR with `ghp` (personal repo) when CI is green;
  squash-merge, delete the branch.
- **No releases** from this branch.

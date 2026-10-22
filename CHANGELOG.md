# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.6] - 2026-10-22

### Added

- Back up and restore all connections (#27) ([a6dde0f](https://github.com/PylotLight/Blobfish/commit/a6dde0f207301a356cc45d489d701ebf8532e8d3))

### Fixed

- **(ui)** Solid modal sheets so content behind doesn't bleed through (#26) ([d687237](https://github.com/PylotLight/Blobfish/commit/d687237def61c1cb5215113c82441ed5ffeaa230))

### Other

- **(sidebar)** Surffish-style nav rows + icon footer (#28) ([d426be1](https://github.com/PylotLight/Blobfish/commit/d426be14d82ce9a12a43d87822efeb11f187acf5))
- Electron 45.0.0 stable (#29) ([2219cac](https://github.com/PylotLight/Blobfish/commit/2219cac74935a97cfea8c1b666eb83f70f295f09))

## [0.2.5] - 2026-10-20

### Fixed

- **(ui)** Collapsed sidebar gets a title-bar lane, expand button sits beside the traffic lights (#23) ([c815360](https://github.com/PylotLight/Blobfish/commit/c815360825eca346488054754c600aef660e283d))

## [0.2.4] - 2026-10-17

### Fixed

- **(home)** Drop the recent activity card (#20) ([1f60c38](https://github.com/PylotLight/Blobfish/commit/1f60c38eaef26b1641d2a6a0a83127fdf5a18350))
- **(ui)** Transfers dock is one solid surface, blur only on floating overlays (#21) ([192af5a](https://github.com/PylotLight/Blobfish/commit/192af5ab36d482ba86dacae332c8340b093cd551))

## [0.2.3] - 2026-10-16

### Added

- **(window)** Remember main window size/position (from Inkfish/Surffish) (#5) ([1775097](https://github.com/PylotLight/Blobfish/commit/17750974adbfb49eaa20e7bbe8147e1694614517))
- **(updates)** Release notifications + About & updates (from Inkfish/Surffish) (#6) ([8603982](https://github.com/PylotLight/Blobfish/commit/860398214bc58a87418662861bd2c32c6ad8a7b8))
- ⌘K command palette + quick switcher (from Inkfish/Surffish) (#7) ([b662716](https://github.com/PylotLight/Blobfish/commit/b662716043d278f89a80afe5a44209ef09888f21))
- Secret logo easter egg (triple-click the Blobfish logo) (#2) ([ecdbd82](https://github.com/PylotLight/Blobfish/commit/ecdbd8269f5777960c778cda63c86d3b235c08c5))
- **(explorer)** Finder-style keyboard nav for the file list (#14) ([3a0ffdc](https://github.com/PylotLight/Blobfish/commit/3a0ffdc90670f17d77315006e22565699ca59ef0))
- **(ui)** Svg icon set, one-row explorer toolbar, type scale tokens (#16) ([02a8a15](https://github.com/PylotLight/Blobfish/commit/02a8a150033259c6d58e0b2061f53cf183663e77))

### Documentation

- Add Blobfish README screenshot ([302c601](https://github.com/PylotLight/Blobfish/commit/302c601c343738b5b06c05a65b925def41b1ca61))

### Fixed

- **(stability)** Crash guard + ordered shutdown (from Inkfish/Surffish) (#4) ([7734aa0](https://github.com/PylotLight/Blobfish/commit/7734aa0ae406c583073435f607cc5e8d29159d77))
- **(a11y)** Visible keyboard focus ring + respect reduced motion (#11) ([394661e](https://github.com/PylotLight/Blobfish/commit/394661ecd8bcc4eca1ce16d0b7aca487b9fbf2a1))
- **(explorer)** Fast scroll on big folders no longer blanks the window (React #185) (#17) ([1ed831e](https://github.com/PylotLight/Blobfish/commit/1ed831e31357a22a634df40192e74d1c5a08aa7d))
- **(ui)** Transfers bar counts finished transfers, no stray tab-strip scrollbar (#18) ([438e489](https://github.com/PylotLight/Blobfish/commit/438e489edebc0b01a2fca263f04bc997b1b0314d))

### Performance

- Lazy-load the Azure SDKs in main and minify the renderer (#9) ([a2aacfe](https://github.com/PylotLight/Blobfish/commit/a2aacfe20809fca41ec33da2a0f709fc30128a79))
- Virtualize the blob list and memoize rows in Explorer (#8) ([bc86163](https://github.com/PylotLight/Blobfish/commit/bc8616309ed269e265b05bed84483a61f66342dc))
- **(transfers)** Coalesce snapshot IPC, stripe uploads >8MiB, fix speed/ETA (#10) ([a87d84f](https://github.com/PylotLight/Blobfish/commit/a87d84f986722efebd2ee6c69715f0a9dfe12dea))
- **(ui)** Let native vibrancy do the blur, css blur only on floating overlays (#12) ([b4427f1](https://github.com/PylotLight/Blobfish/commit/b4427f1abe0ab384a074f6cc65bf1dd9041193f0))
- **(listing)** Page past 5,000 items + parse listings off the main thread (#13) ([5a883a0](https://github.com/PylotLight/Blobfish/commit/5a883a09f432a76b5a82d5b4d8735440a0e7e04a))
- **(transfers)** Parallel ranged downloads + virtualized transfers panel with compact deltas (#15) ([59b1a68](https://github.com/PylotLight/Blobfish/commit/59b1a68559ab207a3f3c740152660be0f00babca))

## [0.2.2] - 2026-10-08

### Added

- **(preview)** Resizable CSV columns with content autosize, table polish ([3651c10](https://github.com/PylotLight/Blobfish/commit/3651c1081034f5b66ac9712221b52b7b73429852))
- **(preview)** Excel-style column options popover ([01de085](https://github.com/PylotLight/Blobfish/commit/01de085f1d4f8c325bdfd1e1950c0bf29acc95a9))
- **(blobs)** Move/clone blobs into a folder ([46aa5c9](https://github.com/PylotLight/Blobfish/commit/46aa5c9a88cd8726379ffba1eedb536743ffb70e))
- **(blobs)** Visual folder picker for move/copy destination ([221fd7a](https://github.com/PylotLight/Blobfish/commit/221fd7a03ca1ac01166aff4dd0817e697a7a8d3e))
- **(ui)** Dashboard home on launch ([e49b5d0](https://github.com/PylotLight/Blobfish/commit/e49b5d012d35c8eec29d59bdc1004a1e1ab2c833))
- **(transfers)** Inline delete for downloaded files ([ec34762](https://github.com/PylotLight/Blobfish/commit/ec347626c27eb00f4c68af77f94b7f69283d4f47))
- **(blobs)** Deleted view with undelete plus version history restore ([4565842](https://github.com/PylotLight/Blobfish/commit/4565842dd0b98395c321847c67c871393eabe106))
- **(transfers)** File completed transfers to activity, single feed ([c8688dc](https://github.com/PylotLight/Blobfish/commit/c8688dc6972f868a73fafd7c2425092b1e555662))

### Fixed

- **(ui)** Compact horizontal home hero, wider page ([28ab01b](https://github.com/PylotLight/Blobfish/commit/28ab01bffdeb032436576cd639593cbccce19f6d))
- **(blobs)** List-based collision check for move/copy ([ac8e0ec](https://github.com/PylotLight/Blobfish/commit/ac8e0ec6a585f995ce73491c02724e273b34aba2))
- **(blobs)** Replace-existing option, provable conflicts, batch dupes ([e961aed](https://github.com/PylotLight/Blobfish/commit/e961aedfa2b473f0237fb9d6578002dd3e8f5aec))
- **(blobs)** Delete confirm previews blast radius, audit names ([d6df06d](https://github.com/PylotLight/Blobfish/commit/d6df06daaca31386d104b776c6028c9a96bad5b0))
- **(ui)** Clickable home button, inline row actions, compact sidebar actions ([a05c670](https://github.com/PylotLight/Blobfish/commit/a05c67099651448960cb0a9914bf4ad702be4ed4))
- **(transfers)** Delete feedback on transfer rows, download-only file actions ([b4850ac](https://github.com/PylotLight/Blobfish/commit/b4850ac7ed34c92d58b77f2347b95ca5ff9ea872))
- **(ui)** Hover row actions, roomier new-connection button ([7ef5a24](https://github.com/PylotLight/Blobfish/commit/7ef5a240ca23c55432940a56aa1ef57bc843c013))
- **(ui)** Row actions in overflow menu, never over names ([febe6ba](https://github.com/PylotLight/Blobfish/commit/febe6baf75649af84da034245a0f8863a2b91bab))

## [0.2.1] - 2026-10-08

### Fixed

- **(ui)** Scope error banners per view so container 403s don't cover blobs ([1543f69](https://github.com/PylotLight/Blobfish/commit/1543f69e33f46ef65c271a4791d29a30d35ac8c0))
- **(azure)** Skip container probe for scoped attachments ([a7b5c29](https://github.com/PylotLight/Blobfish/commit/a7b5c2975280e769f5ee44020d1f895cc4cb1034))
- **(ui)** Honest container-list failure states ([84bf401](https://github.com/PylotLight/Blobfish/commit/84bf401bf50b0d38a09ba2201df1549083b9241f))

## [0.2.0] - 2026-10-07

### Added

- **(accounts)** Copy/export connection secret per connection ([9933d5c](https://github.com/PylotLight/Blobfish/commit/9933d5c2f6ee76bf193c8a83f36fce0ba03a8853))
- **(transfers)** Open/reveal downloaded files from dock ([ca92eb5](https://github.com/PylotLight/Blobfish/commit/ca92eb53a3c5e6cf40d26a61af5d62ea19de75ff))
- **(preview)** Sortable and filterable CSV columns ([634528a](https://github.com/PylotLight/Blobfish/commit/634528ab4c1caeddcb9d62c852c1ada4649e5cb4))

### Fixed

- **(transfers)** Download selected files flat, not parent dir ([7ac904f](https://github.com/PylotLight/Blobfish/commit/7ac904f6476b067f3c88eb3f46efd90ca5d6306e))

## [0.1.2] - 2026-10-05

### Added

- **(preview)** Range-based text/CSV file previews ([e6f4791](https://github.com/PylotLight/Blobfish/commit/e6f479158d8f0a941bed5f90a6de6b47db23dabe))
- **(explorer)** Tabbed previews, click-to-select, context menu, flat pinned containers ([97f44db](https://github.com/PylotLight/Blobfish/commit/97f44db803660f756584b4f4356fab12ab475cb1))
- **(ui)** Collapsible sidebar, quit button, settings width fix, single-frame logo ([a97caf9](https://github.com/PylotLight/Blobfish/commit/a97caf93e216f74413fffcfcdde0e5d093312f3f))
- **(cli)** Npm/bunx launcher for Blobfish ([efd5edd](https://github.com/PylotLight/Blobfish/commit/efd5edd1ecaf0d4b493f61cd02c316ea883dc0c4))

### Documentation

- Refresh status, shortcuts, npm install, roadmap ([0b38d5b](https://github.com/PylotLight/Blobfish/commit/0b38d5be5017847ba25a8fbe81153b174dd2f939))
- Homebrew removed --no-quarantine, manual xattr is the only path ([d458e98](https://github.com/PylotLight/Blobfish/commit/d458e982f9f8edc63f07652b995165ee06d54bc2))

### Fixed

- **(sas)** Scope-aware container clients, pin containers, resizable grid, sas autofill ([dcd901c](https://github.com/PylotLight/Blobfish/commit/dcd901c2ac314269946b44130f6b81c8c8b5f4ca))
- **(ui)** Single-root breadcrumb for scoped containers, row-count preview footer, readable context menu ([6d57139](https://github.com/PylotLight/Blobfish/commit/6d57139fc47ef76965d92c4b38e27b1644978a35))
- **(errors)** One 403 for one outage, deduped activity, stale-request guards ([90e3257](https://github.com/PylotLight/Blobfish/commit/90e32571d82e28d1e6866dbab54bc97e7a6c6fc9))
- **(cli)** Keep electron in devDependencies, fetch it on demand in launcher ([3119e10](https://github.com/PylotLight/Blobfish/commit/3119e10893b2c5d58359c0013a2e0abc0337a6fa))

## [0.1.1] - 2026-10-03

### Fixed

- **(tap)** Remove deprecated cask stanzas, add unsigned-build caveats ([68f5840](https://github.com/PylotLight/Blobfish/commit/68f5840895c5e4425b35ad7b91e2315e3c0c89f5))
- **(ui)** Unify explorer panel, polished error callouts + activity logging ([76917fb](https://github.com/PylotLight/Blobfish/commit/76917fb388823631bb8a34995371fb8ebc0562e3))
- **(ui)** Floating transfers dock, quieter errors, version in sidebar ([e37089d](https://github.com/PylotLight/Blobfish/commit/e37089d5bd77b5c79ec502ba1f71b30c84c576d1))
- **(ui)** Full-width hover dock, slim error banner, drop duplicate subtitle ([4608ef0](https://github.com/PylotLight/Blobfish/commit/4608ef0e97f266a32f4a5a68184a8aeb3198d983))
- **(ui)** Dock alignment, hover intent, drop duplicate error toast ([29c3aa3](https://github.com/PylotLight/Blobfish/commit/29c3aa34cda8504569639a9adff0fcec0e17b284))
- **(ui)** Consolidate settings into grouped single panel ([c9a44ab](https://github.com/PylotLight/Blobfish/commit/c9a44ab535c68d3b920d788212282e3c35b6e32e))

## [0.1.0] - 2026-10-03

### Added

- **(storage)** Foundational accounts — safeStorage profiles, 3 attach kinds, container/blob listing ([237f460](https://github.com/PylotLight/Blobfish/commit/237f4600bbf110903ac61ee9019fa1315a4579bc))
- **(storage)** Wizard, tree sidebar, quick access, blob/container CRUD ([18521bc](https://github.com/PylotLight/Blobfish/commit/18521bce2236e9d2a1b576faa345e3921fa0aee0))
- **(ui)** ASE-style browser, app menu with zoom, drop container dropdown ([f2c27f8](https://github.com/PylotLight/Blobfish/commit/f2c27f81dec27a622b2a50f602a0f5cbd06f1e34))
- **(ui)** Settings, intentional confirms, smoother rollout, sidebar cleanup ([b104416](https://github.com/PylotLight/Blobfish/commit/b1044169349d7c11d6516c1ff4fd211ce3e0c548))
- **(transfers)** Queued streaming uploads/downloads with progress dock ([dd73abe](https://github.com/PylotLight/Blobfish/commit/dd73abeb8412cd668cd162ecf6a4f4194d524809))
- **(ui)** Dialog blur, parent row, sidebar container actions, settings page, accents, sticky toolbar ([5d618a6](https://github.com/PylotLight/Blobfish/commit/5d618a6cd76007053652e2af1ffaa569ee90b3ac))
- **(settings)** Custom accent color picker ([e984b16](https://github.com/PylotLight/Blobfish/commit/e984b163519283c3cccaa250fad74110b0c286e4))
- **(icons)** Wire app icon into debug and release builds ([23314b8](https://github.com/PylotLight/Blobfish/commit/23314b8d3a672da5e5918cd24d12d76cced1790c))
- **(release)** Tag-driven release flow with changelog + homebrew cask ([6daf36d](https://github.com/PylotLight/Blobfish/commit/6daf36d85a18e8262f1e0f4d5197246f00a36e3d))

### Fixed

- **(ipc)** Remove duplicate transfers:configure handler ([c0ff2a6](https://github.com/PylotLight/Blobfish/commit/c0ff2a66f373f50acad7ae479d9827b4388ebd5e))
- **(release)** Don't fail when version/changelog are unchanged ([76fc7a5](https://github.com/PylotLight/Blobfish/commit/76fc7a52b36395cb283833d22b255919741779cd))
- **(release)** Match electron-builder's mac artifact naming ([fabf2f0](https://github.com/PylotLight/Blobfish/commit/fabf2f0f1f04942e54fd9da4e5e58406ddb0230f))

### Other

- Initial commit ([2941127](https://github.com/PylotLight/Blobfish/commit/2941127fa5df075422d72c5112a631101a8102d7))
- Blobfish identity on starter template (config, package, readme) ([9718d04](https://github.com/PylotLight/Blobfish/commit/9718d04614759cf98264fabd561785edc44b67a8))
- Add app build/icon assets ([d4780b7](https://github.com/PylotLight/Blobfish/commit/d4780b7d445fc77be83edf8161ff639de448e3cb))

[0.2.6]: https://github.com/PylotLight/Blobfish/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/PylotLight/Blobfish/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/PylotLight/Blobfish/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/PylotLight/Blobfish/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/PylotLight/Blobfish/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/PylotLight/Blobfish/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PylotLight/Blobfish/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/PylotLight/Blobfish/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/PylotLight/Blobfish/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/PylotLight/Blobfish/releases/tag/v0.1.0

<!-- generated by git-cliff -->

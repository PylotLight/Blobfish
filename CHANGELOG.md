# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.1]: https://github.com/PylotLight/Blobfish/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PylotLight/Blobfish/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/PylotLight/Blobfish/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/PylotLight/Blobfish/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/PylotLight/Blobfish/releases/tag/v0.1.0

<!-- generated by git-cliff -->

/**
 * ⌘K command palette + quick switcher: command descriptors, fuzzy matching, highlight ranges and
 * the ranked result list. Pure, so it is unit tested and runs in the renderer.
 *
 * Fuzzy matcher, accelerator labels and recents are ported from Inkfish #53 (originally
 * Surffish #67); the sources are Blobfish's: actions plus connections, containers and recent
 * paths ("places").
 */

export type PaletteMode = "all" | "places" | "commands";

export interface PaletteCommand {
  id: string;
  title: string;
  /** Extra words that find this command ("sas" finds "Copy connection secret"). */
  keywords?: string[];
  /** Electron-style accelerator (`CmdOrCtrl+Shift+M`) shown as a hint, or null. */
  accelerator?: string | null;
  section: string;
  enabled?: boolean;
}

export type PlaceKind = "connection" | "container" | "path";

/** Somewhere the quick switcher can jump to: a connection, a container or a recent folder. */
export interface PalettePlace {
  /** Stable key, e.g. `conn:<id>`, `ctr:<id>/<name>`, `path:<id>/<container>/<prefix>`. */
  id: string;
  kind: PlaceKind;
  title: string;
  subtitle: string;
  keywords?: string[];
}

export type PaletteItem =
  | {
      kind: "command";
      key: string;
      title: string;
      subtitle: string;
      shortcut: string | null;
      commandId: string;
      score: number;
      /** Character indices in `title` that matched, for highlighting. */
      hits: number[];
    }
  | {
      kind: "place";
      key: string;
      title: string;
      subtitle: string;
      placeKind: PlaceKind;
      placeId: string;
      score: number;
      hits: number[];
    };

export const MAX_RECENT = 20;
const MAX_RESULTS = 50;
/** Empty query in `all` mode: this many places under the recent commands. */
const EMPTY_QUERY_PLACES = 8;

// ---------------------------------------------------------------------------
// Shortcut labels

const MAC_KEY_SYMBOLS: Record<string, string> = {
  CmdOrCtrl: "⌘",
  CommandOrControl: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  Super: "⌘",
  Meta: "⌘",
  Ctrl: "⌃",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};
const MAC_MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const KEY_NAMES: Record<string, string> = {
  Plus: "+",
  Minus: "-",
  Equal: "=",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Enter: "↩",
  Return: "↩",
  Escape: "Esc",
  Esc: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  Space: "Space",
};

/** `CmdOrCtrl+Shift+P` -> `⇧⌘P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatAccelerator(
  accelerator: string | null | undefined,
  platform: string,
): string | null {
  if (!accelerator) return null;
  const plusKey = accelerator.endsWith("++");
  const parts = (plusKey ? accelerator.slice(0, -2) : accelerator)
    .split("+")
    .filter(Boolean);
  const rawKey = plusKey ? "+" : (parts.pop() ?? "");
  const key =
    KEY_NAMES[rawKey] ?? (rawKey.length === 1 ? rawKey.toUpperCase() : rawKey);
  if (platform === "darwin") {
    const modifiers = parts.map((part) => MAC_KEY_SYMBOLS[part] ?? part);
    modifiers.sort(
      (a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b),
    );
    return `${modifiers.join("")}${key}`;
  }
  const names = parts.map((part) =>
    /^(CmdOrCtrl|CommandOrControl|Ctrl|Control)$/.test(part)
      ? "Ctrl"
      : /^(Cmd|Command|Super|Meta)$/.test(part)
        ? "Win"
        : part === "Option"
          ? "Alt"
          : part,
  );
  return [...names, key].join("+");
}

// ---------------------------------------------------------------------------
// Fuzzy matching

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  return (
    /[\s\-_./:()[\]]/.test(previous) ||
    (/[a-z]/.test(previous) && /[A-Z]/.test(text[index]!))
  );
}

/**
 * Subsequence match with bonuses for word starts and runs; null when `query` isn't a
 * subsequence of `text`. Higher is better. Case-insensitive.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.toLocaleLowerCase();
  if (!needle) return 0;
  const haystack = text.toLocaleLowerCase();
  if (!haystack) return null;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) {
    // Contiguous hit: prefer the very start, then a word start, then anywhere.
    const base = direct === 0 ? 100 : isWordStart(text, direct) ? 80 : 50;
    return (
      base +
      needle.length * 4 -
      Math.min(direct, 30) * 0.5 -
      haystack.length * 0.05
    );
  }
  let score = 0;
  let position = 0;
  let run = 0;
  for (const char of needle) {
    if (char === " ") continue;
    const index = haystack.indexOf(char, position);
    if (index < 0) return null;
    const gap = index - position;
    run = gap === 0 && position > 0 ? run + 1 : 0;
    score +=
      2 +
      run * 3 +
      (isWordStart(text, index) ? 6 : 0) -
      Math.min(gap, 10) * 0.4;
    position = index + 1;
  }
  return score - haystack.length * 0.05;
}

/** Every space-separated term must match one of the fields; the score sums the best field per term. */
export function matchFields(
  query: string,
  fields: readonly string[],
  weights: readonly number[] = [],
): number | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let total = 0;
  for (const term of terms) {
    let best: number | null = null;
    fields.forEach((field, index) => {
      const score = fuzzyScore(term, field);
      if (score === null) return;
      const weighted = score * (weights[index] ?? 1);
      if (best === null || weighted > best) best = weighted;
    });
    if (best === null) return null;
    total += best;
  }
  // Also reward the whole query matching the first field in one piece ("new folder").
  const whole =
    terms.length > 1 ? fuzzyScore(query.trim(), fields[0] ?? "") : null;
  return whole !== null && whole >= 50 ? total + whole : total;
}

/**
 * Character indices of `text` to highlight for `query`: per term, the contiguous hit when there
 * is one, else the greedy subsequence (same walk as `fuzzyScore`). Terms that only matched a
 * keyword or subtitle simply add nothing. Sorted, unique.
 */
export function highlightIndices(query: string, text: string): number[] {
  const haystack = text.toLocaleLowerCase();
  const hits = new Set<number>();
  for (const term of query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)) {
    const direct = haystack.indexOf(term);
    if (direct >= 0) {
      for (let i = 0; i < term.length; i++) hits.add(direct + i);
      continue;
    }
    const found: number[] = [];
    let position = 0;
    for (const char of term) {
      const index = haystack.indexOf(char, position);
      if (index < 0) {
        found.length = 0;
        break;
      }
      found.push(index);
      position = index + 1;
    }
    for (const i of found) hits.add(i);
  }
  return [...hits].sort((a, b) => a - b);
}

/** Split `text` into plain / highlighted runs for rendering. */
export function highlightRuns(
  text: string,
  hits: readonly number[],
): Array<{ text: string; hit: boolean }> {
  const set = new Set(hits);
  const runs: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i]!, hit });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Recents (command ids and place ids share one list, prefixed `cmd:` / `place:`)

export function recordRecent(
  recent: readonly string[],
  key: string,
  limit = MAX_RECENT,
): string[] {
  return [key, ...recent.filter((candidate) => candidate !== key)].slice(
    0,
    limit,
  );
}

export function parseRecent(value: unknown, limit = MAX_RECENT): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      !item ||
      item.length > 600 ||
      seen.has(item)
    )
      continue;
    seen.add(item);
    keys.push(item);
    if (keys.length >= limit) break;
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Query + results

/** `>` forces commands only (VS Code style), `@` places only; otherwise the mode it opened in. */
export function parsePaletteQuery(
  input: string,
  mode: PaletteMode,
): { query: string; mode: PaletteMode } {
  const trimmed = input.trimStart();
  if (trimmed.startsWith(">"))
    return { query: trimmed.slice(1).trim(), mode: "commands" };
  if (trimmed.startsWith("@"))
    return { query: trimmed.slice(1).trim(), mode: "places" };
  return { query: input.trim(), mode };
}

export interface PaletteSources {
  input: string;
  mode: PaletteMode;
  commands: readonly PaletteCommand[];
  /** In display order for an empty query (current/pinned first is the caller's call). */
  places: readonly PalettePlace[];
  recent: readonly string[];
  platform: string;
}

/** Recent entries get this added per rank (most recent = full boost). */
const RECENT_BOOST = 40;
/** A command beats a place on a tie (commands are the rarer, more deliberate pick). */
const COMMAND_WEIGHT = 1.1;
/** Connections slightly beat containers, which slightly beat deep paths. */
const PLACE_WEIGHT: Record<PlaceKind, number> = {
  connection: 1.05,
  container: 1,
  path: 0.95,
};

export function rankPalette(sources: PaletteSources): PaletteItem[] {
  const { query, mode } = parsePaletteQuery(sources.input, sources.mode);
  const recentRank = new Map(sources.recent.map((key, index) => [key, index]));
  const boost = (key: string): number => {
    const rank = recentRank.get(key);
    return rank === undefined ? 0 : RECENT_BOOST * (1 - rank / MAX_RECENT);
  };
  const items: PaletteItem[] = [];

  if (mode !== "places") {
    for (const command of sources.commands) {
      if (command.enabled === false) continue;
      const keywords = command.keywords ?? [];
      // Keywords find a command but rank below a title hit ("upl" -> Upload before uploads-keyword).
      const score = matchFields(
        query,
        [command.title, command.section, ...keywords],
        [1, 0.4, ...keywords.map(() => 0.6)],
      );
      if (score === null) continue;
      // Empty query in `all`: only recent commands (commands-only mode lists everything).
      if (!query && mode === "all" && !recentRank.has(`cmd:${command.id}`))
        continue;
      items.push({
        kind: "command",
        key: `cmd:${command.id}`,
        title: command.title,
        subtitle: command.section,
        shortcut: formatAccelerator(command.accelerator, sources.platform),
        commandId: command.id,
        score: score * COMMAND_WEIGHT + boost(`cmd:${command.id}`),
        hits: query ? highlightIndices(query, command.title) : [],
      });
    }
  }

  if (mode !== "commands") {
    if (!query) {
      // Empty query: recently picked places first, then the caller's order.
      const byRecent = sources.places
        .map((place, index) => ({ place, index }))
        .sort((a, b) => {
          const ra = recentRank.get(`place:${a.place.id}`) ?? Infinity;
          const rb = recentRank.get(`place:${b.place.id}`) ?? Infinity;
          return ra !== rb ? ra - rb : a.index - b.index;
        });
      const limit = mode === "places" ? MAX_RESULTS : EMPTY_QUERY_PLACES;
      byRecent.slice(0, limit).forEach(({ place }, index) => {
        items.push(placeItem(place, 30 - index * 0.01, []));
      });
    } else {
      for (const place of sources.places) {
        const keywords = place.keywords ?? [];
        const score = matchFields(
          query,
          [place.title, place.subtitle, ...keywords],
          [1, 0.6, ...keywords.map(() => 0.5)],
        );
        if (score === null) continue;
        items.push(
          placeItem(
            place,
            score * PLACE_WEIGHT[place.kind] + boost(`place:${place.id}`),
            highlightIndices(query, place.title),
          ),
        );
      }
    }
  }

  // Stable: equal scores keep source order (commands as registered, places as given).
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.score - a.item.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ item }) => item);
}

function placeItem(
  place: PalettePlace,
  score: number,
  hits: number[],
): PaletteItem {
  return {
    kind: "place",
    key: `place:${place.id}`,
    title: place.title,
    subtitle: place.subtitle,
    placeKind: place.kind,
    placeId: place.id,
    score,
    hits,
  };
}

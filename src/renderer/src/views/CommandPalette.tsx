import { useEffect, useMemo, useRef, useState } from "react";
import {
  highlightRuns,
  parseRecent,
  rankPalette,
  recordRecent,
  type PaletteCommand,
  type PaletteItem,
  type PalettePlace,
} from "../../../shared/command-palette";
import { locationKey } from "../../../shared/recent-locations";
import { Icon } from "./Icon";
import type { AccountSummary, StorageContainer } from "../../../shared/types";
import {
  getExplorerSnapshot,
  loadLocations,
  sendExplorerAction,
  type ExplorerAction,
  type PanelAction,
} from "../palette-bus";
import type { ThemeName } from "./Settings";
import "./CommandPalette.css";

const RECENT_KEY = "blobfish.palette.recent.v1";
const THEMES: Array<{ id: ThemeName; title: string }> = [
  { id: "midnight", title: "Midnight" },
  { id: "abyss", title: "Abyss" },
  { id: "slate", title: "Slate" },
];

function loadRecent(): string[] {
  try {
    return parseRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function saveRecent(keys: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(keys));
  } catch {
    // ignore
  }
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** What the palette can do in App (everything else goes over palette-bus). */
export interface PaletteAppActions {
  newConnection: () => void;
  goHome: () => void;
  openSettings: () => void;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeName) => void;
  open: (accountId: string, container: string | null, prefix?: string) => void;
  copySecret: (accountId: string) => void;
  panel: (action: PanelAction) => void;
}

interface RunnableCommand extends PaletteCommand {
  run: () => void;
}

type PlaceTarget = {
  accountId: string;
  container: string | null;
  prefix?: string;
};

function buildCommands(
  app: PaletteAppActions,
  selected: AccountSummary | null,
  theme: ThemeName,
): RunnableCommand[] {
  const snap = getExplorerSnapshot();
  const inExplorer = Boolean(
    selected && snap && snap.accountId === selected.id,
  );
  const inContainer = inExplorer && Boolean(snap?.container);
  const picked = inExplorer ? (snap?.selection ?? 0) : 0;
  const explorer = (action: ExplorerAction) => () => sendExplorerAction(action);
  const list: RunnableCommand[] = [
    {
      id: "new-connection",
      title: "New Connection…",
      section: "Connections",
      keywords: ["attach", "add", "account", "connect", "sas"],
      run: app.newConnection,
    },
    {
      id: "home",
      title: "Go to Home",
      section: "Connections",
      keywords: ["dashboard", "start"],
      run: app.goHome,
    },
    {
      id: "copy-secret",
      title: "Copy Connection Secret",
      section: selected ? `Connections · ${selected.name}` : "Connections",
      keywords: ["sas", "connection string", "key", "clipboard"],
      enabled: Boolean(selected),
      run: () => selected && app.copySecret(selected.id),
    },
    {
      id: "refresh",
      title: "Refresh",
      section: "Explorer",
      keywords: ["reload", "list"],
      enabled: inExplorer,
      run: explorer("refresh"),
    },
    {
      id: "upload-files",
      title: "Upload Files…",
      section: "Explorer",
      keywords: ["put", "send"],
      enabled: inContainer,
      run: explorer("upload-files"),
    },
    {
      id: "upload-folder",
      title: "Upload Folder…",
      section: "Explorer",
      keywords: ["directory", "put", "recursive"],
      enabled: inContainer,
      run: explorer("upload-folder"),
    },
    {
      id: "new-folder",
      title: "New Folder…",
      section: "Explorer",
      keywords: ["mkdir", "directory", "prefix", "create"],
      enabled: inContainer,
      run: explorer("new-folder"),
    },
    {
      id: "new-container",
      title: "New Container…",
      section: "Explorer",
      keywords: ["create", "bucket"],
      enabled: inExplorer && Boolean(snap?.canManageContainers),
      run: explorer("new-container"),
    },
    {
      id: "download",
      title: picked > 1 ? `Download ${picked} Selected` : "Download Selected",
      section: "Explorer",
      keywords: ["save", "get"],
      enabled: inContainer && picked > 0,
      run: explorer("download"),
    },
    {
      id: "copy-url",
      title:
        picked > 0
          ? picked > 1
            ? `Copy ${picked} URLs`
            : "Copy URL"
          : "Copy Folder URL",
      section: "Explorer",
      keywords: ["link", "clipboard", "href", "blob url"],
      enabled: inContainer,
      run: explorer("copy-url"),
    },
    {
      id: "copy-path",
      title: picked > 1 ? `Copy ${picked} Paths` : "Copy Path",
      section: "Explorer",
      keywords: ["name", "clipboard"],
      enabled: inContainer && picked > 0,
      run: explorer("copy-path"),
    },
    {
      id: "go-up",
      title: "Go Up a Folder",
      section: "Explorer",
      keywords: ["parent", "back"],
      enabled: inContainer,
      run: explorer("go-up"),
    },
    {
      id: "filter",
      title: "Filter This List",
      section: "Explorer",
      keywords: ["find", "search"],
      accelerator: "CmdOrCtrl+F",
      enabled: inExplorer,
      run: explorer("focus-filter"),
    },
    {
      id: "toggle-deleted",
      title: snap?.showDeleted ? "Hide Deleted Blobs" : "Show Deleted Blobs",
      section: "Explorer",
      keywords: ["soft delete", "restore", "undelete", "trash"],
      enabled: inContainer,
      run: explorer("toggle-deleted"),
    },
    {
      id: "toggle-transfers",
      title: "Toggle Transfers Panel",
      section: "View",
      keywords: ["uploads", "downloads", "queue", "dock"],
      run: () => app.panel("toggle-transfers"),
    },
    {
      id: "activity",
      title: "Show Activity",
      section: "View",
      keywords: ["log", "history", "errors"],
      run: () => app.panel("show-activity"),
    },
    {
      id: "toggle-sidebar",
      title: "Toggle Sidebar",
      section: "View",
      accelerator: "CmdOrCtrl+B",
      run: app.toggleSidebar,
    },
    {
      id: "settings",
      title: "Open Settings",
      section: "App",
      keywords: ["preferences", "tuning", "accent", "vibrancy"],
      run: app.openSettings,
    },
    ...THEMES.map((t) => ({
      id: `theme-${t.id}`,
      title: `Theme: ${t.title}`,
      section: "Appearance",
      keywords: ["color", "look", "dark"],
      enabled: theme !== t.id,
      run: () => app.setTheme(t.id),
    })),
    {
      id: "quit",
      title: "Quit Blobfish",
      section: "App",
      keywords: ["exit", "close"],
      run: () => void window.api.app.quit(),
    },
  ];
  return list;
}

function buildPlaces(
  accounts: AccountSummary[],
  containersCache: Record<string, StorageContainer[]>,
): { places: PalettePlace[]; targets: Map<string, PlaceTarget> } {
  const places: PalettePlace[] = [];
  const targets = new Map<string, PlaceTarget>();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const add = (place: PalettePlace, target: PlaceTarget): void => {
    if (targets.has(place.id)) return;
    places.push(place);
    targets.set(place.id, target);
  };
  const connection = (a: AccountSummary): void =>
    add(
      {
        id: `conn:${a.id}`,
        kind: "connection",
        title: a.name,
        subtitle: a.containerName
          ? `${a.containerName} · ${hostOf(a.endpoint)}`
          : hostOf(a.endpoint),
        keywords: [a.accountName ?? "", a.containerName ?? ""].filter(Boolean),
      },
      {
        accountId: a.id,
        container: a.kind === "account" ? null : (a.containerName ?? null),
      },
    );

  // Empty-query order: pinned connections, recent folders, other connections, containers.
  accounts.filter((a) => a.pinned).forEach(connection);
  for (const loc of loadLocations()) {
    const a = byId.get(loc.accountId);
    if (!a) continue;
    add(
      {
        id: `path:${locationKey(loc)}`,
        kind: "path",
        title: `${loc.prefix}/`,
        subtitle: `${loc.container} · ${a.name}`,
        keywords: [loc.container],
      },
      { accountId: a.id, container: loc.container, prefix: loc.prefix },
    );
  }
  accounts.filter((a) => !a.pinned).forEach(connection);
  const snap = getExplorerSnapshot();
  for (const a of accounts) {
    if (a.kind !== "account") continue;
    const names = new Set((containersCache[a.id] ?? []).map((c) => c.name));
    if (snap?.accountId === a.id) snap.containers.forEach((n) => names.add(n));
    for (const name of names) {
      add(
        {
          id: `ctr:${a.id}/${name}`,
          kind: "container",
          title: name,
          subtitle: a.name,
          keywords: [a.accountName ?? ""],
        },
        { accountId: a.id, container: name },
      );
    }
  }
  return { places, targets };
}

function Highlighted({
  text,
  hits,
}: {
  text: string;
  hits: number[];
}): React.JSX.Element {
  if (hits.length === 0) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, hits).map((run, i) =>
        run.hit ? (
          <mark key={i}>{run.text}</mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

function ItemIcon({
  item,
  accounts,
}: {
  item: PaletteItem;
  accounts: AccountSummary[];
}): React.JSX.Element {
  if (item.kind === "command")
    return (
      <span className="palette-glyph">
        <Icon name="chevronRight" size={14} />
      </span>
    );
  if (item.placeKind === "path") return <span className="file-ico folder" />;
  if (item.placeKind === "container")
    return <span className="kind-ico container" />;
  const id = item.placeId.slice("conn:".length);
  return (
    <span
      className={`kind-ico ${accounts.find((a) => a.id === id)?.kind ?? "account"}`}
    />
  );
}

/**
 * ⌘K command palette + quick switcher (ported from Inkfish #53 / Surffish #67). Type to fuzzy-find
 * actions, connections, containers and recent folders; `>` lists actions only, `@` places only.
 * ↑↓ / ⌃N ⌃P move, ↩ runs, Esc closes. Lazy-loaded from App.
 */
export default function CommandPalette({
  platform,
  accounts,
  containersCache,
  selectedId,
  theme,
  app,
  onClose,
}: {
  platform: string;
  accounts: AccountSummary[];
  containersCache: Record<string, StorageContainer[]>;
  selectedId: string | null;
  theme: ThemeName;
  app: PaletteAppActions;
  onClose: () => void;
}): React.JSX.Element {
  const [input, setInput] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  // Built once per open: the explorer can't change underneath a modal palette.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => buildCommands(app, selected, theme), []);
  const { places, targets } = useMemo(
    () => buildPlaces(accounts, containersCache),
    [accounts, containersCache],
  );

  const items = useMemo(
    () =>
      rankPalette({ input, mode: "all", commands, places, recent, platform }),
    [input, commands, places, recent, platform],
  );

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [input]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: PaletteItem | undefined): void => {
    if (!item) return;
    const next = recordRecent(recent, item.key);
    setRecent(next);
    saveRecent(next);
    onClose();
    if (item.kind === "place") {
      const target = targets.get(item.placeId);
      if (target) app.open(target.accountId, target.container, target.prefix);
    } else {
      commands.find((c) => c.id === item.commandId)?.run();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const down = e.key === "ArrowDown" || (e.ctrlKey && e.key === "n");
    const up = e.key === "ArrowUp" || (e.ctrlKey && e.key === "p");
    if (down || up) {
      e.preventDefault();
      if (items.length)
        setActive((i) => (i + (down ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette glass strong"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={input}
          placeholder="Search actions, connections, containers…  (> actions · @ places)"
          spellCheck={false}
          aria-label="Command palette search"
          aria-controls="palette-list"
          aria-activedescendant={
            items[active] ? `palette-${active}` : undefined
          }
          onChange={(e) => setInput(e.target.value)}
        />
        <div
          className="palette-list"
          id="palette-list"
          role="listbox"
          ref={listRef}
        >
          {items.length === 0 && (
            <div className="palette-empty muted small">No matches</div>
          )}
          {items.map((item, index) => (
            <div
              key={item.key}
              id={`palette-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={`palette-item${index === active ? " on" : ""}`}
              onMouseMove={() => index !== active && setActive(index)}
              onClick={() => choose(item)}
            >
              <span className="palette-icon" aria-hidden>
                <ItemIcon item={item} accounts={accounts} />
              </span>
              <span className="palette-text">
                <span className="palette-title">
                  <Highlighted text={item.title} hits={item.hits} />
                </span>
                <span className="palette-sub muted small">{item.subtitle}</span>
              </span>
              {item.kind === "command" && item.shortcut && (
                <kbd className="palette-kbd">{item.shortcut}</kbd>
              )}
            </div>
          ))}
        </div>
        <div className="palette-foot muted small">
          <span>↑↓ move</span>
          <span>↩ run</span>
          <span>&gt; actions</span>
          <span>@ places</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

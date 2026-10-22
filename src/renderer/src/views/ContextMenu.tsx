/**
 * Sidebar right-click menus (account, Blob Containers node, container), same
 * `.ctx-menu` look as the explorer's. Data driven so every item is a real
 * action: an unavailable one renders aria-disabled with a tooltip saying why,
 * and nothing is ever a stub.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export interface MenuAction {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** Why it's unavailable; renders the row aria-disabled with this as its tooltip. */
  disabledReason?: string;
  danger?: boolean;
  title?: string;
}

export type MenuEntry = MenuAction | "sep" | null | false | undefined;

/** Drop falsy entries and stray separators (no leading/trailing/double rules). */
export function cleanMenu(items: MenuEntry[]): (MenuAction | "sep")[] {
  const out: (MenuAction | "sep")[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it === "sep") {
      if (out.length && out[out.length - 1] !== "sep") out.push("sep");
    } else out.push(it);
  }
  while (out[out.length - 1] === "sep") out.pop();
  return out;
}

export function ContextMenu(props: {
  x: number;
  y: number;
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const entries = cleanMenu(props.items);

  // Keep on screen using the real size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(pad, Math.min(props.x, window.innerWidth - width - pad))}px`;
    el.style.top = `${Math.max(pad, Math.min(props.y, window.innerHeight - height - pad))}px`;
  }, [props.x, props.y, entries.length]);

  // Focus the first item; hand focus back to the row on close.
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLButtonElement>('button[role="menuitem"]')
      ?.focus();
    return () => {
      // Only if nothing else (a dialog's autofocus) has claimed focus meanwhile.
      const now = document.activeElement;
      const free = !now || now === document.body;
      if (free && restore && document.contains(restore)) restore.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function onMenuKey(e: React.KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(e.key)) return;
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    e.preventDefault();
    const cur = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey))
      next = (cur + 1) % items.length;
    else if (e.key === "ArrowUp" || e.key === "Tab")
      next = (cur - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else next = items.length - 1;
    items[next]?.focus();
  }

  return createPortal(
    <>
      <div
        className="ctx-overlay"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="ctx-menu sidebar-menu glass strong"
        role="menu"
        aria-label={props.label}
        style={{ left: `${props.x}px`, top: `${props.y}px` }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onMenuKey}
      >
        {entries.map((it, i) =>
          it === "sep" ? (
            <div key={`sep-${i}`} className="ctx-sep" aria-hidden />
          ) : (
            <button
              key={it.label}
              role="menuitem"
              className={it.danger ? "danger" : undefined}
              aria-disabled={it.disabledReason ? true : undefined}
              title={it.disabledReason ?? it.title}
              onClick={() => {
                if (it.disabledReason) return;
                onClose();
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={14} />} {it.label}
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  );
}

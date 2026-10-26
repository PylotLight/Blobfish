import { memo } from "react";
import type { StorageBlobItem } from "../../../../shared/types";
import { formatBytes } from "../../../../shared/format";
import { Icon, type IconName } from "../Icon";
import { formatWhen } from "./helpers";

export interface RowHandlers {
  click: (e: React.MouseEvent, key: string) => void;
  open: (item: StorageBlobItem) => void;
  context: (e: React.MouseEvent, key: string) => void;
  toggle: (key: string) => void;
}

/** One blob/folder row. Memoized: a selection change re-renders only the rows it touches. */
export const BlobRow = memo(function BlobRow(props: {
  item: StorageBlobItem;
  rowKey: string;
  index: number;
  id: string;
  active: boolean;
  selected: boolean;
  animate: boolean;
  handlers: RowHandlers;
  /** A file drag is hovering this folder row. */
  dropTarget?: boolean;
}): React.JSX.Element {
  const { item, rowKey: key, handlers } = props;
  return (
    <tr
      id={props.id}
      data-drop-folder={item.isPrefix && !item.deleted ? item.name : undefined}
      data-index={props.index}
      aria-rowindex={props.index + 2}
      aria-selected={props.selected}
      className={`row-in${props.animate ? "" : " no-anim"} clickable${props.selected ? " selected" : ""}${props.active ? " kb-active" : ""}${item.deleted ? " deleted" : ""}${props.dropTarget ? " drop-target" : ""}`}
      style={
        props.animate
          ? { animationDelay: `${Math.min(props.index, 10) * 12}ms` }
          : undefined
      }
      onClick={(e) => handlers.click(e, key)}
      onDoubleClick={() => handlers.open(item)}
      onContextMenu={(e) => handlers.context(e, key)}
      title={
        item.isPrefix
          ? "Open folder"
          : item.deleted
            ? "Deleted — restore to use"
            : "Double-click to preview · right-click for actions"
      }
    >
      <td className="check-col" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${item.leaf}`}
          checked={props.selected}
          onChange={() => handlers.toggle(key)}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="name-col">
        <span className="file-row" title={item.name}>
          <span
            className={`file-ico ${item.isPrefix ? "folder" : "file"}`}
            aria-hidden
          />
          {item.leaf}
          {item.deleted && <span className="pill warn row-badge">deleted</span>}
        </span>
      </td>
      <td className="num">{item.isPrefix ? "—" : formatBytes(item.size)}</td>
      <td className="muted">{formatWhen(item.lastModified)}</td>
    </tr>
  );
});

export function Action(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** Toggle buttons (Deleted) report their state. */
  pressed?: boolean;
  /** Keep the text label when the toolbar is too narrow for every label. */
  keepLabel?: boolean;
  working?: boolean;
  workingLabel?: string;
}): React.JSX.Element {
  const label = props.working
    ? (props.workingLabel ?? props.label)
    : props.label;
  return (
    <button
      className={`action${props.primary ? " primary" : ""}${props.danger ? " danger" : ""}${props.keepLabel ? " keep-label" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={label}
      aria-pressed={props.pressed}
      title={label}
    >
      <span className="action-icon" aria-hidden>
        <Icon name={props.icon} size={16} />
      </span>
      <span className="action-label">{label}</span>
    </button>
  );
}

export function Th(props: {
  label: string;
  k: "name" | "size" | "modified";
  sortKey: string;
  dir: 1 | -1;
  onSort: (k: "name" | "size" | "modified") => void;
  wide?: boolean;
  width?: number;
  resizeKey?: "size" | "modified";
  onResizeStart?: (e: React.MouseEvent, key: "size" | "modified") => void;
  onResetWidths?: () => void;
}): React.JSX.Element {
  const active = props.sortKey === props.k;
  return (
    <th
      className={`${props.wide ? "wide" : ""}${props.resizeKey ? " resizable" : ""}`}
      style={
        props.width
          ? {
              width: `${props.width}px`,
              minWidth: `${props.width}px`,
              maxWidth: `${props.width}px`,
            }
          : undefined
      }
    >
      <button
        className={`th-btn${active ? " active" : ""}`}
        onClick={() => props.onSort(props.k)}
      >
        {props.label}
        <span className="sort-arrow" aria-hidden>
          {active ? (
            <Icon name={props.dir === 1 ? "up" : "down"} size={12} />
          ) : null}
        </span>
      </button>
      {props.resizeKey && props.onResizeStart && (
        <span
          className="col-resizer"
          onMouseDown={(e) => props.onResizeStart!(e, props.resizeKey!)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            props.onResetWidths?.();
          }}
          title="Drag to resize · double-click to reset"
          aria-hidden
        />
      )}
    </th>
  );
}

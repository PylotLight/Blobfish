/**
 * One small inline SVG icon set for the whole UI (replaces the old Unicode
 * glyphs + the colour 👁 emoji, which rendered as missing-glyph boxes on Linux).
 * 24×24 grid, stroke = currentColor, one stroke width, round caps/joins, so
 * every icon picks up the button colour/hover/disabled state for free.
 * Path data adapted from Lucide (ISC licence).
 *
 * Icons are decorative (aria-hidden); the button around an icon-only control
 * carries the aria-label.
 */
import type React from "react";

type Shape = React.JSX.Element;

const P = (d: string): Shape => <path key={d} d={d} />;

const ICONS = {
  back: [P("M19 12H5"), P("m12 19-7-7 7-7")],
  forward: [P("M5 12h14"), P("m12 5 7 7-7 7")],
  up: [P("M12 19V5"), P("m5 12 7-7 7 7")],
  down: [P("M12 5v14"), P("m19 12-7 7-7-7")],
  refresh: [
    P("M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"),
    P("M21 3v5h-5"),
  ],
  search: [<circle key="c" cx="11" cy="11" r="7" />, P("m20 20-3.5-3.5")],
  close: [P("M18 6 6 18"), P("m6 6 12 12")],
  upload: [
    P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
    P("m17 8-5-5-5 5"),
    P("M12 3v12"),
  ],
  download: [
    P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"),
    P("m7 10 5 5 5-5"),
    P("M12 15V3"),
  ],
  folderPlus: [
    P(
      "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
    ),
    P("M12 10v6"),
    P("M9 13h6"),
  ],
  plus: [P("M5 12h14"), P("M12 5v14")],
  selectAll: [
    <rect key="r" x="3" y="3" width="18" height="18" rx="3" />,
    P("m8.5 12 2.5 2.5 4.5-5"),
  ],
  archive: [
    <rect key="r" x="2.5" y="3.5" width="19" height="5" rx="1.2" />,
    P("M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5"),
    P("M10 12.5h4"),
  ],
  eye: [
    P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"),
    <circle key="c" cx="12" cy="12" r="3" />,
  ],
  pencil: [
    P("M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"),
    P("m15 5 4 4"),
  ],
  restore: [P("M9 14 4 9l5-5"), P("M4 9h10.5a5.5 5.5 0 0 1 0 11H11")],
  move: [P("m16 3 4 4-4 4"), P("M20 7H4"), P("m8 21-4-4 4-4"), P("M4 17h16")],
  copy: [
    <rect key="r" x="8" y="8" width="13" height="13" rx="2" />,
    P("M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"),
  ],
  trash: [
    P("M3 6h18"),
    P("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"),
    P("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
    P("M10 11v6"),
    P("M14 11v6"),
  ],
  star: [
    P(
      "M12 2.8l2.84 5.76 6.36.92-4.6 4.49 1.09 6.33L12 17.3l-5.69 2.99 1.09-6.33-4.6-4.49 6.36-.92Z",
    ),
  ],
  more: [
    <circle key="a" cx="5" cy="12" r="1" />,
    <circle key="b" cx="12" cy="12" r="1" />,
    <circle key="c" cx="19" cy="12" r="1" />,
  ],
  chevronRight: [P("m9 18 6-6-6-6")],
  chevronLeft: [P("m15 18-6-6 6-6")],
  chevronDown: [P("m6 9 6 6 6-6")],
  chevronUp: [P("m18 15-6-6-6 6")],
  home: [
    P("M3 10.5 12 3l9 7.5"),
    P("M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9"),
  ],
  settings: [
    P(
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    ),
    <circle key="c" cx="12" cy="12" r="3" />,
  ],
  power: [P("M12 2v10"), P("M18.4 6.6a9 9 0 1 1-12.77.04")],
  check: [P("M20 6 9 17l-5-5")],
  fileDown: [
    P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"),
    P("M14 2v6h6"),
    P("M12 18v-6"),
    P("m9 15 3 3 3-3"),
  ],
  sidebar: [
    <rect key="r" x="3" y="3" width="18" height="18" rx="3" />,
    P("M9 3v18"),
  ],
  binary: [
    P(
      "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
    ),
  ],
  grid: [
    <rect key="a" x="3" y="3" width="7" height="7" rx="1.5" />,
    <rect key="b" x="14" y="3" width="7" height="7" rx="1.5" />,
    <rect key="c" x="3" y="14" width="7" height="7" rx="1.5" />,
    <rect key="d" x="14" y="14" width="7" height="7" rx="1.5" />,
  ],
  inbox: [
    P("M22 12h-6l-2 3h-4l-2-3H2"),
    P(
      "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
    ),
  ],
  parent: [P("M9 14 4 9l5-5"), P("M20 20v-7a4 4 0 0 0-4-4H4")],
  key: [
    <circle key="c" cx="7.5" cy="15.5" r="5.5" />,
    P("m21 2-9.6 9.6"),
    P("m15.5 7.5 3 3L22 7l-3-3"),
  ],
  link: [
    P("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"),
    P("M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
  ],
  lock: [
    <rect key="r" x="3" y="11" width="18" height="11" rx="2" />,
    P("M7 11V7a5 5 0 0 1 10 0v4"),
  ],
  unlock: [
    <rect key="r" x="3" y="11" width="18" height="11" rx="2" />,
    P("M7 11V7a5 5 0 0 1 9.9-1"),
  ],
  info: [
    <circle key="c" cx="12" cy="12" r="10" />,
    P("M12 16v-4"),
    P("M12 8h.01"),
  ],
  shield: [
    P(
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    ),
  ],
  globe: [
    <circle key="c" cx="12" cy="12" r="10" />,
    P("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"),
    P("M2 12h20"),
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon(props: {
  name: IconName;
  /** px; defaults to 16. */
  size?: number;
  /** Filled variant (star when pinned). */
  filled?: boolean;
  className?: string;
}): React.JSX.Element {
  const size = props.size ?? 16;
  return (
    <svg
      className={`icon${props.className ? ` ${props.className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[props.name]}
    </svg>
  );
}

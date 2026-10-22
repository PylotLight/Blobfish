import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./blobfish-egg.css";

// A little blobfish (droopy nose at +x, tail fin trailing), drawn around the origin so it can ride a path.
const BODY =
  "M30-2C30-18 16-26-2-24C-18-22-26-12-28-4L-42-16C-46-6-46 6-42 16L-28 4C-24 14-12 22 4 22C20 22 30 14 30-2Z";
const FIN = "M2 6C-2 15-10 18-14 13C-9 12-4 9 2 6Z";
// The blobfish's drift: a lazy oval loop around the logo, clockwise. Its wake bubbles ride the same path.
const DRIFT = "M-340 0C-340-230 340-230 340 0C340 230-340 230-340 0Z";
const DRIFT_SECONDS = 16;
// Wake: bubbles trailing behind the fish on the same clock (how far behind, in seconds, and how big).
const WAKE = [
  { lag: 0.45, r: 5 },
  { lag: 0.8, r: 3.8 },
  { lag: 1.15, r: 2.8 },
  { lag: 1.5, r: 2 },
];
// Reduced motion: the fish rests on the upper-left of the loop (a quarter into the top curve), heading up-right.
const STILL_TRANSFORM = "translate(-234 -129) rotate(-24)";

// "Blobs" (data blocks) sinking like marine snow: where, what, when, how slow, and where they rest when still.
const BLOBS = [
  { x: 8, label: ".json", delay: 0, duration: 19, still: 22 },
  { x: 19, label: "0101", delay: 6.5, duration: 23, still: 64 },
  { x: 31, label: ".png", delay: 2.8, duration: 21, still: 12 },
  { x: 70, label: ".parquet", delay: 9, duration: 24, still: 18 },
  { x: 81, label: "{ }", delay: 1.6, duration: 18, still: 58 },
  { x: 92, label: ".csv", delay: 4.4, duration: 22, still: 34 },
  { x: 44, label: ".vhd", delay: 12, duration: 25, still: 6 },
  { x: 58, label: ".log", delay: 15, duration: 20, still: 74 },
];
// Marine snow: tiny specks drifting down (x %, size px, delay s, duration s, resting y % when still).
const SNOW = [
  [4, 2, 0, 14, 40],
  [11, 3, 5, 18, 75],
  [16, 2, 9, 16, 15],
  [23, 2, 2, 20, 52],
  [28, 3, 11, 15, 88],
  [35, 2, 7, 19, 30],
  [41, 2, 3, 17, 66],
  [49, 3, 13, 21, 8],
  [53, 2, 1, 16, 92],
  [63, 2, 8, 18, 44],
  [67, 3, 4, 14, 72],
  [74, 2, 10, 20, 26],
  [78, 2, 6, 17, 95],
  [86, 3, 12, 19, 48],
  [89, 2, 3, 15, 10],
  [96, 2, 9, 18, 62],
] as const;
// Rising bubbles (x %, size px, delay s, duration s, height % where they hang when still).
const BUBBLES = [
  { x: 6, size: 8, delay: 0, duration: 10, still: 22 },
  { x: 14, size: 5, delay: 3.1, duration: 8, still: 48 },
  { x: 24, size: 11, delay: 5.2, duration: 12, still: 12 },
  { x: 37, size: 6, delay: 1.4, duration: 9, still: 36 },
  { x: 63, size: 9, delay: 4, duration: 11, still: 58 },
  { x: 72, size: 5, delay: 6.3, duration: 8, still: 18 },
  { x: 84, size: 12, delay: 0.9, duration: 13, still: 42 },
  { x: 94, size: 7, delay: 2.7, duration: 9.5, still: 28 },
];
// Light shafts from the surface, far above.
const RAYS = [
  { x: 18, w: 9, delay: 0 },
  { x: 41, w: 6, delay: 2.5 },
  { x: 63, w: 11, delay: 1.2 },
  { x: 83, w: 7, delay: 3.6 },
];

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The blobfish riding the drift path nose first, with a slow jelly wobble. SMIL so it shares the wake's clock. */
function Drifter({ still }: { still: boolean }): React.JSX.Element {
  return (
    <g
      className="blobfish-egg-fish"
      transform={still ? STILL_TRANSFORM : undefined}
    >
      {!still && (
        <animateMotion
          dur={`${DRIFT_SECONDS}s`}
          repeatCount="indefinite"
          rotate="auto"
          path={DRIFT}
          calcMode="linear"
        />
      )}
      <g>
        {!still && (
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1 1;1.07 0.92;0.96 1.05;1 1"
            dur="2.4s"
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;0.4;0.75;1"
            keySplines=".4 0 .6 1;.4 0 .6 1;.4 0 .6 1"
          />
        )}
        <path d={BODY} fill="url(#blobfish-egg-fill)" />
        <path d={FIN} fill="#d9fff4" opacity="0.75" />
        {/* The famous droopy nose. */}
        <ellipse
          cx="30"
          cy="7"
          rx="8"
          ry="7.5"
          fill="url(#blobfish-egg-nose)"
        />
        <circle cx="14" cy="-9" r="2.6" fill="#06231f" />
        <circle cx="14.9" cy="-9.9" r="0.9" fill="#ffffff" />
        <path
          d="M11 4Q16 8 21 5"
          fill="none"
          stroke="#0b3a33"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

/**
 * The logo easter egg: a window-sized deep-sea scene with the Blobfish logo floating in the dark
 * while a little blobfish drifts a slow loop around it, trailing bubbles. Data "blobs" sink like
 * marine snow, light shafts sway from far above and bubbles rise. Pure CSS/SVG, no new assets (the
 * logo is the sidebar's own). Closes on a click anywhere, Esc, or the window losing focus.
 * Reduced motion (OS setting or Settings → Motion) gets the same scene, still.
 */
export default function BlobfishEgg({
  logoUrl,
  reducedMotion,
  onClose,
}: {
  logoUrl: string;
  reducedMotion: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [osReduced] = useState(prefersReducedMotion);
  const still = reducedMotion || osReduced;
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // Capture phase so the explorer / dialog Esc handlers don't see it while the egg is up.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={dialogRef}
      className={`blobfish-egg${still ? " is-still" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Blobfish"
      tabIndex={-1}
      onClick={onClose}
    >
      <div className="blobfish-egg-deep" aria-hidden="true">
        {RAYS.map((r, i) => (
          <span
            key={i}
            className="blobfish-egg-ray"
            style={{
              left: `${r.x}%`,
              width: `${r.w}%`,
              animationDelay: `${r.delay}s`,
            }}
          />
        ))}
        {SNOW.map(([x, size, delay, duration, y], i) => (
          <span
            key={i}
            className="blobfish-egg-snow"
            style={
              {
                left: `${x}%`,
                width: size,
                height: size,
                animationDelay: `${-delay}s`,
                animationDuration: `${duration}s`,
                "--still-y": `${y}%`,
              } as React.CSSProperties
            }
          />
        ))}
        {BLOBS.map((b, i) => (
          <span
            key={i}
            className="blobfish-egg-blob"
            style={
              {
                left: `${b.x}%`,
                animationDelay: `${-b.delay}s`,
                animationDuration: `${b.duration}s`,
                "--still-y": `${b.still}%`,
              } as React.CSSProperties
            }
          >
            {b.label}
          </span>
        ))}
      </div>
      <div className="blobfish-egg-stage" aria-hidden="true">
        <div className="blobfish-egg-glow" />
        <svg className="blobfish-egg-swim" viewBox="-400 -200 800 400">
          <defs>
            <linearGradient id="blobfish-egg-fill" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#4fe0c0" />
              <stop offset="1" stopColor="#c8fff0" />
            </linearGradient>
            <radialGradient id="blobfish-egg-nose" cx="0.4" cy="0.35" r="0.7">
              <stop offset="0" stopColor="#e6fff8" />
              <stop offset="1" stopColor="#7febd2" />
            </radialGradient>
          </defs>
          <path d={DRIFT} className="blobfish-egg-path" />
          {!still &&
            WAKE.map((w, i) => (
              <circle key={i} r={w.r} className="blobfish-egg-wake">
                {/* Same path and clock as the fish, started `lag` seconds behind it. */}
                <animateMotion
                  dur={`${DRIFT_SECONDS}s`}
                  begin={`${-(DRIFT_SECONDS - w.lag)}s`}
                  repeatCount="indefinite"
                  path={DRIFT}
                  calcMode="linear"
                />
              </circle>
            ))}
          <Drifter still={still} />
        </svg>
        <div className="blobfish-egg-logo">
          <img src={logoUrl} alt="" draggable={false} />
          <span className="blobfish-egg-shine" />
        </div>
      </div>
      <div className="blobfish-egg-sea" aria-hidden="true">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="blobfish-egg-bubble"
            style={
              {
                left: `${b.x}%`,
                width: b.size,
                height: b.size,
                animationDelay: `${b.delay}s`,
                animationDuration: `${b.duration}s`,
                "--still-b": `${b.still}%`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="blobfish-egg-caption">
        <strong>Blobfish</strong>
        <span>you found the blob · click anywhere or press Esc</span>
      </div>
    </div>,
    document.body,
  );
}

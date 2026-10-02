export type ThemeName = 'midnight' | 'abyss' | 'slate'
export type DensityName = 'comfortable' | 'compact'
export type MotionName = 'full' | 'reduced'
export type AccentName = 'mint' | 'sky' | 'violet' | 'amber' | 'coral'

export interface Prefs {
  theme: ThemeName
  density: DensityName
  motion: MotionName
  accent: AccentName
  vibrancy: boolean
  /** Parallel block connections per upload (1–16). */
  uploadConcurrency: number
  /** Simultaneous transfers (1–4). */
  maxParallel: number
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'midnight',
  density: 'comfortable',
  motion: 'full',
  accent: 'mint',
  vibrancy: true,
  uploadConcurrency: 8,
  maxParallel: 2
}

const KEY = 'blobfish.settings.v1'

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.floor(v)))
    : fallback
}

const ACCENTS: AccentName[] = ['mint', 'sky', 'violet', 'amber', 'coral']
const THEMES: ThemeName[] = ['midnight', 'abyss', 'slate']

function isTheme(v: unknown): v is ThemeName {
  return v === 'midnight' || v === 'abyss' || v === 'slate'
}

function isAccent(v: unknown): v is AccentName {
  return typeof v === 'string' && (ACCENTS as string[]).includes(v)
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : 'midnight',
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'full',
      accent: isAccent(parsed.accent) ? parsed.accent : 'mint',
      vibrancy: parsed.vibrancy !== false,
      uploadConcurrency: clampInt(parsed.uploadConcurrency, 1, 16, DEFAULT_PREFS.uploadConcurrency),
      maxParallel: clampInt(parsed.maxParallel, 1, 4, DEFAULT_PREFS.maxParallel)
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Private mode etc. — prefs just won't persist.
  }
}

const THEME_META: Record<ThemeName, { title: string; desc: string }> = {
  midnight: { title: 'Midnight', desc: 'Default dark blue-grey.' },
  abyss: { title: 'Abyss', desc: 'Deeper black, low-glare.' },
  slate: { title: 'Slate', desc: 'Softer graphite.' }
}

const ACCENT_META: Record<AccentName, { title: string; desc: string }> = {
  mint: { title: 'Mint', desc: 'Default green.' },
  sky: { title: 'Sky', desc: 'Cool blue.' },
  violet: { title: 'Violet', desc: 'Soft purple.' },
  amber: { title: 'Amber', desc: 'Warm gold.' },
  coral: { title: 'Coral', desc: 'Warm red-orange.' }
}

/**
 * Full in-app settings view (not a modal) — room to grow as more
 * sections land. Rendered as the main content view.
 */
export function SettingsView(props: {
  prefs: Prefs
  vibrancySupported: boolean
  onChange: (prefs: Prefs) => void
  onBack: () => void
}): React.JSX.Element {
  const { prefs } = props
  const set = (patch: Partial<Prefs>): void => props.onChange({ ...prefs, ...patch })

  return (
    <section className="card settings-page fade-in" aria-label="Settings">
      <div className="row between settings-top">
        <div>
          <span className="eyebrow">Blobfish</span>
          <h2 className="settings-title">Settings</h2>
          <p className="muted small settings-sub">
            Stored locally in this app — nothing leaves your machine.
          </p>
        </div>
        <button className="btn ghost small" onClick={props.onBack}>
          ← Back
        </button>
      </div>

      <div className="settings-grid">
        <div className="settings-section">
          <h4>Theme</h4>
          <div className="seg-row" role="radiogroup" aria-label="Theme">
            {THEMES.map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={prefs.theme === id}
                className={`seg${prefs.theme === id ? ' selected' : ''}`}
                onClick={() => set({ theme: id })}
                title={THEME_META[id]!.desc}
              >
                <span className={`swatch ${id}`} aria-hidden />
                {THEME_META[id]!.title}
              </button>
            ))}
          </div>
          <p className="muted small">{THEME_META[prefs.theme]!.desc} Accent applies on top.</p>
        </div>

        <div className="settings-section">
          <h4>Accent color</h4>
          <div className="seg-row" role="radiogroup" aria-label="Accent color">
            {(Object.keys(ACCENT_META) as AccentName[]).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={prefs.accent === id}
                className={`seg${prefs.accent === id ? ' selected' : ''}`}
                onClick={() => set({ accent: id })}
                title={ACCENT_META[id]!.desc}
              >
                <span className={`swatch accent-${id}`} aria-hidden />
                {ACCENT_META[id]!.title}
              </button>
            ))}
          </div>
          <p className="muted small">
            Drives buttons, links, progress bars, selection and focus rings.
          </p>
        </div>

        <div className="settings-section">
          <h4>Density</h4>
          <div className="seg-row" role="radiogroup" aria-label="Density">
            {(['comfortable', 'compact'] as DensityName[]).map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={prefs.density === d}
                className={`seg${prefs.density === d ? ' selected' : ''}`}
                onClick={() => set({ density: d })}
              >
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h4>Motion</h4>
          <div className="seg-row" role="radiogroup" aria-label="Motion">
            {(['full', 'reduced'] as MotionName[]).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={prefs.motion === m}
                className={`seg${prefs.motion === m ? ' selected' : ''}`}
                onClick={() => set({ motion: m })}
              >
                {m === 'full' ? 'Full' : 'Reduced'}
              </button>
            ))}
          </div>
          <p className="muted small">Reduced disables entrance, shimmer and progress animations.</p>
        </div>

        <div className="settings-section">
          <h4>Transfers</h4>
          <label className="field">
            <span>
              Upload connections per file: <code>{prefs.uploadConcurrency}</code>
            </span>
            <input
              type="range"
              min={1}
              max={16}
              value={prefs.uploadConcurrency}
              onChange={(e) => set({ uploadConcurrency: Number(e.target.value) })}
            />
          </label>
          <p className="muted small">
            More connections saturate fast links; fewer are kinder to small networks and Azurite.
            Downloads stream on a single connection each.
          </p>
          <label className="field">
            <span>
              Simultaneous transfers: <code>{prefs.maxParallel}</code>
            </span>
            <input
              type="range"
              min={1}
              max={4}
              value={prefs.maxParallel}
              onChange={(e) => set({ maxParallel: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="settings-section">
          <h4>Window</h4>
          <label className="field row between">
            <span>Native vibrancy blur {props.vibrancySupported ? '(macOS)' : ''}</span>
            <button
              role="switch"
              aria-checked={prefs.vibrancy}
              className={`switch${prefs.vibrancy ? ' on' : ''}`}
              disabled={!props.vibrancySupported}
              onClick={() => set({ vibrancy: !prefs.vibrancy })}
            >
              <span className="knob" />
            </button>
          </label>
          {!props.vibrancySupported && (
            <p className="muted small">Vibrancy is only available on macOS.</p>
          )}
        </div>
      </div>

      <div className="row end">
        <button className="btn mint" onClick={props.onBack}>
          Done
        </button>
      </div>
    </section>
  )
}

/** Back-compat wrapper — new code should use SettingsView directly. */
export function SettingsDialog(props: {
  prefs: Prefs
  vibrancySupported: boolean
  onChange: (prefs: Prefs) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal glass strong settings-modal fade-in"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsView
          prefs={props.prefs}
          vibrancySupported={props.vibrancySupported}
          onChange={props.onChange}
          onBack={props.onClose}
        />
      </div>
    </div>
  )
}

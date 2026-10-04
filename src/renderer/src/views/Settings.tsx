export type ThemeName = 'midnight' | 'abyss' | 'slate'
export type DensityName = 'comfortable' | 'compact'
export type MotionName = 'full' | 'reduced'
export type AccentName = 'mint' | 'sky' | 'violet' | 'amber' | 'coral' | 'custom'

export interface Prefs {
  theme: ThemeName
  density: DensityName
  motion: MotionName
  accent: AccentName
  /** Custom accent hex (`#rrggbb`) used when `accent === 'custom'`. */
  customAccent: string
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
  customAccent: '#7ee2a8',
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

const ACCENTS: AccentName[] = ['mint', 'sky', 'violet', 'amber', 'coral', 'custom']
const THEMES: ThemeName[] = ['midnight', 'abyss', 'slate']

function isTheme(v: unknown): v is ThemeName {
  return v === 'midnight' || v === 'abyss' || v === 'slate'
}

function isAccent(v: unknown): v is AccentName {
  return typeof v === 'string' && (ACCENTS as string[]).includes(v)
}

function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

/** Custom accent → CSS variable overrides applied inline on `.shell`. */
export function accentVars(prefs: Prefs): Record<string, string> {
  if (prefs.accent !== 'custom' || !isHex(prefs.customAccent)) return {}
  const hex = prefs.customAccent
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Relative luminance picks readable button text for any chosen color.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const ink = lum > 0.45 ? '#10141a' : '#f2f4f6'
  return {
    '--accent': hex,
    '--accent-ink': ink,
    '--mint': hex,
    '--mint-ink': ink,
    '--mint-dim': `rgba(${r}, ${g}, ${b}, 0.16)`
  }
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
      customAccent: isHex(parsed.customAccent) ? parsed.customAccent : DEFAULT_PREFS.customAccent,
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
  coral: { title: 'Coral', desc: 'Warm red-orange.' },
  custom: { title: 'Custom', desc: 'Pick any color below.' }
}

const PRESET_ACCENTS: AccentName[] = ['mint', 'sky', 'violet', 'amber', 'coral']

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

      <div className="settings-groups">
        <section className="settings-group">
          <h4>Appearance</h4>

          <div className="setting-row stacked">
            <span className="setting-label">Theme</span>
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
            <p className="muted small setting-hint">{THEME_META[prefs.theme]!.desc} Accent applies on top.</p>
          </div>

          <div className="setting-row stacked">
            <span className="setting-label">Accent color</span>
            <div className="seg-row" role="radiogroup" aria-label="Accent color">
              {PRESET_ACCENTS.map((id) => (
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
              <button
                role="radio"
                aria-checked={prefs.accent === 'custom'}
                className={`seg custom-seg${prefs.accent === 'custom' ? ' selected' : ''}`}
                onClick={() => set({ accent: 'custom' })}
                title={ACCENT_META.custom.desc}
              >
                <span
                  className="swatch accent-custom"
                  style={{ background: prefs.customAccent }}
                  aria-hidden
                />
                Custom
              </button>
            </div>
            {prefs.accent === 'custom' && (
              <label className="custom-picker-row">
                <span>
                  Custom color <code>{prefs.customAccent}</code>
                </span>
                <input
                  type="color"
                  className="color-input"
                  value={prefs.customAccent}
                  onChange={(e) => set({ accent: 'custom', customAccent: e.target.value })}
                  aria-label="Pick a custom accent color"
                />
              </label>
            )}
            <p className="muted small setting-hint">
              Drives buttons, links, progress bars, selection and focus rings.
            </p>
          </div>

          <div className="setting-row inline">
            <div className="setting-label">
              Density
              <span className="muted small setting-hint">Comfortable breathes; compact fits more rows.</span>
            </div>
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

          <div className="setting-row inline">
            <div className="setting-label">
              Motion
              <span className="muted small setting-hint">Reduced disables entrance, shimmer and progress animations.</span>
            </div>
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
          </div>
        </section>

        <section className="settings-group">
          <h4>Transfers</h4>
          <div className="setting-row inline">
            <div className="setting-label">
              <span className="setting-title-row">
                Upload connections per file: <code>{prefs.uploadConcurrency}</code>
              </span>
              <span className="muted small setting-hint">More saturate fast links; fewer are kinder to small networks and Azurite.</span>
            </div>
            <input
              type="range"
              className="slider-inline"
              min={1}
              max={16}
              value={prefs.uploadConcurrency}
              onChange={(e) => set({ uploadConcurrency: Number(e.target.value) })}
              aria-label="Upload connections per file"
            />
          </div>
          <div className="setting-row inline">
            <div className="setting-label">
              <span className="setting-title-row">
                Simultaneous transfers: <code>{prefs.maxParallel}</code>
              </span>
              <span className="muted small setting-hint">Downloads stream on a single connection each.</span>
            </div>
            <input
              type="range"
              className="slider-inline"
              min={1}
              max={4}
              value={prefs.maxParallel}
              onChange={(e) => set({ maxParallel: Number(e.target.value) })}
              aria-label="Simultaneous transfers"
            />
          </div>
        </section>

        <section className="settings-group">
          <h4>Window</h4>
          <div className="setting-row inline">
            <div className="setting-label">
              Native vibrancy blur {props.vibrancySupported ? '(macOS)' : ''}
              {!props.vibrancySupported && (
                <span className="muted small setting-hint">Only available on macOS.</span>
              )}
            </div>
            <button
              role="switch"
              aria-checked={prefs.vibrancy}
              className={`switch${prefs.vibrancy ? ' on' : ''}`}
              disabled={!props.vibrancySupported}
              onClick={() => set({ vibrancy: !prefs.vibrancy })}
            >
              <span className="knob" />
            </button>
          </div>
        </section>
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

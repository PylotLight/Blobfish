export type ThemeName = 'midnight' | 'abyss' | 'slate'
export type DensityName = 'comfortable' | 'compact'
export type MotionName = 'full' | 'reduced'

export interface Prefs {
  theme: ThemeName
  density: DensityName
  motion: MotionName
  vibrancy: boolean
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'midnight',
  density: 'comfortable',
  motion: 'full',
  vibrancy: true
}

const KEY = 'blobfish.settings.v1'

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      theme: parsed.theme === 'abyss' || parsed.theme === 'slate' ? parsed.theme : 'midnight',
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      motion: parsed.motion === 'reduced' ? 'reduced' : 'full',
      vibrancy: parsed.vibrancy !== false
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

const THEMES: Array<{ id: ThemeName; title: string; desc: string }> = [
  { id: 'midnight', title: 'Midnight', desc: 'Default dark blue-grey.' },
  { id: 'abyss', title: 'Abyss', desc: 'Deeper black, mint accents.' },
  { id: 'slate', title: 'Slate', desc: 'Softer graphite, violet accents.' }
]

export function SettingsDialog(props: {
  prefs: Prefs
  vibrancySupported: boolean
  onChange: (prefs: Prefs) => void
  onClose: () => void
}): React.JSX.Element {
  const { prefs } = props
  const set = (patch: Partial<Prefs>): void => props.onChange({ ...prefs, ...patch })

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal glass strong settings-modal fade-in"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Settings</h3>
        <p className="muted small">Stored locally in this app — nothing leaves your machine.</p>

        <h4>Appearance</h4>
        <div className="seg-row" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={prefs.theme === t.id}
              className={`seg${prefs.theme === t.id ? ' selected' : ''}`}
              onClick={() => set({ theme: t.id })}
              title={t.desc}
            >
              <span className={`swatch ${t.id}`} aria-hidden />
              {t.title}
            </button>
          ))}
        </div>

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

        <div className="row end">
          <button className="btn mint" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

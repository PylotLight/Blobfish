import { useEffect, useRef, useState } from "react";
import {
  BREW_UPGRADE_COMMAND,
  type UpdateState,
} from "../../../shared/update-feed";

/** Set by App when an update notification is clicked, so Settings opens scrolled to this section. */
export const REVEAL_UPDATES_KEY = "blobfish.revealUpdates";

function ago(ts: number | null): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : new Date(ts).toLocaleDateString();
}

/**
 * Settings › About & updates (ported from Surffish via Inkfish #51): current version, the latest
 * release from the GitHub releases feed with its notes, Download / brew upgrade / Skip / Remind
 * me later, and the feed settings (pre-releases, custom feed URL).
 */
export function UpdateSettings(): React.JSX.Element {
  const [s, setS] = useState<UpdateState | null>(null);
  const [feed, setFeed] = useState("");
  const [feedError, setFeedError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    window.api.updates
      .get()
      .then((state) => {
        setS(state);
        setFeed(state.feedUrl);
      })
      .catch(() => undefined);
    return window.api.updates.onChanged(setS);
  }, []);

  // Opened from an update notification: scroll this section into view.
  useEffect(() => {
    const reveal = (): void => {
      sessionStorage.removeItem(REVEAL_UPDATES_KEY);
      requestAnimationFrame(() =>
        ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }),
      );
    };
    if (sessionStorage.getItem(REVEAL_UPDATES_KEY)) reveal();
    return window.api.updates.onReveal(reveal);
  }, []);

  const saveSettings = (patch: {
    feedUrl?: string;
    betaChannel?: boolean;
  }): void => {
    void window.api.updates.setSettings(patch).then((r) => {
      if (r.ok) {
        setS(r.state);
        setFeedError(null);
      } else setFeedError(r.error);
    });
  };

  const copyBrew = (): void => {
    void window.api.updates.copyBrew().then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const latest = s?.latest ?? null;
  const available = Boolean(s?.updateAvailable && latest);

  return (
    <section
      className="settings-group about-updates"
      ref={ref}
      aria-label="About & updates"
    >
      <h4>About &amp; updates</h4>

      <div className="setting-row inline">
        <div className="setting-label">
          Blobfish {s?.currentVersion ?? "…"}
          <span className="muted small setting-hint">
            {s
              ? `Electron ${s.engine.electron} · Chromium ${s.engine.chromium}`
              : "…"}
          </span>
        </div>
        <button
          className="btn ghost small"
          disabled={s?.status === "checking"}
          onClick={() => void window.api.updates.check().then(setS)}
        >
          {s?.status === "checking" ? "Checking…" : "Check now"}
        </button>
      </div>
      <p className="muted small setting-hint" role="status">
        {s?.message ??
          "Blobfish checks for new releases about 30 seconds after launch, then every 6 hours."}
        {s ? ` Last checked ${ago(s.lastChecked)}.` : ""}
      </p>

      {available && latest && (
        <div
          className="setting-row stacked update-available"
          aria-label="Update available"
        >
          <div className="setting-label">
            <span className="setting-title-row">
              {s?.showBadge && <span className="update-dot" aria-hidden />}
              {latest.title || `v${latest.version}`} is out
              {s?.skippedVersion === latest.version ? " (skipped)" : ""}
            </span>
          </div>
          <div className="row wrap" style={{ marginTop: 0 }}>
            <button
              className="btn mint small"
              onClick={() => void window.api.updates.download()}
            >
              Download
            </button>
            <button
              className="btn ghost small"
              title="Copy the Homebrew command"
              onClick={copyBrew}
            >
              {copied ? "Copied" : "Copy"} <code>{BREW_UPGRADE_COMMAND}</code>
            </button>
            <button
              className="btn ghost small"
              onClick={() => void window.api.updates.openRelease()}
            >
              Release page
            </button>
            {s?.showBadge && (
              <>
                <button
                  className="btn ghost small"
                  onClick={() =>
                    void window.api.updates.remindLater().then(setS)
                  }
                >
                  Remind me later
                </button>
                <button
                  className="btn ghost small"
                  onClick={() =>
                    void window.api.updates.skip(latest.version).then(setS)
                  }
                >
                  Skip this version
                </button>
              </>
            )}
          </div>
          {latest.notes && <pre className="update-notes">{latest.notes}</pre>}
        </div>
      )}

      <div className="setting-row inline">
        <div className="setting-label">
          Include pre-releases
          <span className="muted small setting-hint">
            Also tell me about beta tags like v0.3.0-beta.1.
          </span>
        </div>
        <button
          role="switch"
          aria-checked={s?.betaChannel ?? false}
          aria-label="Include pre-releases"
          className={`switch${s?.betaChannel ? " on" : ""}`}
          disabled={!s}
          onClick={() => saveSettings({ betaChannel: !s?.betaChannel })}
        >
          <span className="knob" />
        </button>
      </div>

      <div className="setting-row stacked">
        <span className="setting-label">Update feed</span>
        <div className="row" style={{ marginTop: 0 }}>
          <input
            className="grow"
            type="text"
            inputMode="url"
            value={feed}
            placeholder={s?.defaultFeedUrl ?? ""}
            spellCheck={false}
            aria-label="Update feed URL"
            onChange={(e) => setFeed(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveSettings({ feedUrl: feed });
            }}
          />
          <button
            className="btn ghost small"
            disabled={!s || feed === s.feedUrl}
            onClick={() => saveSettings({ feedUrl: feed })}
          >
            Save
          </button>
        </div>
        <p className="muted small setting-hint">
          {feedError ??
            "Blank uses the GitHub releases feed. Any Atom releases feed works."}
        </p>
      </div>
    </section>
  );
}

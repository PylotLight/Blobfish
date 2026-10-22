import { useState } from "react";

type Mode = null | "backup" | "restore";

const MIN = 8;

/**
 * Settings › Connections: back up every connection (secrets included) to one
 * passphrase-encrypted `.blobfish-backup` file, or restore from one. Restore merges and
 * skips connections already here, so it's safe to run twice. Crypto + file dialogs live
 * in main (backup.ts); the passphrase never touches storage.
 */
export function ConnectionsBackup(props: {
  count: number;
  onRestored: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(null);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const open = (m: Mode): void => {
    setMode(m);
    setPass("");
    setConfirm("");
    setMsg(null);
  };

  const tooShort = pass.length < MIN;
  const mismatch = mode === "backup" && confirm !== pass;
  const canGo = !busy && !tooShort && !mismatch;

  const go = async (): Promise<void> => {
    if (!canGo || !mode) return;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "backup") {
        const r = await window.api.accounts.backup(pass);
        if (r.ok) {
          setMsg({
            ok: true,
            text: `Backed up ${r.count} connection${r.count === 1 ? "" : "s"}.`,
          });
          setMode(null);
        } else if (!r.canceled)
          setMsg({ ok: false, text: r.error ?? "Backup failed." });
      } else {
        const r = await window.api.accounts.restore(pass);
        if (r.ok) {
          const parts = [
            `Restored ${r.added} connection${r.added === 1 ? "" : "s"}`,
          ];
          if (r.skipped) parts.push(`${r.skipped} already here`);
          if (r.invalid) parts.push(`${r.invalid} unreadable`);
          setMsg({ ok: true, text: `${parts.join(", ")}.` });
          setMode(null);
          if (r.added) props.onRestored();
        } else if (!r.canceled)
          setMsg({ ok: false, text: r.error ?? "Restore failed." });
      }
    } finally {
      setPass("");
      setConfirm("");
      setBusy(false);
    }
  };

  return (
    <section className="settings-group conn-backup" aria-label="Connections">
      <h4>Connections</h4>
      <div className="setting-row inline">
        <div className="setting-label">
          Backup &amp; restore
          <span className="muted small setting-hint">
            All {props.count} connection{props.count === 1 ? "" : "s"}, secrets
            included, in one file locked with a passphrase. Restore adds what's
            missing and skips what's already here.
          </span>
        </div>
        <div className="row">
          <button
            className={`btn ghost small${mode === "backup" ? " active-opt" : ""}`}
            disabled={props.count === 0 || busy}
            onClick={() => open(mode === "backup" ? null : "backup")}
          >
            Back up…
          </button>
          <button
            className={`btn ghost small${mode === "restore" ? " active-opt" : ""}`}
            disabled={busy}
            onClick={() => open(mode === "restore" ? null : "restore")}
          >
            Restore…
          </button>
        </div>
      </div>

      {mode && (
        <form
          className="setting-row stacked conn-backup-form"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <input
            type="password"
            autoFocus
            autoComplete={
              mode === "backup" ? "new-password" : "current-password"
            }
            placeholder={
              mode === "backup"
                ? `Passphrase (${MIN}+ characters)`
                : "Backup passphrase"
            }
            aria-label="Passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          {mode === "backup" && (
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm passphrase"
              aria-label="Confirm passphrase"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          <div className="row between">
            <span className="muted small">
              {mode === "backup"
                ? pass && confirm && mismatch
                  ? "Passphrases don't match."
                  : "There's no way to recover a lost passphrase."
                : "Pick the .blobfish-backup file next."}
            </span>
            <div className="row">
              <button
                type="button"
                className="btn ghost small"
                onClick={() => open(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn mint small"
                disabled={!canGo}
              >
                {busy
                  ? "Working…"
                  : mode === "backup"
                    ? "Save backup…"
                    : "Choose file…"}
              </button>
            </div>
          </div>
        </form>
      )}

      {msg && (
        <p
          className={`small conn-backup-msg${msg.ok ? " ok" : " err"}`}
          role="status"
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}

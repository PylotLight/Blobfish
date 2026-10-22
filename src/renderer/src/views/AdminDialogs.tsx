/**
 * Container + service admin sheets behind the sidebar context menus:
 * stored access policies, public access level, properties, lease result,
 * CORS rules and blob soft delete. All talk to main via window.api; nothing
 * here touches a key.
 */
import { useEffect, useState } from "react";
import {
  MAX_POLICIES,
  validateCors,
  validatePolicies,
  validateSoftDelete,
} from "../../../shared/admin-validate";
import {
  fromLocalInput,
  POLICY_PERMISSIONS,
  toggleFlag,
  toLocalInput,
  utcOffsetLabel,
} from "../../../shared/sas";
import type {
  ContainerPropertiesInfo,
  CorsRuleInfo,
  PublicAccessLevel,
  StoredAccessPolicy,
} from "../../../shared/types";
import { stripIpcWrapper } from "./errors";
import { Icon } from "./Icon";
import { CopyField } from "./SasDialog";

function errText(err: unknown): string {
  return stripIpcWrapper(err instanceof Error ? err.message : String(err));
}

function Sheet(props: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal glass strong dialog fade-in${props.wide ? " sas-dialog" : ""}`}
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}

function Footer(props: {
  busy: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="row end">
      <button
        className="btn ghost"
        onClick={props.onCancel}
        disabled={props.busy}
      >
        Cancel
      </button>
      <button
        className="btn mint"
        disabled={props.busy || !props.canSave}
        onClick={props.onSave}
      >
        {props.busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

/* ---------- stored access policies ---------- */

interface PolicyRow {
  key: number;
  id: string;
  start: string;
  expiry: string;
  permissions: string;
}

let rowKey = 0;
function toRow(p: StoredAccessPolicy): PolicyRow {
  return {
    key: ++rowKey,
    id: p.id,
    start: p.startsOn ? toLocalInput(new Date(p.startsOn)) : "",
    expiry: p.expiresOn ? toLocalInput(new Date(p.expiresOn)) : "",
    permissions: p.permissions ?? "",
  };
}

function fromRow(r: PolicyRow): StoredAccessPolicy {
  return {
    id: r.id,
    startsOn: fromLocalInput(r.start)?.toISOString(),
    expiresOn: fromLocalInput(r.expiry)?.toISOString(),
    permissions: r.permissions || undefined,
  };
}

export function StoredPoliciesDialog(props: {
  accountId: string;
  container: string;
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<PolicyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    window.api.container
      .access({ accountId: props.accountId, container: props.container })
      .then((a) => {
        if (live) setRows(a.policies.map(toRow));
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errText(err));
      });
    return () => {
      live = false;
    };
  }, [props.accountId, props.container]);

  let invalid: string | null = null;
  if (rows) {
    for (const r of rows) {
      if (
        (r.start && !fromLocalInput(r.start)) ||
        (r.expiry && !fromLocalInput(r.expiry))
      )
        invalid = `Policy "${r.id || "?"}" has an invalid date.`;
    }
    if (!invalid) {
      try {
        validatePolicies(rows.map(fromRow));
      } catch (err) {
        invalid = errText(err);
      }
    }
  }

  function patch(key: number, next: Partial<PolicyRow>): void {
    setRows(
      (rs) => rs?.map((r) => (r.key === key ? { ...r, ...next } : r)) ?? rs,
    );
  }

  async function save(): Promise<void> {
    if (!rows || invalid) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.container.setPolicies({
        accountId: props.accountId,
        container: props.container,
        policies: rows.map(fromRow),
      });
      props.onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Stored access policies · ${props.container}`}
      wide
      onClose={props.onClose}
    >
      <p className="muted small">
        Up to {MAX_POLICIES} per container. A SAS bound to a policy is revoked
        by editing or deleting the policy. Times are local ({utcOffsetLabel()}).
      </p>
      {loadError && <p className="error-text">{loadError}</p>}
      {!rows && !loadError && <p className="muted small">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="muted small">No stored access policies yet.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="policy-list">
          {rows.map((r) => (
            <li key={r.key} className="policy-row">
              <div className="policy-head">
                <input
                  value={r.id}
                  placeholder="Policy ID"
                  aria-label="Policy ID"
                  spellCheck={false}
                  maxLength={64}
                  onChange={(e) => patch(r.key, { id: e.target.value })}
                />
                <button
                  className="mini-btn danger-x"
                  title="Remove policy"
                  aria-label={`Remove policy ${r.id}`}
                  onClick={() =>
                    setRows((rs) => rs?.filter((x) => x.key !== r.key) ?? rs)
                  }
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="sas-times">
                <label className="field">
                  <span>Start</span>
                  <input
                    type="datetime-local"
                    value={r.start}
                    onChange={(e) => patch(r.key, { start: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Expiry</span>
                  <input
                    type="datetime-local"
                    value={r.expiry}
                    onChange={(e) => patch(r.key, { expiry: e.target.value })}
                  />
                </label>
              </div>
              <div className="sas-flag-grid">
                {POLICY_PERMISSIONS.map((d) => (
                  <label key={d.char} className="pick-check">
                    <input
                      type="checkbox"
                      checked={r.permissions.includes(d.char)}
                      onChange={() =>
                        patch(r.key, {
                          permissions: toggleFlag(
                            POLICY_PERMISSIONS,
                            r.permissions,
                            d.char,
                          ),
                        })
                      }
                    />
                    <span>{d.label}</span>
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <button
          className="btn ghost small add-row-btn"
          disabled={rows.length >= MAX_POLICIES}
          onClick={() => {
            const now = new Date();
            setRows((rs) => [
              ...(rs ?? []),
              toRow({
                id: `policy${(rs?.length ?? 0) + 1}`,
                startsOn: now.toISOString(),
                expiresOn: new Date(
                  now.getTime() + 7 * 86_400_000,
                ).toISOString(),
                permissions: "rl",
              }),
            ]);
          }}
        >
          <Icon name="plus" size={14} /> Add policy
        </button>
      )}
      {(error ?? invalid) && <p className="error-text">{error ?? invalid}</p>}
      <Footer
        busy={busy}
        canSave={rows !== null && invalid === null}
        onCancel={props.onClose}
        onSave={() => void save()}
      />
    </Sheet>
  );
}

/* ---------- public access level ---------- */

const PUBLIC_LEVELS: { id: PublicAccessLevel; label: string; desc: string }[] =
  [
    {
      id: "none",
      label: "No public access",
      desc: "Every request needs a key or SAS.",
    },
    {
      id: "blob",
      label: "Public read access for blobs only",
      desc: "Anyone can read a blob by its URL, but can't list the container.",
    },
    {
      id: "container",
      label: "Public read access for container and blobs",
      desc: "Anyone can list the container and read every blob in it.",
    },
  ];

export function PublicAccessDialog(props: {
  accountId: string;
  container: string;
  onClose: () => void;
  onSaved?: (level: PublicAccessLevel) => void;
}): React.JSX.Element {
  const [current, setCurrent] = useState<PublicAccessLevel | null>(null);
  const [level, setLevel] = useState<PublicAccessLevel>("none");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    window.api.container
      .access({ accountId: props.accountId, container: props.container })
      .then((a) => {
        if (!live) return;
        setCurrent(a.publicAccess);
        setLevel(a.publicAccess);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errText(err));
      });
    return () => {
      live = false;
    };
  }, [props.accountId, props.container]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.container.setPublicAccess({
        accountId: props.accountId,
        container: props.container,
        level,
      });
      props.onSaved?.(level);
      props.onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Public access level · ${props.container}`}
      onClose={props.onClose}
    >
      {loadError && <p className="error-text">{loadError}</p>}
      {current === null && !loadError && (
        <p className="muted small">Loading…</p>
      )}
      {current !== null && (
        <div className="radio-stack" role="radiogroup">
          {PUBLIC_LEVELS.map((l) => (
            <label key={l.id} className="pick-check radio-card">
              <input
                type="radio"
                name="public-level"
                checked={level === l.id}
                onChange={() => setLevel(l.id)}
              />
              <span>
                {l.label}
                <span className="muted small block">{l.desc}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <p className="muted small hint">
        Accounts with "Allow blob anonymous access" turned off reject anything
        but No public access.
      </p>
      {error && <p className="error-text">{error}</p>}
      <Footer
        busy={busy}
        canSave={current !== null && level !== current}
        onCancel={props.onClose}
        onSave={() => void save()}
      />
    </Sheet>
  );
}

/* ---------- properties ---------- */

function fmtDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function yesNo(v?: boolean): string {
  return v === undefined ? "—" : v ? "Yes" : "No";
}

export function ContainerPropertiesDialog(props: {
  accountId: string;
  container: string;
  onClose: () => void;
}): React.JSX.Element {
  const [info, setInfo] = useState<ContainerPropertiesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.api.container
      .properties({ accountId: props.accountId, container: props.container })
      .then((p) => {
        if (live) setInfo(p);
      })
      .catch((err: unknown) => {
        if (live) setError(errText(err));
      });
    return () => {
      live = false;
    };
  }, [props.accountId, props.container]);

  const rows: [string, string][] = info
    ? [
        ["Name", info.name],
        ["Last modified", fmtDate(info.lastModified)],
        ["ETag", info.etag ?? "—"],
        [
          "Public access",
          PUBLIC_LEVELS.find((l) => l.id === info.publicAccess)?.label ??
            info.publicAccess,
        ],
        ["Lease state", info.leaseState ?? "—"],
        ["Lease status", info.leaseStatus ?? "—"],
        ["Lease duration", info.leaseDuration ?? "—"],
        ["Immutability policy", yesNo(info.hasImmutabilityPolicy)],
        ["Legal hold", yesNo(info.hasLegalHold)],
        [
          "Version-level immutability",
          yesNo(info.isImmutableStorageWithVersioningEnabled),
        ],
        ["Default encryption scope", info.defaultEncryptionScope ?? "—"],
        [
          "Deny encryption scope override",
          yesNo(info.denyEncryptionScopeOverride),
        ],
        ...Object.entries(info.metadata).map(([k, v]): [string, string] => [
          `Metadata: ${k}`,
          v,
        ]),
      ]
    : [];

  return (
    <Sheet
      title={`Properties · ${props.container}`}
      wide
      onClose={props.onClose}
    >
      {error && <p className="error-text">{error}</p>}
      {!info && !error && <p className="muted small">Loading…</p>}
      {info && (
        <>
          <CopyField label="URL" value={info.url} />
          <ul className="kv props-kv">
            {rows.map(([k, v]) => (
              <li key={k}>
                <span className="muted">{k}</span>
                <span className="props-val" title={v}>
                  {v}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row end">
        <button className="btn mint" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

export function LeaseAcquiredDialog(props: {
  container: string;
  leaseId: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Sheet
      title={`Lease acquired · ${props.container}`}
      onClose={props.onClose}
    >
      <p className="muted small">
        Infinite lease. Deleting the container needs this lease ID until the
        lease is broken (Break Lease works without it).
      </p>
      <CopyField label="Lease ID" value={props.leaseId} />
      <div className="row end">
        <button className="btn mint" onClick={props.onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- CORS ---------- */

const CORS_METHOD_LIST = [
  "GET",
  "HEAD",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "MERGE",
  "PATCH",
];

function methodSet(s: string): Set<string> {
  return new Set(
    s
      .toUpperCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

interface CorsRow extends CorsRuleInfo {
  key: number;
}

export function CorsDialog(props: {
  accountId: string;
  accountName: string;
  onClose: () => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<CorsRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    window.api.service
      .cors(props.accountId)
      .then((rules) => {
        if (live) setRows(rules.map((r) => ({ ...r, key: ++rowKey })));
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errText(err));
      });
    return () => {
      live = false;
    };
  }, [props.accountId]);

  let invalid: string | null = null;
  if (rows) {
    try {
      validateCors(rows);
    } catch (err) {
      invalid = errText(err);
    }
  }

  function patch(key: number, next: Partial<CorsRow>): void {
    setRows(
      (rs) => rs?.map((r) => (r.key === key ? { ...r, ...next } : r)) ?? rs,
    );
  }

  async function save(): Promise<void> {
    if (!rows || invalid) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.service.setCors(
        props.accountId,
        rows.map(({ key: _k, ...r }) => r),
      );
      props.onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`CORS settings · ${props.accountName}`}
      wide
      onClose={props.onClose}
    >
      <p className="muted small">
        Blob service rules (max 5). Comma-separate origins and headers; * allows
        any.
      </p>
      {loadError && <p className="error-text">{loadError}</p>}
      {!rows && !loadError && <p className="muted small">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="muted small">
          No CORS rules, so browsers can't call this account cross-origin.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="policy-list">
          {rows.map((r, i) => {
            const on = methodSet(r.allowedMethods);
            return (
              <li key={r.key} className="policy-row">
                <div className="policy-head">
                  <strong className="small">Rule {i + 1}</strong>
                  <button
                    className="mini-btn danger-x"
                    title="Remove rule"
                    aria-label={`Remove CORS rule ${i + 1}`}
                    onClick={() =>
                      setRows((rs) => rs?.filter((x) => x.key !== r.key) ?? rs)
                    }
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                <label className="field">
                  <span>Allowed origins</span>
                  <input
                    value={r.allowedOrigins}
                    placeholder="https://example.com or *"
                    spellCheck={false}
                    onChange={(e) =>
                      patch(r.key, { allowedOrigins: e.target.value })
                    }
                  />
                </label>
                <div className="sas-flag-grid">
                  {CORS_METHOD_LIST.map((m) => (
                    <label key={m} className="pick-check">
                      <input
                        type="checkbox"
                        checked={on.has(m)}
                        onChange={() => {
                          const next = new Set(on);
                          if (next.has(m)) next.delete(m);
                          else next.add(m);
                          patch(r.key, {
                            allowedMethods: CORS_METHOD_LIST.filter((x) =>
                              next.has(x),
                            ).join(","),
                          });
                        }}
                      />
                      <span>{m}</span>
                    </label>
                  ))}
                </div>
                <div className="sas-times">
                  <label className="field">
                    <span>Allowed headers</span>
                    <input
                      value={r.allowedHeaders}
                      placeholder="*"
                      spellCheck={false}
                      onChange={(e) =>
                        patch(r.key, { allowedHeaders: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Exposed headers</span>
                    <input
                      value={r.exposedHeaders}
                      placeholder="*"
                      spellCheck={false}
                      onChange={(e) =>
                        patch(r.key, { exposedHeaders: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Max age (seconds)</span>
                  <input
                    type="number"
                    min={0}
                    value={r.maxAgeInSeconds}
                    onChange={(e) =>
                      patch(r.key, { maxAgeInSeconds: Number(e.target.value) })
                    }
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {rows && (
        <button
          className="btn ghost small add-row-btn"
          disabled={rows.length >= 5}
          onClick={() =>
            setRows((rs) => [
              ...(rs ?? []),
              {
                key: ++rowKey,
                allowedOrigins: "*",
                allowedMethods: "GET,HEAD",
                allowedHeaders: "*",
                exposedHeaders: "*",
                maxAgeInSeconds: 3600,
              },
            ])
          }
        >
          <Icon name="plus" size={14} /> Add rule
        </button>
      )}
      {(error ?? invalid) && <p className="error-text">{error ?? invalid}</p>}
      <Footer
        busy={busy}
        canSave={rows !== null && invalid === null}
        onCancel={props.onClose}
        onSave={() => void save()}
      />
    </Sheet>
  );
}

/* ---------- blob soft delete ---------- */

export function SoftDeleteDialog(props: {
  accountId: string;
  accountName: string;
  onClose: () => void;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(7);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    window.api.service
      .softDelete(props.accountId)
      .then((s) => {
        if (!live) return;
        setEnabled(s.enabled);
        if (s.days) setDays(s.days);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errText(err));
      });
    return () => {
      live = false;
    };
  }, [props.accountId]);

  let invalid: string | null = null;
  try {
    validateSoftDelete({ enabled, days });
  } catch (err) {
    invalid = errText(err);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.api.service.setSoftDelete(props.accountId, {
        enabled,
        days,
      });
      props.onClose();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Soft delete policy · ${props.accountName}`}
      onClose={props.onClose}
    >
      <p className="muted small">
        Blob soft delete keeps deleted blobs (and overwritten data) for the
        retention period so they can be restored. Container soft delete is an
        Azure portal / ARM setting and isn't changed here.
      </p>
      {loadError && <p className="error-text">{loadError}</p>}
      {!loaded && !loadError && <p className="muted small">Loading…</p>}
      {loaded && (
        <>
          <label className="pick-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable blob soft delete</span>
          </label>
          <label className="field">
            <span>Retention (days, 1–365)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              disabled={!enabled}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        </>
      )}
      {(error ?? invalid) && <p className="error-text">{error ?? invalid}</p>}
      <Footer
        busy={busy}
        canSave={loaded && invalid === null}
        onCancel={props.onClose}
        onSave={() => void save()}
      />
    </Sheet>
  );
}

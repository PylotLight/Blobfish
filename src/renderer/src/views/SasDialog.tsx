/**
 * "Get Shared Access Signature…" (ASE-style) for a storage account or one
 * container. The form only collects choices; main signs with the account key
 * (which never reaches this process) and hands back the finished SAS.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ACCOUNT_SAS_PERMISSIONS,
  ACCOUNT_SAS_RESOURCE_TYPES,
  ACCOUNT_SAS_SERVICES,
  CONTAINER_SAS_PERMISSIONS,
  DEFAULT_ACCOUNT_PERMISSIONS,
  DEFAULT_CONTAINER_PERMISSIONS,
  DEFAULT_RESOURCE_TYPES,
  DEFAULT_SERVICES,
  defaultSasWindow,
  fromLocalInput,
  parseIpRange,
  toggleFlag,
  toLocalInput,
  utcOffsetLabel,
  type SasFlagDef,
  type SasProtocolChoice,
  type SasResult,
} from "../../../shared/sas";
import type { StoredAccessPolicy } from "../../../shared/types";
import { stripIpcWrapper } from "./errors";
import { Icon } from "./Icon";

export type SasScope =
  { kind: "account" } | { kind: "container"; container: string };

function errText(err: unknown): string {
  return stripIpcWrapper(err instanceof Error ? err.message : String(err));
}

function Flags(props: {
  legend: string;
  defs: readonly SasFlagDef[];
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}): React.JSX.Element {
  return (
    <fieldset className="sas-flags" disabled={props.disabled}>
      <legend>{props.legend}</legend>
      <div className="sas-flag-grid">
        {props.defs.map((d) => (
          <label key={d.char} className="pick-check" title={d.hint}>
            <input
              type="checkbox"
              checked={props.value.includes(d.char)}
              onChange={() =>
                props.onChange(toggleFlag(props.defs, props.value, d.char))
              }
            />
            <span>{d.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CopyField(props: {
  label: string;
  value: string;
  multiline?: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field copy-field">
      <span>{props.label}</span>
      <div className="copy-field-row">
        {props.multiline ? (
          <textarea
            readOnly
            value={props.value}
            rows={3}
            spellCheck={false}
            aria-label={props.label}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : (
          <input
            readOnly
            value={props.value}
            spellCheck={false}
            aria-label={props.label}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <button
          className="btn ghost small"
          aria-label={`Copy ${props.label}`}
          onClick={() =>
            void navigator.clipboard
              ?.writeText(props.value)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => undefined)
          }
        >
          {copied ? (
            <>
              <Icon name="check" size={14} /> Copied
            </>
          ) : (
            <>
              <Icon name="copy" size={14} /> Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function SasDialog(props: {
  accountId: string;
  accountName: string;
  scope: SasScope;
  onClose: () => void;
}): React.JSX.Element {
  const { onClose } = props;
  const isAccount = props.scope.kind === "account";
  const container =
    props.scope.kind === "container" ? props.scope.container : "";
  const initial = useMemo(() => defaultSasWindow(), []);
  const [start, setStart] = useState(toLocalInput(initial.start));
  const [expiry, setExpiry] = useState(toLocalInput(initial.expiry));
  const [perms, setPerms] = useState(
    isAccount ? DEFAULT_ACCOUNT_PERMISSIONS : DEFAULT_CONTAINER_PERMISSIONS,
  );
  const [services, setServices] = useState(DEFAULT_SERVICES);
  const [resourceTypes, setResourceTypes] = useState(DEFAULT_RESOURCE_TYPES);
  const [protocol, setProtocol] = useState<SasProtocolChoice>("https");
  const [ip, setIp] = useState("");
  const [policies, setPolicies] = useState<StoredAccessPolicy[] | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SasResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (isAccount) return;
    let live = true;
    window.api.container
      .access({ accountId: props.accountId, container })
      .then((a) => {
        if (live) setPolicies(a.policies);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setPolicies([]);
        setPolicyError(errText(err));
      });
    return () => {
      live = false;
    };
  }, [isAccount, props.accountId, container]);

  const policy = policies?.find((p) => p.id === identifier);
  const lockStart = Boolean(policy?.startsOn);
  const lockExpiry = Boolean(policy?.expiresOn);
  const lockPerms = Boolean(policy?.permissions);
  const offset = utcOffsetLabel(fromLocalInput(start) ?? new Date());

  function localError(): string | null {
    const s = fromLocalInput(start);
    const x = fromLocalInput(expiry);
    if (start && !s && !lockStart) return "Start time isn't a valid date.";
    if (!lockExpiry && !x) return "Pick an expiry time.";
    if (s && x && !lockStart && !lockExpiry && x <= s)
      return "Expiry must be after the start time.";
    if (!lockPerms && !perms) return "Pick at least one permission.";
    if (isAccount && !services) return "Pick at least one service.";
    if (isAccount && !resourceTypes) return "Pick at least one resource type.";
    try {
      parseIpRange(ip);
    } catch (err) {
      return errText(err);
    }
    return null;
  }
  const invalid = localError();

  async function generate(): Promise<void> {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    const startsOn = fromLocalInput(start)?.toISOString();
    const expiresOn = fromLocalInput(expiry)?.toISOString();
    try {
      const res = isAccount
        ? await window.api.sas.account({
            accountId: props.accountId,
            startsOn,
            expiresOn: expiresOn ?? "",
            permissions: perms,
            services,
            resourceTypes,
            protocol,
            ipRange: ip || undefined,
          })
        : await window.api.sas.container({
            accountId: props.accountId,
            container,
            startsOn: lockStart ? undefined : startsOn,
            expiresOn: lockExpiry ? undefined : expiresOn,
            permissions: lockPerms ? undefined : perms,
            identifier: identifier || undefined,
            protocol,
            ipRange: ip || undefined,
          });
      setResult(res);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const title = isAccount
    ? `Shared Access Signature · ${props.accountName}`
    : `Shared Access Signature · ${container}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal glass strong dialog sas-dialog fade-in"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {result ? (
          <>
            <p className="muted small">
              Signed with the account key. Anyone holding this URL gets these
              permissions
              {result.expiresOn
                ? ` until ${new Date(result.expiresOn).toLocaleString()}`
                : ""}
              .
            </p>
            <CopyField label="URL" value={result.url} multiline />
            <CopyField label="Query string" value={result.query} multiline />
            <div className="row end">
              <button className="btn ghost" onClick={() => setResult(null)}>
                Back
              </button>
              <button className="btn mint" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {!isAccount && (
              <label className="field">
                <span>Stored access policy</span>
                <select
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={policies === null}
                >
                  <option value="">
                    {policies === null ? "Loading…" : "None"}
                  </option>
                  {policies?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
                {policyError && (
                  <span className="muted small">
                    Couldn't load policies: {policyError}
                  </span>
                )}
                {policy && (
                  <span className="muted small">
                    Fields the policy sets are locked; the SAS inherits them.
                  </span>
                )}
              </label>
            )}
            <div className="sas-times">
              <label className="field">
                <span>Start time{lockStart ? " (from policy)" : ""}</span>
                <input
                  type="datetime-local"
                  value={start}
                  disabled={lockStart}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Expiry time{lockExpiry ? " (from policy)" : ""}</span>
                <input
                  type="datetime-local"
                  value={expiry}
                  disabled={lockExpiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
            </div>
            <p className="muted small sas-note">
              Local time ({offset}). Azure stores the times in UTC.
            </p>
            <Flags
              legend={`Permissions${lockPerms ? " (from policy)" : ""}`}
              defs={
                isAccount ? ACCOUNT_SAS_PERMISSIONS : CONTAINER_SAS_PERMISSIONS
              }
              value={lockPerms ? (policy?.permissions ?? "") : perms}
              disabled={lockPerms}
              onChange={setPerms}
            />
            {isAccount && (
              <>
                <Flags
                  legend="Services"
                  defs={ACCOUNT_SAS_SERVICES}
                  value={services}
                  onChange={setServices}
                />
                <Flags
                  legend="Resource types"
                  defs={ACCOUNT_SAS_RESOURCE_TYPES}
                  value={resourceTypes}
                  onChange={setResourceTypes}
                />
              </>
            )}
            <fieldset className="sas-flags">
              <legend>Allowed protocols</legend>
              <div className="sas-flag-grid">
                <label className="pick-check">
                  <input
                    type="radio"
                    name="sas-protocol"
                    checked={protocol === "https"}
                    onChange={() => setProtocol("https")}
                  />
                  <span>HTTPS only</span>
                </label>
                <label className="pick-check">
                  <input
                    type="radio"
                    name="sas-protocol"
                    checked={protocol === "https,http"}
                    onChange={() => setProtocol("https,http")}
                  />
                  <span>HTTPS and HTTP</span>
                </label>
              </div>
            </fieldset>
            <label className="field">
              <span>Allowed IP addresses (optional)</span>
              <input
                value={ip}
                placeholder="e.g. 168.1.5.65 or 168.1.5.60-168.1.5.70"
                spellCheck={false}
                onChange={(e) => setIp(e.target.value)}
              />
            </label>
            {(error ?? invalid) && (
              <p className="error-text">{error ?? invalid}</p>
            )}
            <div className="row end">
              <button className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn mint"
                disabled={busy || invalid !== null}
                title={invalid ?? undefined}
                onClick={() => void generate()}
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

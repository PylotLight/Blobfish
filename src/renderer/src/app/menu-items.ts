import type {
  AccountCapabilities,
  AccountSummary,
} from "../../../shared/types";
import type { MenuEntry } from "../views/ContextMenu";
import type { SasScope } from "../views/SasDialog";
import { errMessage, type LeaseProbe, type SelectionTarget } from "./types";

type AdminTarget =
  | {
      kind: "policies" | "public" | "properties";
      accountId: string;
      container: string;
    }
  | { kind: "cors" | "softDelete"; account: AccountSummary }
  | { kind: "lease"; container: string; leaseId: string };
type ContainerTarget = { accountId: string; name: string };

export interface SidebarMenuContext {
  caps: Record<string, AccountCapabilities>;
  lease: Record<string, LeaseProbe>;
  target: SelectionTarget | null;
  selectedId: string | null;
  flashSide: (message: string) => void;
  setSecretError: (message: string) => void;
  copySecret: (id: string) => void;
  exportSecret: (id: string) => void;
  toggleExpand: (id: string, force?: boolean) => void;
  toggleGroup: (id: string, force?: boolean) => void;
  loadContainers: (id: string, force?: boolean) => void;
  selectAccount: (
    id: string,
    container?: string | null,
    prefix?: string,
    reload?: boolean,
  ) => void;
  refreshAccounts: () => void;
  setRenamingId: (id: string) => void;
  setRenameValue: (value: string) => void;
  setDetachFor: (account: AccountSummary) => void;
  setCreateFor: (id: string) => void;
  setOpenByNameFor: (id: string) => void;
  setAdminFor: (target: AdminTarget) => void;
  isContainerPinned: (endpoint: string, container: string) => boolean;
  copyText: (text: string, what: string) => void;
  setSasFor: (target: { account: AccountSummary; scope: SasScope }) => void;
  setBreakLeaseFor: (target: ContainerTarget) => void;
  toggleContainerPin: (account: AccountSummary, container: string) => void;
  setRenameContainerFor: (target: ContainerTarget) => void;
  setDeleteContainerFor: (target: ContainerTarget) => void;
}

/** Pure menu construction; each render supplies current data and named actions. */
export function buildSidebarMenuItems({
  caps,
  lease,
  target,
  selectedId,
  flashSide,
  setSecretError,
  copySecret,
  exportSecret,
  toggleExpand,
  toggleGroup,
  loadContainers,
  selectAccount,
  refreshAccounts,
  setRenamingId,
  setRenameValue,
  setDetachFor,
  setCreateFor,
  setOpenByNameFor,
  setAdminFor,
  isContainerPinned,
  copyText,
  setSasFor,
  setBreakLeaseFor,
  toggleContainerPin,
  setRenameContainerFor,
  setDeleteContainerFor,
}: SidebarMenuContext) {
  function containerUrl(a: AccountSummary, container: string): string {
    const base = a.endpoint
      .split("?")[0]!
      .replace(/\/+$/, "")
      .replace(".dfs.", ".blob.");
    return `${base}/${container}`;
  }

  function sasItem(a: AccountSummary, scope: SasScope): MenuEntry {
    const c = caps[a.id];
    return {
      label: "Get Shared Access Signature…",
      icon: "link",
      disabledReason: !c
        ? "Checking connection…"
        : c.sharedKey
          ? undefined
          : c.sasReason,
      onSelect: () => setSasFor({ account: a, scope }),
    };
  }

  function accountMenuItems(a: AccountSummary): MenuEntry[] {
    const c = caps[a.id];
    const full = a.kind === "account" && !a.containerName;
    const scopedContainer = !full ? a.containerName : undefined;
    return [
      c?.sharedKey && {
        label: "Copy Account Key",
        icon: "key",
        title: "Copies the AccountKey from this connection string",
        onSelect: () =>
          void window.api.accounts
            .copyKey(a.id)
            .then(() => flashSide("Account key copied"))
            .catch((err: unknown) => setSecretError(errMessage(err))),
      },
      {
        label: "Copy connection secret",
        icon: "copy",
        title: "Copy the SAS URL / connection string to the clipboard",
        onSelect: () => copySecret(a.id),
      },
      {
        label: "Export secret to file…",
        icon: "fileDown",
        onSelect: () => exportSecret(a.id),
      },
      "sep",
      full
        ? sasItem(a, { kind: "account" })
        : scopedContainer
          ? sasItem(a, { kind: "container", container: scopedContainer })
          : null,
      full && {
        label: "Refresh",
        icon: "refresh",
        onSelect: () => {
          toggleExpand(a.id, true);
          loadContainers(a.id, true);
          if (selectedId === a.id)
            selectAccount(a.id, target?.container ?? null, undefined, true);
        },
      },
      "sep",
      {
        label: a.pinned ? "Unpin from Quick Access" : "Pin to Quick Access",
        icon: "star",
        onSelect: () =>
          void window.api.accounts
            .pin(a.id, !a.pinned)
            .then(() => refreshAccounts())
            .catch(console.error),
      },
      {
        label: "Rename Connection…",
        icon: "pencil",
        onSelect: () => {
          setRenamingId(a.id);
          setRenameValue(a.name);
        },
      },
      "sep",
      {
        label: "Detach…",
        icon: "close",
        danger: true,
        onSelect: () => setDetachFor(a),
      },
    ];
  }

  function groupMenuItems(a: AccountSummary): MenuEntry[] {
    const c = caps[a.id];
    const full = a.kind === "account" && !a.containerName;
    const serviceReason = !c
      ? "Checking connection…"
      : c.accountScope
        ? undefined
        : "Needs a full storage-account connection.";
    return [
      full && {
        label: "Create Blob Container…",
        icon: "plus",
        onSelect: () => setCreateFor(a.id),
      },
      {
        label: "Open Container by Name…",
        icon: "search",
        onSelect: () => setOpenByNameFor(a.id),
      },
      {
        label: "View All Containers",
        icon: "grid",
        title: "Open the container list in the explorer",
        onSelect: () => selectAccount(a.id, null),
      },
      "sep",
      {
        label: "Configure CORS Settings…",
        icon: "globe",
        disabledReason: serviceReason,
        onSelect: () => setAdminFor({ kind: "cors", account: a }),
      },
      {
        label: "Configure Soft Delete Policy…",
        icon: "restore",
        disabledReason: serviceReason,
        onSelect: () => setAdminFor({ kind: "softDelete", account: a }),
      },
      "sep",
      {
        label: "Refresh",
        icon: "refresh",
        onSelect: () => {
          toggleGroup(a.id, true);
          loadContainers(a.id, true);
        },
      },
    ];
  }

  function containerMenuItems(a: AccountSummary, name: string): MenuEntry[] {
    const canManage = a.kind === "account" && !a.containerName;
    const probe = lease[`${a.id}/${name}`];
    const leaseReason = (want: "acquire" | "break"): string | undefined => {
      if (!probe || probe.state === "loading") return "Checking lease state…";
      if (probe.state === "unknown")
        return `Couldn't read the lease state${probe.error ? `: ${probe.error}` : "."}`;
      if (want === "acquire")
        return probe.state === "leased"
          ? "Container is already leased."
          : probe.state === "breaking"
            ? "Lease is breaking."
            : undefined;
      return probe.state === "leased"
        ? undefined
        : "Container has no active lease.";
    };
    const isOpen = target?.accountId === a.id && target.container === name;
    const pinned = isContainerPinned(a.endpoint, name);
    return [
      {
        label: "Open",
        icon: "forward",
        onSelect: () => selectAccount(a.id, name),
      },
      isOpen && {
        label: "Refresh",
        icon: "refresh",
        onSelect: () => selectAccount(a.id, name, undefined, true),
      },
      "sep",
      {
        label: "Copy URL",
        icon: "link",
        onSelect: () => copyText(containerUrl(a, name), "Container URL"),
      },
      {
        label: "Copy Name",
        icon: "copy",
        onSelect: () => copyText(name, "Container name"),
      },
      "sep",
      sasItem(a, { kind: "container", container: name }),
      {
        label: "Manage Stored Access Policies…",
        icon: "shield",
        onSelect: () =>
          setAdminFor({ kind: "policies", accountId: a.id, container: name }),
      },
      {
        label: "Set Public Access Level…",
        icon: "globe",
        onSelect: () =>
          setAdminFor({ kind: "public", accountId: a.id, container: name }),
      },
      "sep",
      {
        label: "Acquire Lease",
        icon: "lock",
        disabledReason: leaseReason("acquire"),
        onSelect: () =>
          void window.api.container
            .acquireLease({ accountId: a.id, container: name })
            .then((leaseId) =>
              setAdminFor({ kind: "lease", container: name, leaseId }),
            )
            .catch((err: unknown) => flashSide(errMessage(err))),
      },
      {
        label: "Break Lease…",
        icon: "unlock",
        disabledReason: leaseReason("break"),
        onSelect: () => setBreakLeaseFor({ accountId: a.id, name }),
      },
      "sep",
      canManage && {
        label: pinned ? "Unpin from Quick Access" : "Pin to Quick Access",
        icon: "star",
        onSelect: () => toggleContainerPin(a, name),
      },
      canManage && {
        label: "Rename…",
        icon: "pencil",
        onSelect: () => setRenameContainerFor({ accountId: a.id, name }),
      },
      {
        label: "Properties…",
        icon: "info",
        onSelect: () =>
          setAdminFor({ kind: "properties", accountId: a.id, container: name }),
      },
      "sep",
      canManage && {
        label: "Delete…",
        icon: "trash",
        danger: true,
        onSelect: () => setDeleteContainerFor({ accountId: a.id, name }),
      },
    ];
  }

  return { accountMenuItems, groupMenuItems, containerMenuItems };
}

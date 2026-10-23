/**
 * Which app profile a run uses. Release builds keep the default ("Blobfish").
 * Dev runs (unpackaged) get "Blobfish Dev" so they never touch the installed
 * app's connections, window state or activity, and can run beside it (the
 * single-instance lock is per userData). BLOBFISH_PROFILE=<name> picks another
 * isolated profile, e.g. a second dev instance.
 */
export interface ProfileInput {
  appName: string;
  isPackaged: boolean;
  profileEnv?: string;
}

/** Profile name to use, or null to keep Electron's default userData. */
export function resolveProfileName(input: ProfileInput): string | null {
  const override = input.profileEnv?.trim().replace(/[^\w.-]/g, "") ?? "";
  if (override) return `${input.appName} ${override}`;
  if (!input.isPackaged) return `${input.appName} Dev`;
  return null;
}

/** Leave an explicitly chosen userData alone (--user-data-dir, tests): only move the default one. */
export function usesDefaultUserData(
  userDataParent: string,
  appData: string,
): boolean {
  return userDataParent === appData;
}

/** External file drags (Finder) carry "Files"; in-app text/element drags don't. */
export function isFileDrag(
  types: ReadonlyArray<string> | null | undefined,
): boolean {
  return Boolean(types?.includes("Files"));
}

/** Display label for where a drop lands: the folder path, or the container root. */
export function dropTargetLabel(
  container: string,
  prefix: string | null | undefined,
): string {
  const p = (prefix ?? "").replace(/^\/+|\/+$/g, "");
  return p === "" ? container : `${container}/${p}`;
}

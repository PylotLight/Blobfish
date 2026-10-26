import { useState } from "react";
import { isSelectedPath, type PreviewTab } from "./helpers";

export interface PreviewTabs {
  previewTabs: PreviewTab[];
  activeTab: string | null;
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>;
  resetPreviewTabs: () => void;
  openPreviewTab: (
    name: string,
    size?: number,
    containerOverride?: string,
  ) => void;
  closePreviewTab: (key: string) => void;
  dropTabsForNames: (container: string, names: string[]) => void;
  renamePreviewTab: (
    container: string,
    source: string,
    destination: string,
  ) => void;
  dropTabsForPaths: (container: string, names: string[]) => void;
}

/** Owns the tab identity and lifecycle for blob previews. */
export function usePreviewTabs(
  getContainer: () => string | null,
  closeContextMenu: () => void,
): PreviewTabs {
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  function resetPreviewTabs(): void {
    setPreviewTabs([]);
    setActiveTab(null);
  }

  function openPreviewTab(
    name: string,
    size?: number,
    containerOverride?: string,
  ): void {
    const cont = (containerOverride ?? getContainer() ?? "").trim();
    if (cont === "") return;
    const key = `${cont}/${name}`;
    setPreviewTabs((prev) =>
      prev.some((t) => t.key === key)
        ? prev
        : [...prev, { key, container: cont, name, size }],
    );
    setActiveTab(key);
    closeContextMenu();
  }

  function closePreviewTab(key: string): void {
    setPreviewTabs((prev) => prev.filter((t) => t.key !== key));
    setActiveTab((cur) => (cur === key ? null : cur));
  }

  function dropTabsForNames(container: string, names: string[]): void {
    const gone = new Set(names);
    setPreviewTabs((prev) =>
      prev.filter((t) => !(t.container === container && gone.has(t.name))),
    );
    setActiveTab((cur) => {
      if (cur === null) return cur;
      const tab = previewTabs.find((t) => t.key === cur);
      if (tab && tab.container === container && gone.has(tab.name)) return null;
      return cur;
    });
  }

  function renamePreviewTab(
    container: string,
    source: string,
    destination: string,
  ): void {
    setPreviewTabs((prev) =>
      prev.map((t) =>
        t.container === container && t.name === source
          ? { ...t, name: destination, key: `${container}/${destination}` }
          : t,
      ),
    );
    setActiveTab((cur) =>
      cur === `${container}/${source}` ? `${container}/${destination}` : cur,
    );
  }

  function dropTabsForPaths(container: string, names: string[]): void {
    const removed = new Set(
      previewTabs
        .filter(
          (t) => t.container === container && isSelectedPath(t.name, names),
        )
        .map((t) => t.key),
    );
    if (removed.size === 0) return;
    setPreviewTabs((prev) => prev.filter((t) => !removed.has(t.key)));
    setActiveTab((cur) => (cur && removed.has(cur) ? null : cur));
  }

  return {
    previewTabs,
    activeTab,
    setActiveTab,
    resetPreviewTabs,
    openPreviewTab,
    closePreviewTab,
    dropTabsForNames,
    renamePreviewTab,
    dropTabsForPaths,
  };
}

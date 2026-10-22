import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  EMPTY_CLICK_BURST,
  registerClick,
} from "../../../../shared/click-burst";

/**
 * Hidden: triple-click the Blobfish logo at the top of the sidebar for a deep-sea logo scene
 * (ported from Surffish's toolbar-logo egg, via Inkfish). The trigger is a few lines in the main
 * bundle; the scene (markup + CSS) is its own chunk, loaded on the first triple-click only.
 */
export function useBrandTripleClick(): {
  open: boolean;
  onClick: () => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);
  const burst = useRef(EMPTY_CLICK_BURST);
  const onClick = useCallback(() => {
    const result = registerClick(burst.current, performance.now());
    burst.current = result.burst;
    if (result.fired) setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { open, onClick, close };
}

const BlobfishEgg = lazy(() => import("./BlobfishEgg"));

export function BrandEasterEgg({
  logoUrl,
  reducedMotion,
  onClose,
}: {
  logoUrl: string;
  /** The app's own Settings → Motion: reduced (the OS setting is checked inside too). */
  reducedMotion: boolean;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <BlobfishEgg
        logoUrl={logoUrl}
        reducedMotion={reducedMotion}
        onClose={onClose}
      />
    </Suspense>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  rowPitch,
  syncBudget,
  virtualWindow,
} from "../../../../shared/virtual-window";
import {
  DEFAULT_ROW_HEIGHT,
  VIRTUAL_MIN_ROWS,
  VIRTUAL_OVERSCAN,
} from "./helpers";

interface Viewport {
  offset: number;
  height: number;
}

export interface VirtualRows {
  bodyScrollRef: React.RefObject<HTMLDivElement | null>;
  topSpacerRef: React.RefObject<HTMLTableRowElement | null>;
  rowHeight: number;
  virtual: boolean;
  onBodyScroll: () => void;
  windowStart: number;
  windowEnd: number;
}

export function useVirtualRows(rowCount: number): VirtualRows {
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLTableRowElement>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [viewport, setViewport] = useState<Viewport>({
    offset: 0,
    height: 900,
  });
  const virtual = rowCount > VIRTUAL_MIN_ROWS;
  const scrollFrame = useRef(0);

  const measureViewport = useCallback((): void => {
    const el = bodyScrollRef.current;
    const spacer = topSpacerRef.current;
    if (!el || !spacer) return;
    const dataTop =
      spacer.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop;
    const offset = Math.max(0, el.scrollTop - dataTop);
    const height = el.clientHeight;
    setViewport((prev) =>
      prev.offset === offset && prev.height === height
        ? prev
        : { offset, height },
    );
  }, []);

  const onBodyScroll = useCallback((): void => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      measureViewport();
    });
  }, [measureViewport]);

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  useEffect(() => {
    const el = bodyScrollRef.current;
    if (!el || !virtual) return;
    const ro = new ResizeObserver(() => measureViewport());
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtual, measureViewport]);

  const takeSyncMeasure = useMemo(() => syncBudget(), []);
  useLayoutEffect(() => {
    if (!virtual) return;
    if (!takeSyncMeasure()) return onBodyScroll();
    measureViewport();
    const tops: number[] = [];
    for (
      let r = topSpacerRef.current?.nextElementSibling;
      r && tops.length < 8 && !r.classList.contains("virtual-spacer");
      r = r.nextElementSibling
    ) {
      tops.push(r.getBoundingClientRect().top);
    }
    const h = rowPitch(tops, 0);
    if (h > 0 && Math.abs(h - rowHeight) > 0.1) setRowHeight(h);
  });

  const { start: windowStart, end: windowEnd } = virtual
    ? virtualWindow(
        rowCount,
        viewport.offset,
        viewport.height,
        rowHeight,
        VIRTUAL_OVERSCAN,
      )
    : { start: 0, end: rowCount };

  return {
    bodyScrollRef,
    topSpacerRef,
    rowHeight,
    virtual,
    onBodyScroll,
    windowStart,
    windowEnd,
  };
}

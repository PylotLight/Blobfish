import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatPct,
  formatSpeed,
} from "./format";

describe("transfer display formatting", () => {
  test("uses readable units at byte, kibibyte, mebibyte, and gibibyte boundaries", () => {
    expect(formatBytes()).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
  });

  test("shows unknown speeds and formats active throughput", () => {
    expect(formatSpeed()).toBe("—");
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
  });

  test("rounds durations and ETAs without displaying negative time", () => {
    expect(formatDuration()).toBe("—");
    expect(formatDuration(0)).toBe("0 seconds");
    expect(formatDuration(1490)).toBe("1 second");
    expect(formatDuration(61_000)).toBe("1m 1s");
    expect(formatDuration(-5_000)).toBe("0 seconds");
    expect(formatEta()).toBe("—");
    expect(formatEta(59)).toBe("59s left");
    expect(formatEta(60)).toBe("1m 0s left");
  });

  test("keeps unknown progress blank, floors percentages, and caps completion at 100%", () => {
    expect(formatPct(5, 0)).toBe("—");
    expect(formatPct(499, 1000)).toBe("49%");
    expect(formatPct(1200, 1000)).toBe("100%");
  });
});

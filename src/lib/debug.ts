/// <reference types="vite/client" />
import { invoke } from "@tauri-apps/api/core";

/**
 * Debug utilities for React/Tauri app
 * These can be called from console or via Tauri commands
 * Debug state is periodically written to the system temp dir as nocur-debug.json (debug builds only)
 */

interface RenderInfo {
  component: string;
  count: number;
  lastRenderTime: number;
}

interface DebugState {
  renderCounts: Map<string, RenderInfo>;
  enabled: boolean;
  reactScanEnabled: boolean;
  lastInteraction: { type: string; timestamp: number; details?: string } | null;
  errors: Array<{ message: string; timestamp: number; stack?: string }>;
}

interface DebugSnapshot {
  timestamp: number;
  topRerenders: RenderInfo[];
  totalRenders: number;
  memory: { usedMB: number; totalMB: number; limitMB: number } | null;
  lastInteraction: DebugState["lastInteraction"];
  recentErrors: DebugState["errors"];
  reactScanEnabled: boolean;
}

const debugState: DebugState = {
  renderCounts: new Map(),
  enabled: import.meta.env.DEV,
  reactScanEnabled: false,
  lastInteraction: null,
  errors: [],
};

// Track component renders
export function trackRender(componentName: string): void {
  if (!debugState.enabled) return;

  const existing = debugState.renderCounts.get(componentName);
  debugState.renderCounts.set(componentName, {
    component: componentName,
    count: (existing?.count || 0) + 1,
    lastRenderTime: performance.now(),
  });
}

// Get render counts for all tracked components
export function getRenderCounts(): Record<string, RenderInfo> {
  const result: Record<string, RenderInfo> = {};
  debugState.renderCounts.forEach((info, key) => {
    result[key] = info;
  });
  return result;
}

// Reset render counts
export function resetRenderCounts(): void {
  debugState.renderCounts.clear();
}

// Get top re-rendering components
export function getTopRerenders(limit = 10): RenderInfo[] {
  return Array.from(debugState.renderCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Toggle React Scan visual overlay
export async function toggleReactScan(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const { scan } = await import("react-scan");
    if (debugState.reactScanEnabled) {
      // React Scan doesn't have a disable, but we can track state
      debugState.reactScanEnabled = false;
      console.log("[Debug] React Scan tracking disabled (refresh to fully disable)");
    } else {
      scan({
        enabled: true,
        log: true, // Log to console
      });
      debugState.reactScanEnabled = true;
      console.log("[Debug] React Scan enabled - components will highlight on render");
    }
    return debugState.reactScanEnabled;
  } catch (e) {
    console.error("[Debug] Failed to toggle React Scan:", e);
    return false;
  }
}

// Get memory usage info
export function getMemoryInfo(): { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } | null {
  if (typeof window === "undefined") return null;

  const perf = (performance as unknown as { memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } });

  if (perf.memory) {
    return {
      usedJSHeapSize: perf.memory.usedJSHeapSize,
      totalJSHeapSize: perf.memory.totalJSHeapSize,
      jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
    };
  }
  return null;
}

// Profile a function execution
export async function profile<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    console.log(`[Profile] ${name}: ${duration.toFixed(2)}ms`);
    return result;
  } catch (e) {
    const duration = performance.now() - start;
    console.error(`[Profile] ${name} FAILED after ${duration.toFixed(2)}ms:`, e);
    throw e;
  }
}

// Get component tree info (basic version)
export function getComponentTree(): string {
  if (typeof document === "undefined") return "Not available";

  const root = document.getElementById("root");
  if (!root) return "No root element found";

  function traverse(el: Element, depth = 0): string {
    const indent = "  ".repeat(depth);
    const name = el.getAttribute("data-component") || el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = el.className ? `.${el.className.split(" ").slice(0, 2).join(".")}` : "";

    let result = `${indent}${name}${id}${classes}\n`;

    // Only go 5 levels deep to avoid huge output
    if (depth < 5) {
      for (const child of el.children) {
        result += traverse(child, depth + 1);
      }
    } else if (el.children.length > 0) {
      result += `${indent}  ... (${el.children.length} children)\n`;
    }

    return result;
  }

  return traverse(root);
}

// Dump all debug info to console
export function dumpDebugInfo(): void {
  console.group("[Debug] Full Debug Dump");

  console.log("=== Render Counts ===");
  console.table(getTopRerenders(20));

  console.log("\n=== Memory Info ===");
  const mem = getMemoryInfo();
  if (mem) {
    console.log(`Used: ${(mem.usedJSHeapSize! / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Total: ${(mem.totalJSHeapSize! / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Limit: ${(mem.jsHeapSizeLimit! / 1024 / 1024).toFixed(2)}MB`);
  } else {
    console.log("Memory info not available");
  }

  console.log("\n=== Component Tree (summary) ===");
  console.log(getComponentTree());

  console.groupEnd();
}

// Track user interactions
export function trackInteraction(type: string, details?: string): void {
  if (!debugState.enabled) return;
  debugState.lastInteraction = {
    type,
    timestamp: Date.now(),
    details,
  };
}

// Track errors
export function trackError(error: Error | string): void {
  if (!debugState.enabled) return;
  const message = typeof error === "string" ? error : error.message;
  const stack = typeof error === "string" ? undefined : error.stack;
  debugState.errors.push({
    message,
    timestamp: Date.now(),
    stack,
  });
  // Keep only last 20 errors
  if (debugState.errors.length > 20) {
    debugState.errors = debugState.errors.slice(-20);
  }
}

// Get a snapshot of current debug state as JSON-serializable object
export function getDebugSnapshot(): DebugSnapshot {
  const mem = getMemoryInfo();
  return {
    timestamp: Date.now(),
    topRerenders: getTopRerenders(15),
    totalRenders: Array.from(debugState.renderCounts.values())
      .reduce((sum, info) => sum + info.count, 0),
    memory: mem ? {
      usedMB: Math.round((mem.usedJSHeapSize || 0) / 1024 / 1024 * 100) / 100,
      totalMB: Math.round((mem.totalJSHeapSize || 0) / 1024 / 1024 * 100) / 100,
      limitMB: Math.round((mem.jsHeapSizeLimit || 0) / 1024 / 1024 * 100) / 100,
    } : null,
    lastInteraction: debugState.lastInteraction,
    recentErrors: debugState.errors.slice(-5),
    reactScanEnabled: debugState.reactScanEnabled,
  };
}

// Write debug snapshot to file via Tauri (for agentic access)
export async function writeDebugSnapshot(): Promise<void> {
  if (!debugState.enabled) return;
  try {
    const snapshot = getDebugSnapshot();
    await invoke("write_debug_snapshot", { snapshot: JSON.stringify(snapshot) });
  } catch (e) {
    // Silently fail - debug logging shouldn't break the app
    console.warn("[Debug] Failed to write snapshot:", e);
  }
}

// Start periodic debug snapshot writing
let snapshotInterval: NodeJS.Timeout | null = null;
export function startDebugLogging(intervalMs = 2000): void {
  if (snapshotInterval) return;
  snapshotInterval = setInterval(writeDebugSnapshot, intervalMs);
  // Write immediately
  writeDebugSnapshot();
  console.log(`[Debug] Started periodic debug logging (every ${intervalMs}ms)`);
}

export function stopDebugLogging(): void {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
    console.log("[Debug] Stopped periodic debug logging");
  }
}

// Expose debug utilities to window for console access
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__DEBUG__ = {
    trackRender,
    getRenderCounts,
    resetRenderCounts,
    getTopRerenders,
    toggleReactScan,
    getMemoryInfo,
    profile,
    getComponentTree,
    dumpDebugInfo,
    trackInteraction,
    trackError,
    getDebugSnapshot,
    writeDebugSnapshot,
    startDebugLogging,
    stopDebugLogging,
    state: debugState,
  };

  console.log(
    "%c[Debug] Debug utilities loaded. Use window.__DEBUG__ to access.",
    "color: #f59e0b; font-weight: bold"
  );
  console.log("  - Debug snapshots written to your system temp dir as nocur-debug.json (debug builds only)");

  // Auto-start debug logging after a short delay (let app initialize)
  setTimeout(() => {
    startDebugLogging(2000);
  }, 1000);
}

export default debugState;

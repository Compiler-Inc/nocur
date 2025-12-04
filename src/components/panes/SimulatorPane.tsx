import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type SimulatorState = "disconnected" | "booting" | "running";

export const SimulatorPane = () => {
  const [state, setState] = useState<SimulatorState>("running");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(false);
  const [hierarchy, setHierarchy] = useState<string | null>(null);

  const captureScreenshot = async () => {
    setIsCapturing(true);
    try {
      // Returns a data:image/png;base64,... URL
      const dataUrl = await invoke<string>("take_screenshot");
      setScreenshotUrl(dataUrl);
      setState("running");
    } catch (error) {
      console.error("Screenshot failed:", error);
      setState("disconnected");
    } finally {
      setIsCapturing(false);
    }
  };

  const fetchHierarchy = async () => {
    try {
      const result = await invoke<string>("get_view_hierarchy");
      setHierarchy(result);
      setShowHierarchy(true);
    } catch (error) {
      console.error("Hierarchy failed:", error);
      setHierarchy(JSON.stringify({ error: String(error) }, null, 2));
      setShowHierarchy(true);
    }
  };

  // Auto-capture on mount
  useEffect(() => {
    captureScreenshot();
  }, []);

  const stateConfig = {
    disconnected: { color: "bg-text-tertiary", text: "No Simulator" },
    booting: { color: "bg-warning animate-pulse", text: "Booting..." },
    running: { color: "bg-success", text: "Running" },
  };

  return (
    <div className="flex flex-col h-full bg-surface-base relative">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border bg-surface-raised/50">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-text-primary">Simulator</h2>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${stateConfig[state].color}`} />
            <span className="text-xs text-text-tertiary">{stateConfig[state].text}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={captureScreenshot}
            disabled={isCapturing}
            className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            {isCapturing ? "..." : "Refresh"}
          </button>
          <button
            onClick={fetchHierarchy}
            className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-secondary hover:text-text-primary transition-colors"
          >
            Hierarchy
          </button>
        </div>
      </div>

      {/* Simulator View */}
      <div className="flex-1 flex items-center justify-center p-4 bg-surface-raised/30 overflow-hidden">
        {state === "disconnected" ? (
          <div className="text-center space-y-4">
            <div className="w-48 h-96 rounded-3xl border-2 border-dashed border-border flex items-center justify-center">
              <div className="text-center space-y-2 p-4">
                <div className="text-3xl text-border">◎</div>
                <p className="text-xs text-text-tertiary">No simulator</p>
              </div>
            </div>
            <button className="px-4 py-2 text-xs rounded bg-surface-overlay hover:bg-hover text-text-primary transition-colors">
              Boot Simulator
            </button>
          </div>
        ) : (
          <div
            className="cursor-pointer h-full flex items-center justify-center"
            onClick={captureScreenshot}
          >
            {screenshotUrl ? (
              <img
                src={screenshotUrl}
                alt="Simulator screenshot"
                className="h-full max-h-[calc(100%-2rem)] w-auto object-contain rounded-[1.5rem] shadow-xl"
              />
            ) : isCapturing ? (
              <div className="w-64 h-[500px] rounded-[2rem] bg-surface-raised flex items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-text-tertiary">Capturing...</p>
                </div>
              </div>
            ) : (
              <div className="w-64 h-[500px] rounded-[2rem] bg-surface-raised border-2 border-dashed border-border flex items-center justify-center">
                <div className="text-center space-y-2">
                  <div className="text-2xl text-border">◎</div>
                  <p className="text-xs text-text-tertiary">Click to capture</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="h-12 px-4 flex items-center justify-between border-t border-border bg-surface-raised/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary font-mono">iOS 18.2</span>
          <span className="text-border">•</span>
          <span className="text-xs text-text-tertiary font-mono">1206×2622</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Tap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" strokeWidth="2"/>
              <path strokeWidth="2" d="M12 2v4m0 12v4m10-10h-4M6 12H2"/>
            </svg>
          </button>
          <button
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Scroll"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" d="M12 5v14m0-14l-3 3m3-3l3 3m-3 11l-3-3m3 3l3-3"/>
            </svg>
          </button>
          <button
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Type"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth="2"/>
              <path strokeWidth="2" d="M6 14h.01M10 14h.01M14 14h.01M18 14h.01M8 10h8"/>
            </svg>
          </button>
          <div className="w-px h-4 bg-border mx-1"/>
          <button
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Home"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="5" y="2" width="14" height="20" rx="3" strokeWidth="2"/>
              <circle cx="12" cy="18" r="1" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Hierarchy Panel */}
      {showHierarchy && (
        <div className="absolute inset-0 bg-surface-base/95 z-20 flex flex-col">
          <div className="h-12 px-4 flex items-center justify-between border-b border-border bg-surface-raised/50">
            <h2 className="text-sm font-medium text-text-primary">View Hierarchy</h2>
            <button
              onClick={() => setShowHierarchy(false)}
              className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-secondary hover:text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap">
              {hierarchy || "Loading..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

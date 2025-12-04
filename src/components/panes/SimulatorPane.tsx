import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

type SimulatorState = "disconnected" | "booting" | "running" | "building" | "live";

interface ClaudeEvent {
  eventType: string;
  content: string;
  toolName: string | null;
}

interface FrameData {
  image: string;
  width: number;
  height: number;
  timestamp: number;
}

interface SimulatorWindowInfo {
  window_id: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  name: string;
  owner_name: string;
}

export const SimulatorPane = () => {
  const [state, setState] = useState<SimulatorState>("running");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(false);
  const [hierarchy, setHierarchy] = useState<string | null>(null);
  const [lastScreenshotSource, setLastScreenshotSource] = useState<"manual" | "claude" | "live">("manual");
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [windowInfo, setWindowInfo] = useState<SimulatorWindowInfo | null>(null);
  const [fps, setFps] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  const captureScreenshot = async () => {
    if (isLiveMode) return; // Don't capture manually in live mode
    setIsCapturing(true);
    try {
      const dataUrl = await invoke<string>("take_screenshot");
      setScreenshotUrl(dataUrl);
      setLastScreenshotSource("manual");
      setState("running");
    } catch (error) {
      console.error("Screenshot failed:", error);
      setState("disconnected");
    } finally {
      setIsCapturing(false);
    }
  };

  const buildAndRun = async () => {
    setIsBuilding(true);
    setState("building");
    try {
      await invoke("run_project", {
        projectPath: "<REPO_ROOT>/sample-app",
        scheme: "NocurTestApp",
      });
      await new Promise(resolve => setTimeout(resolve, 1500));
      await captureScreenshot();
    } catch (error) {
      console.error("Build failed:", error);
    } finally {
      setIsBuilding(false);
      setState("running");
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

  const loadScreenshotFromPath = async (path: string) => {
    if (isLiveMode) return;
    try {
      setIsCapturing(true);
      const dataUrl = await invoke<string>("load_image_from_path", { path });
      setScreenshotUrl(dataUrl);
      setLastScreenshotSource("claude");
      setState("running");
    } catch (error) {
      console.error("Failed to load screenshot from path:", error);
    } finally {
      setIsCapturing(false);
    }
  };

  const extractScreenshotPath = (content: string): string | null => {
    try {
      const match = content.match(/"path"\s*:\s*"([^"]+\.png)"/);
      if (match && match[1]) {
        return match[1];
      }
      const parsed = JSON.parse(content);
      if (parsed?.data?.path?.endsWith(".png")) {
        return parsed.data.path;
      }
    } catch {
      // Not JSON or no path found
    }
    return null;
  };

  // Start/stop live mode
  const toggleLiveMode = useCallback(async () => {
    if (isLiveMode) {
      // Stop streaming
      try {
        await invoke("stop_simulator_stream");
      } catch (e) {
        console.error("Failed to stop stream:", e);
      }
      setIsLiveMode(false);
      setState("running");
      setLastScreenshotSource("manual");
      setFps(0);
    } else {
      // Start streaming
      try {
        await invoke("start_simulator_stream", { fps: 30 });
        setIsLiveMode(true);
        setState("live");
        setLastScreenshotSource("live");
      } catch (e) {
        console.error("Failed to start stream:", e);
        // If it fails (e.g., Simulator not open), show error
        alert(`Failed to start live mode: ${e}`);
      }
    }
  }, [isLiveMode]);

  // Handle click on the simulator image
  const handleImageClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isLiveMode || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    try {
      await invoke("simulator_click", { x, y });
    } catch (err) {
      console.error("Click failed:", err);
    }
  }, [isLiveMode]);

  // Listen for frame events when in live mode
  useEffect(() => {
    if (!isLiveMode) return;

    let unlistenFrame: UnlistenFn | undefined;
    let unlistenWindow: UnlistenFn | undefined;
    let unlistenDisconnect: UnlistenFn | undefined;

    const setup = async () => {
      unlistenFrame = await listen<FrameData>("simulator-frame", (event) => {
        setScreenshotUrl(event.payload.image);

        // Update FPS counter
        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsUpdateRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsUpdateRef.current = now;
        }
      });

      unlistenWindow = await listen<SimulatorWindowInfo>("simulator-window-found", (event) => {
        setWindowInfo(event.payload);
        console.log("Simulator window found:", event.payload.name);
      });

      unlistenDisconnect = await listen("simulator-disconnected", () => {
        console.log("Simulator disconnected");
        setIsLiveMode(false);
        setState("disconnected");
        setFps(0);
      });
    };

    setup();

    return () => {
      if (unlistenFrame) unlistenFrame();
      if (unlistenWindow) unlistenWindow();
      if (unlistenDisconnect) unlistenDisconnect();
    };
  }, [isLiveMode]);

  // Auto-capture on mount and listen for Claude events
  useEffect(() => {
    captureScreenshot();

    const setupListener = async () => {
      const unlisten = await listen<ClaudeEvent>("claude-event", (event) => {
        const { eventType, content } = event.payload;

        if (eventType === "tool_result") {
          const screenshotPath = extractScreenshotPath(content);
          if (screenshotPath) {
            console.log("Claude took screenshot:", screenshotPath);
            loadScreenshotFromPath(screenshotPath);
          }
        }

        if (eventType === "result" && !isLiveMode) {
          console.log("Claude finished - refreshing simulator screenshot");
          setTimeout(() => captureScreenshot(), 500);
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  const stateConfig = {
    disconnected: { color: "bg-text-tertiary", text: "No Simulator" },
    booting: { color: "bg-warning animate-pulse", text: "Booting..." },
    building: { color: "bg-accent animate-pulse", text: "Building..." },
    running: { color: "bg-success", text: lastScreenshotSource === "claude" ? "Claude View" : "Running" },
    live: { color: "bg-success animate-pulse", text: `Live ${fps > 0 ? `(${fps} fps)` : ""}` },
  };

  return (
    <div className="flex flex-col h-full bg-surface-raised relative">
      {/* Simulator View */}
      <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
        {state === "disconnected" ? (
          <div className="text-center space-y-4">
            <div className="w-48 h-96 rounded-3xl border-2 border-dashed border-border flex items-center justify-center">
              <div className="text-center space-y-2 p-4">
                <div className="text-3xl text-border">◎</div>
                <p className="text-xs text-text-tertiary">No simulator</p>
              </div>
            </div>
            <button
              onClick={toggleLiveMode}
              className="px-4 py-2 text-xs rounded bg-surface-overlay hover:bg-hover text-text-primary transition-colors"
            >
              Connect Live
            </button>
          </div>
        ) : (
          <div
            className={`h-full flex items-center justify-center ${isLiveMode ? "" : "cursor-pointer"}`}
            onClick={!isLiveMode ? captureScreenshot : undefined}
          >
            {screenshotUrl ? (
              <img
                ref={imageRef}
                src={screenshotUrl}
                alt="Simulator"
                onClick={isLiveMode ? handleImageClick : undefined}
                className={`h-full max-h-[calc(100%-2rem)] w-auto object-contain rounded-[1.5rem] shadow-xl ${
                  isLiveMode ? "cursor-crosshair" : ""
                }`}
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
          <div className={`w-1.5 h-1.5 rounded-full ${stateConfig[state].color}`} />
          <span className="text-xs text-text-tertiary font-mono">{stateConfig[state].text}</span>
          {windowInfo && isLiveMode && (
            <span className="text-xs text-text-tertiary">· {windowInfo.name}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Live mode toggle */}
          <button
            onClick={toggleLiveMode}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              isLiveMode
                ? "bg-success/20 text-success hover:bg-success/30"
                : "bg-surface-overlay text-text-tertiary hover:bg-hover hover:text-text-primary"
            }`}
            title={isLiveMode ? "Stop live streaming" : "Start live streaming (interactive)"}
          >
            {isLiveMode ? "● Live" : "○ Live"}
          </button>
          <div className="w-px h-4 bg-border mx-1"/>
          <button
            onClick={captureScreenshot}
            disabled={isCapturing || isBuilding || isLiveMode}
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
            title="Refresh Screenshot"
          >
            <svg className={`w-4 h-4 ${isCapturing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={fetchHierarchy}
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="View Hierarchy"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h10" />
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

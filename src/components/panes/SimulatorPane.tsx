import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

type SimulatorState = "disconnected" | "running" | "observing" | "captured";

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

// Log entry from simulator console
interface SimulatorLogEntry {
  timestamp: number;
  level: string;  // "debug", "info", "warning", "error", "fault"
  process: string;
  message: string;
}

// Crash report from iOS
interface CrashReport {
  path: string;
  processName: string;
  timestamp: number;
  exceptionType: string | null;
  crashReason: string | null;
  stackTrace: string | null;
}

// Rich captured frame with all context
interface CapturedFrame {
  image: string;
  timestamp: number;
  hierarchy?: string;  // View hierarchy snapshot at this frame
}

// Complete recording data sent to Claude
interface RecordingData {
  frames: CapturedFrame[];
  logs: SimulatorLogEntry[];
  crashes: CrashReport[];
  startTime: number;
  endTime: number;
}

interface SimulatorPaneProps {
  isAppRunning?: boolean;
  onCapture?: (data: RecordingData) => void;
}

// Capture a frame every 500ms during recording (2 fps)
const FRAME_CAPTURE_INTERVAL = 500;
const MAX_CAPTURED_FRAMES = 60; // Max 60 frames (30 seconds at 2 fps)

export const SimulatorPane = ({ isAppRunning, onCapture }: SimulatorPaneProps) => {
  const [state, setState] = useState<SimulatorState>("running");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(false);
  const [hierarchy, setHierarchy] = useState<string | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [windowInfo, setWindowInfo] = useState<SimulatorWindowInfo | null>(null);
  const [fps, setFps] = useState(0);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [capturedLogs, setCapturedLogs] = useState<SimulatorLogEntry[]>([]);
  const [capturedCrashes, setCapturedCrashes] = useState<CrashReport[]>([]);
  const [observationStartTime, setObservationStartTime] = useState<number | null>(null);
  const [isClaudeWatching, setIsClaudeWatching] = useState(false);
  const [claudeToolName, setClaudeToolName] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const lastCaptureRef = useRef<string | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recordingStartRef = useRef<number>(0);

  const captureScreenshot = async () => {
    if (isLiveMode) return;
    setIsCapturing(true);
    try {
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

  // Start observing - begin live feed + log streaming
  const startObserving = useCallback(async () => {
    try {
      const startTime = Date.now();
      recordingStartRef.current = startTime;

      // Start simulator video stream
      await invoke("start_simulator_stream", { fps: 30 });

      // Start log streaming (capture all logs)
      try {
        await invoke("start_simulator_logs", { bundleId: null });
      } catch (e) {
        console.warn("Failed to start log streaming:", e);
      }

      setIsLiveMode(true);
      setState("observing");
      setObservationStartTime(startTime);
      setCapturedFrames([]);
      setCapturedLogs([]);
      setCapturedCrashes([]);
      setErrorCount(0);
      lastCaptureRef.current = null;
    } catch (e) {
      console.error("Failed to start observation:", e);
      alert(`Failed to start observation. Is the Simulator running?`);
    }
  }, []);

  // Stop observing and capture final state
  const stopObserving = useCallback(async () => {
    const endTime = Date.now();

    // Clear any active capture interval
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    // Capture one final frame if we have a current screenshot
    if (screenshotUrl && screenshotUrl !== lastCaptureRef.current) {
      setCapturedFrames(prev => {
        const newFrames = [...prev, { image: screenshotUrl, timestamp: endTime }];
        return newFrames.slice(-MAX_CAPTURED_FRAMES);
      });
    }

    // Stop video streaming
    try {
      await invoke("stop_simulator_stream");
    } catch (e) {
      console.error("Failed to stop stream:", e);
    }

    // Stop log streaming and collect logs
    try {
      await invoke("stop_simulator_logs");
      const logs = await invoke<SimulatorLogEntry[]>("get_simulator_logs");
      setCapturedLogs(logs);

      // Count errors/warnings for display
      const errors = logs.filter(l => l.level === "error" || l.level === "fault").length;
      setErrorCount(errors);
    } catch (e) {
      console.warn("Failed to get logs:", e);
    }

    // Check for crash reports since recording started
    try {
      const crashes = await invoke<CrashReport[]>("get_crash_reports", {
        bundleId: null,
        sinceTimestamp: Math.floor(recordingStartRef.current / 1000)
      });
      setCapturedCrashes(crashes);
    } catch (e) {
      console.warn("Failed to get crash reports:", e);
    }

    setIsLiveMode(false);
    setState("captured");
    setFps(0);
  }, [screenshotUrl]);

  // Send captured data to Claude
  const sendToClaude = useCallback(() => {
    if (capturedFrames.length > 0) {
      const recordingData: RecordingData = {
        frames: capturedFrames,
        logs: capturedLogs,
        crashes: capturedCrashes,
        startTime: recordingStartRef.current,
        endTime: Date.now(),
      };
      onCapture?.(recordingData);
      // Reset to ready state
      setState("running");
      setCapturedFrames([]);
      setCapturedLogs([]);
      setCapturedCrashes([]);
      setErrorCount(0);
    }
  }, [capturedFrames, capturedLogs, capturedCrashes, onCapture]);

  // Discard capture and go back to ready
  const discardCapture = useCallback(() => {
    setCapturedFrames([]);
    setCapturedLogs([]);
    setCapturedCrashes([]);
    setErrorCount(0);
    setState("running");
  }, []);

  // Focus the Simulator app
  const focusSimulator = useCallback(async () => {
    try {
      await invoke("focus_simulator");
    } catch (e) {
      console.error("Failed to focus simulator:", e);
    }
  }, []);

  // Auto-start observing when app starts running
  useEffect(() => {
    if (isAppRunning && !isLiveMode && state !== "captured") {
      const timer = setTimeout(() => {
        startObserving();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isAppRunning, isLiveMode, state, startObserving]);

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
      });

      unlistenDisconnect = await listen("simulator-disconnected", () => {
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

  // Capture frames periodically during observation
  useEffect(() => {
    if (state !== "observing" || !isLiveMode) {
      // Clear any existing interval when not observing
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      return;
    }

    // Capture a frame every FRAME_CAPTURE_INTERVAL ms
    captureIntervalRef.current = setInterval(() => {
      if (screenshotUrl && screenshotUrl !== lastCaptureRef.current) {
        setCapturedFrames(prev => {
          const newFrame = { image: screenshotUrl, timestamp: Date.now() };
          const newFrames = [...prev, newFrame];
          // Keep only the last MAX_CAPTURED_FRAMES
          return newFrames.slice(-MAX_CAPTURED_FRAMES);
        });
        lastCaptureRef.current = screenshotUrl;
      }
    }, FRAME_CAPTURE_INTERVAL);

    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    };
  }, [state, isLiveMode, screenshotUrl]);

  // Listen for log events during recording
  useEffect(() => {
    if (state !== "observing") return;

    let unlistenLog: UnlistenFn | undefined;

    const setup = async () => {
      // Listen for real-time log entries
      unlistenLog = await listen<{ entries: SimulatorLogEntry[] }>("simulator-log", (event) => {
        const newEntries = event.payload.entries;
        // Track errors in real-time
        const newErrors = newEntries.filter(e => e.level === "error" || e.level === "fault").length;
        if (newErrors > 0) {
          setErrorCount(prev => prev + newErrors);
        }
      });
    };

    setup();

    return () => {
      if (unlistenLog) unlistenLog();
    };
  }, [state]);

  // Helper to check if a tool name is a simulator tool
  const isSimulatorTool = (toolName: string | null): boolean => {
    if (!toolName) return false;
    return (
      toolName.includes("sim_") ||
      toolName.includes("ui_") ||
      toolName.includes("__sim") ||
      toolName.includes("__ui")
    );
  };

  // Auto-capture on mount and listen for Claude events
  useEffect(() => {
    captureScreenshot();

    const setupListener = async () => {
      const unlisten = await listen<ClaudeEvent>("claude-event", (event) => {
        const { eventType, toolName } = event.payload;

        if (eventType === "tool_use" && isSimulatorTool(toolName)) {
          setIsClaudeWatching(true);
          setClaudeToolName(toolName);
        }

        if (eventType === "tool_result" || eventType === "result") {
          setIsClaudeWatching(false);
          setClaudeToolName(null);
        }
      });
      return unlisten;
    };

    const unlistenPromise = setupListener();
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // Calculate observation duration
  const getObservationDuration = () => {
    if (!observationStartTime) return "0:00";
    const seconds = Math.floor((Date.now() - observationStartTime) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full bg-surface-raised relative">
      {/* Main View */}
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
              onClick={startObserving}
              className="px-4 py-2 text-xs rounded bg-surface-overlay hover:bg-hover text-text-primary transition-colors"
            >
              Start Observing
            </button>
          </div>
        ) : state === "captured" && capturedFrames.length > 0 ? (
          // Captured state - show summary with logs/crashes info
          <div className="flex flex-col items-center gap-3 w-full h-full p-4">
            {/* Recording Summary */}
            <div className="w-full space-y-2">
              {/* Success badge */}
              <div className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-text-primary">Recording Complete</span>
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-center gap-3 text-xs">
                <span className="px-2 py-1 rounded bg-surface-overlay text-text-secondary">
                  {capturedFrames.length} frames
                </span>
                <span className="px-2 py-1 rounded bg-surface-overlay text-text-secondary">
                  {capturedLogs.length} logs
                </span>
                {errorCount > 0 && (
                  <span className="px-2 py-1 rounded bg-error/20 text-error font-medium">
                    {errorCount} errors
                  </span>
                )}
                {capturedCrashes.length > 0 && (
                  <span className="px-2 py-1 rounded bg-error text-white font-medium">
                    {capturedCrashes.length} crash{capturedCrashes.length !== 1 ? 'es' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Thumbnail strip */}
            <div className="flex-1 w-full overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 p-2">
                {capturedFrames.slice(0, 10).map((frame, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={frame.image}
                      alt={`Frame ${idx + 1}`}
                      className="w-full h-auto rounded-lg border border-border-subtle shadow-sm"
                    />
                    <span className="absolute bottom-1 right-1 text-[10px] bg-surface-base/80 px-1.5 py-0.5 rounded text-text-tertiary">
                      {idx + 1}
                    </span>
                  </div>
                ))}
                {capturedFrames.length > 10 && (
                  <div className="w-full aspect-[9/16] rounded-lg bg-surface-overlay flex items-center justify-center">
                    <span className="text-xs text-text-tertiary">+{capturedFrames.length - 10} more</span>
                  </div>
                )}
              </div>

              {/* Show error logs preview if any */}
              {errorCount > 0 && (
                <div className="mt-3 p-2 rounded-lg bg-error/10 border border-error/20">
                  <div className="text-xs font-medium text-error mb-1">Recent Errors:</div>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {capturedLogs
                      .filter(l => l.level === "error" || l.level === "fault")
                      .slice(-3)
                      .map((log, idx) => (
                        <div key={idx} className="text-[10px] text-error/80 font-mono truncate">
                          {log.message.slice(0, 100)}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-border-subtle w-full justify-center">
              <button
                onClick={discardCapture}
                className="px-4 py-2 text-sm rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary transition-colors"
              >
                Discard
              </button>
              <button
                onClick={sendToClaude}
                className="px-4 py-2 text-sm rounded-lg bg-accent hover:bg-accent/80 text-surface-base font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send to Claude
              </button>
            </div>
          </div>
        ) : (
          // Running or Observing - show live feed
          <div className="h-full flex items-center justify-center">
            {screenshotUrl ? (
              <div className="relative h-full flex items-center justify-center">
                <img
                  src={screenshotUrl}
                  alt="Simulator"
                  className="h-full max-h-[calc(100%-2rem)] w-auto object-contain rounded-[1.5rem] shadow-xl"
                />
              </div>
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

      {/* Observing Indicator - compact top bar when recording */}
      {state === "observing" && (
        <div className="absolute top-0 left-0 right-0 bg-error px-3 py-2 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
            <span className="text-xs font-medium text-white truncate">{getObservationDuration()}</span>
            <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded text-white shrink-0">
              {capturedFrames.length}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); focusSimulator(); }}
              className="px-2 py-1 text-[10px] rounded bg-white/20 hover:bg-white/30 text-white transition-colors active:scale-95"
            >
              Sim
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); stopObserving(); }}
              className="px-2 py-1 text-[10px] rounded bg-white text-error font-medium hover:bg-white/90 transition-colors active:scale-95"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Claude Watching Overlay */}
      {isClaudeWatching && (
        <div className="absolute inset-0 bg-accent/5 flex items-center justify-center pointer-events-none z-10">
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-surface-overlay/95 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-2 shadow-lg border border-accent/20">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-xs text-accent font-medium">
              {claudeToolName ? `Claude: ${claudeToolName.replace('mcp__nocur__', '')}` : 'Claude is observing'}
            </span>
          </div>
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="h-12 px-4 flex items-center justify-between border-t border-border bg-surface-raised/50">
        <div className="flex items-center gap-2">
          {state === "observing" ? (
            <>
              <div className="w-2 h-2 rounded-full bg-error animate-pulse" />
              <span className="text-xs text-error font-medium">Recording · {fps > 0 ? `${fps} fps` : "..."}</span>
            </>
          ) : state === "captured" ? (
            <>
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs text-success font-medium">Captured</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
              <span className="text-xs text-text-tertiary font-mono">
                {state === "disconnected" ? "No Simulator" : "Ready"}
              </span>
            </>
          )}
          {windowInfo && isLiveMode && (
            <span className="text-xs text-text-tertiary ml-2">· {windowInfo.name}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state !== "observing" && state !== "captured" && (
            <>
              <button
                onClick={startObserving}
                className="px-3 py-1.5 rounded text-xs bg-error/10 text-error hover:bg-error/20 transition-colors font-medium"
              >
                Start Recording
              </button>
              <div className="w-px h-4 bg-border mx-1"/>
            </>
          )}
          <button
            onClick={captureScreenshot}
            disabled={isCapturing || isLiveMode}
            className="p-2 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
            title="Take Screenshot"
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

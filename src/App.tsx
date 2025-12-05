import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SimulatorPane } from "@/components/panes/SimulatorPane";
import { AgentPane } from "@/components/panes/AgentPane";
import { DevToolsPane } from "@/components/panes/DevToolsPane";
import { DiffViewer } from "@/components/DiffViewer";
import { Onboarding } from "@/components/Onboarding";
import { HistorySidebar } from "@/components/HistorySidebar";
import { OpenInDropdown } from "@/components/OpenInDropdown";

// DEBUG: Set to true to always show onboarding
const DEBUG_SHOW_ONBOARDING = false;

interface ClaudeCodeStatus {
  installed: boolean;
  path: string | null;
  loggedIn: boolean;
  hasActivePlan: boolean;
  error: string | null;
}

interface BuildEvent {
  eventType: string;
  message: string;
  timestamp: number;
}

interface LogEntry {
  type: "info" | "error" | "warning" | "success";
  message: string;
  timestamp: Date;
}

interface BuildResult {
  success: boolean;
  output: string;
  errors: BuildError[];
  warnings: number;
  buildTime: number | null;
  appPath: string | null;
  bundleId: string | null;
}

interface BuildError {
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

type BuildStatus = "idle" | "building" | "success" | "failed";

interface GitInfo {
  branch: string;
  isDirty: boolean;
  hasUntracked: boolean;
  ahead: number;
  behind: number;
  shortStatus: string;
  workingDir: string;
}

const PROJECT_PATH = "<REPO_ROOT>/sample-app";
const PROJECT_SCHEME = "NocurTestApp";
const ROOT_PROJECT_PATH = "<REPO_ROOT>";

// Resizable divider component
const ResizeHandle = ({
  onResize,
  direction,
}: {
  onResize: (delta: number) => void;
  direction: "left" | "right";
}) => {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onResize(direction === "left" ? delta : -delta);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onResize, direction]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className="w-px bg-border hover:bg-accent/50 cursor-col-resize transition-colors shrink-0"
    />
  );
};

const App = () => {
  const [isReady, setIsReady] = useState<boolean | null>(DEBUG_SHOW_ONBOARDING ? false : null);
  const [showOnboarding, setShowOnboarding] = useState(true);

  // Pane widths - balanced like Conductor
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(320);

  // Session state (shared with sidebar)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pendingSessionAction, setPendingSessionAction] = useState<{ type: "resume" | "new"; sessionId?: string } | null>(null);
  const [indexedSessions, setIndexedSessions] = useState<string[]>([]); // For Cmd+1,2,3

  // Dev tools panel state
  const [showDevTools, setShowDevTools] = useState(false);
  const [devToolsWidth, setDevToolsWidth] = useState(320);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // Build state
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [buildTime, setBuildTime] = useState<number | null>(null);

  // Git info
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  // Build logs panel state
  const [showBuildPanel, setShowBuildPanel] = useState(false);
  const [buildLogs, setBuildLogs] = useState<LogEntry[]>([]);
  const [buildPanelHeight, setBuildPanelHeight] = useState(180);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const panelResizing = useRef(false);
  const panelStartY = useRef(0);
  const panelStartHeight = useRef(0);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [buildLogs]);

  // Fetch git info
  useEffect(() => {
    const fetchGitInfo = async () => {
      try {
        const info = await invoke<GitInfo>("get_git_info", { path: PROJECT_PATH });
        setGitInfo(info);
      } catch (err) {
        console.error("Failed to get git info:", err);
      }
    };

    fetchGitInfo();
    const interval = setInterval(fetchGitInfo, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  // Listen to build events at App level
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      unlisten = await listen<BuildEvent>("build-event", (event) => {
        const { eventType, message } = event.payload;

        const logType = eventType === "error" ? "error"
          : eventType === "warning" ? "warning"
          : eventType === "completed" && message.includes("succeeded") ? "success"
          : "info";

        setBuildLogs((prev) => [
          ...prev,
          { type: logType, message, timestamp: new Date() }
        ]);

        // Auto-show panel when build starts
        if (eventType === "started") {
          setBuildLogs([{ type: "info", message, timestamp: new Date() }]);
          setShowBuildPanel(true);
        }
      });
    };

    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Check Claude Code status on mount and periodically
  const checkStatus = useCallback(async () => {
    if (DEBUG_SHOW_ONBOARDING) return;

    try {
      const status = await invoke<ClaudeCodeStatus>("check_claude_code_status");
      const ready = status.installed && status.loggedIn && status.hasActivePlan;
      setIsReady(ready);

      if (!ready && !showOnboarding) {
        setShowOnboarding(true);
      }
    } catch (error) {
      console.error("Failed to check Claude Code status:", error);
      setIsReady(false);
    }
  }, [showOnboarding]);

  useEffect(() => {
    if (DEBUG_SHOW_ONBOARDING) return;
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setIsReady(true);
  };

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(220, Math.min(360, w + delta)));
  }, []);

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(280, Math.min(400, w + delta)));
  }, []);

  // Session action handlers for sidebar
  const handleSelectSession = useCallback((sessionId: string) => {
    setPendingSessionAction({ type: "resume", sessionId });
  }, []);

  const handleNewSession = useCallback(() => {
    setPendingSessionAction({ type: "new" });
  }, []);

  const handleDevToolsResize = useCallback((delta: number) => {
    setDevToolsWidth((w) => Math.max(280, Math.min(600, w - delta)));
  }, []);

  // Load indexed sessions for Cmd+1,2,3
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const sessions = await invoke<{ sessionId: string }[]>("get_recent_sessions");
        // Include current session first, then recent sessions
        const sessionIds = sessions.map(s => s.sessionId);
        if (currentSessionId && !sessionIds.includes(currentSessionId)) {
          sessionIds.unshift(currentSessionId);
        }
        setIndexedSessions(sessionIds.slice(0, 9)); // Max 9 for Cmd+1-9
      } catch (err) {
        console.error("Failed to load sessions:", err);
      }
    };
    loadSessions();
  }, [currentSessionId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+1-9: Switch sessions
      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key) - 1;
        if (indexedSessions[index] && indexedSessions[index] !== currentSessionId) {
          e.preventDefault();
          setPendingSessionAction({ type: "resume", sessionId: indexedSessions[index] });
        }
      }
      // Cmd+Shift+E: Toggle dev tools
      if (e.metaKey && e.shiftKey && e.key === "e") {
        e.preventDefault();
        setShowDevTools(prev => !prev);
      }
      // Cmd+Shift+G: Toggle dev tools (git)
      if (e.metaKey && e.shiftKey && e.key === "g") {
        e.preventDefault();
        setShowDevTools(prev => !prev);
      }
      // Escape: Close diff viewer
      if (e.key === "Escape" && selectedDiffFile) {
        e.preventDefault();
        setSelectedDiffFile(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [indexedSessions, currentSessionId, selectedDiffFile]);

  // Build handlers
  const handleBuild = async () => {
    setBuildStatus("building");
    setBuildTime(null);

    try {
      const result = await invoke<BuildResult>("build_project", {
        projectPath: PROJECT_PATH,
        scheme: PROJECT_SCHEME,
      });

      if (result.success) {
        setBuildStatus("success");
        setBuildTime(result.buildTime);
      } else {
        setBuildStatus("failed");
        setBuildTime(result.buildTime);
      }
    } catch (error) {
      console.error("Build failed:", error);
      setBuildStatus("failed");
    }
  };

  const handleRun = async () => {
    setBuildStatus("building");
    setBuildTime(null);

    try {
      const result = await invoke<BuildResult>("run_project", {
        projectPath: PROJECT_PATH,
        scheme: PROJECT_SCHEME,
      });

      if (result.success) {
        setBuildStatus("success");
        setBuildTime(result.buildTime);
      } else {
        setBuildStatus("failed");
        setBuildTime(result.buildTime);
      }
    } catch (error) {
      console.error("Run failed:", error);
      setBuildStatus("failed");
    }
  };

  const statusConfig = {
    idle: { color: "bg-text-tertiary", text: "Ready" },
    building: { color: "bg-warning animate-pulse", text: "Building..." },
    success: { color: "bg-success", text: buildTime ? `${buildTime.toFixed(1)}s` : "Done" },
    failed: { color: "bg-error", text: "Failed" },
  };

  // Panel resize handlers
  useEffect(() => {
    const handlePanelMouseMove = (e: MouseEvent) => {
      if (!panelResizing.current) return;
      const delta = panelStartY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(400, panelStartHeight.current + delta));
      setBuildPanelHeight(newHeight);
    };

    const handlePanelMouseUp = () => {
      panelResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handlePanelMouseMove);
    document.addEventListener("mouseup", handlePanelMouseUp);

    return () => {
      document.removeEventListener("mousemove", handlePanelMouseMove);
      document.removeEventListener("mouseup", handlePanelMouseUp);
    };
  }, []);

  const handlePanelResizeStart = (e: React.MouseEvent) => {
    panelResizing.current = true;
    panelStartY.current = e.clientY;
    panelStartHeight.current = buildPanelHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "error": return "text-error";
      case "warning": return "text-warning";
      case "success": return "text-success";
      default: return "text-text-secondary";
    }
  };

  // Handle window dragging programmatically
  const handleTitleBarMouseDown = (e: React.MouseEvent) => {
    // Don't drag if clicking on a button or interactive element
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-no-drag]')) {
      return;
    }
    e.preventDefault();
    getCurrentWindow().startDragging();
  };

  // Show loading
  if (isReady === null) {
    return (
      <div className="h-screen w-screen bg-surface-base flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 text-accent">◎</div>
          <p className="text-sm text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Show onboarding
  if (showOnboarding && !isReady) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-base text-text-primary animate-fade-in overflow-hidden">
      {/* Unified Top Bar - draggable with space for macOS traffic lights */}
      <div
        onMouseDown={handleTitleBarMouseDown}
        className="h-12 flex items-center justify-between pl-[78px] pr-4 bg-surface-raised border-b border-border shrink-0 cursor-default"
      >
        {/* Left: Logo and project */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-accent text-lg">◎</span>
            <span className="text-sm font-semibold text-text-primary">Nocur</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary font-mono">~/nocur/sample-app</span>
            {gitInfo && (
              <>
                <span className="text-xs text-accent font-mono">{gitInfo.branch}</span>
                <span className={`text-xs font-mono ${
                  gitInfo.shortStatus === "✓" ? "text-success" : "text-warning"
                }`}>
                  {gitInfo.shortStatus}
                </span>
              </>
            )}
            <OpenInDropdown projectPath={PROJECT_PATH} />
          </div>
        </div>

        {/* Center: spacer for drag region */}
        <div className="flex-1 min-h-full" />

        {/* Right: Build controls and settings */}
        <div className="flex items-center gap-3">
          {/* Build controls */}
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusConfig[buildStatus].color}`} />
            <span className="text-xs text-text-secondary">{statusConfig[buildStatus].text}</span>
          </div>
          <button
            onClick={handleBuild}
            disabled={buildStatus === "building"}
            className="px-2.5 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Build
          </button>
          <button
            onClick={handleRun}
            disabled={buildStatus === "building"}
            className="px-2.5 py-1 text-xs rounded bg-accent hover:bg-accent-muted text-surface-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            ▶ Run
          </button>
          <div className="h-4 w-px bg-border ml-1" />
          <button className="p-1.5 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Three Panes: History + Agent + Simulator */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Pane: History Sidebar */}
          <div
            style={{ width: leftWidth }}
            className="flex flex-col shrink-0 overflow-hidden"
          >
            <HistorySidebar
              currentSessionId={currentSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              projectPath={PROJECT_PATH}
            />
          </div>

          <ResizeHandle onResize={handleLeftResize} direction="left" />

          {/* Main Pane: Claude Agent or Diff Viewer */}
          <div className="flex-1 min-w-[400px] flex flex-col overflow-hidden bg-surface-base">
            {selectedDiffFile ? (
              <DiffViewer
                filePath={selectedDiffFile}
                projectPath={ROOT_PROJECT_PATH}
                onClose={() => setSelectedDiffFile(null)}
              />
            ) : (
              <AgentPane
                onSessionChange={setCurrentSessionId}
                pendingSessionAction={pendingSessionAction}
                onPendingSessionActionHandled={() => setPendingSessionAction(null)}
              />
            )}
          </div>

          <ResizeHandle onResize={handleRightResize} direction="right" />

          {/* Right Pane: Simulator */}
          <div
            style={{ width: rightWidth }}
            className="flex flex-col shrink-0 overflow-hidden bg-surface-raised"
          >
            <SimulatorPane
              isAppRunning={buildStatus === "success"}
              onCapture={async (data) => {
                console.log(`Recording captured:`, {
                  frames: data.frames.length,
                  logs: data.logs.length,
                  crashes: data.crashes.length,
                  duration: `${Math.round((data.endTime - data.startTime) / 1000)}s`
                });

                // Save key screenshots to temp files so Claude can view them
                // Sample ~5 frames evenly distributed across the recording
                const maxFramesToSend = 5;
                const step = Math.max(1, Math.floor(data.frames.length / maxFramesToSend));
                const selectedFrames = data.frames
                  .filter((_, i) => i % step === 0)
                  .slice(0, maxFramesToSend);

                let screenshotPaths: string[] = [];
                if (selectedFrames.length > 0) {
                  try {
                    screenshotPaths = await invoke<string[]>("save_screenshots_to_temp", {
                      images: selectedFrames.map(f => f.image),
                      prefix: null
                    });
                    console.log(`Saved ${screenshotPaths.length} screenshots to temp files`);
                  } catch (e) {
                    console.error("Failed to save screenshots:", e);
                  }
                }

                // Build a message with the recording context
                const duration = Math.round((data.endTime - data.startTime) / 1000);
                const errorLogs = data.logs.filter(l => l.level === "error" || l.level === "fault");

                let message = `I recorded the iOS simulator for ${duration}s (${data.frames.length} frames total).\n\n`;

                // Add screenshot paths for Claude to view
                if (screenshotPaths.length > 0) {
                  message += `Here are ${screenshotPaths.length} screenshots from the recording. Please read these image files to see the app state:\n`;
                  screenshotPaths.forEach((path, i) => {
                    message += `- Frame ${i + 1}: ${path}\n`;
                  });
                  message += "\n";
                }

                // Add error summary if any
                if (errorLogs.length > 0) {
                  message += `${errorLogs.length} errors detected in logs:\n`;
                  errorLogs.slice(0, 5).forEach(log => {
                    message += `- [${log.process}] ${log.message.slice(0, 200)}\n`;
                  });
                  if (errorLogs.length > 5) {
                    message += `... and ${errorLogs.length - 5} more errors\n`;
                  }
                  message += "\n";
                }

                // Add crash info if any
                if (data.crashes.length > 0) {
                  message += `${data.crashes.length} crash(es) detected:\n`;
                  data.crashes.forEach(crash => {
                    message += `- ${crash.processName}: ${crash.exceptionType || "Unknown"}\n`;
                    if (crash.crashReason) {
                      message += `  Reason: ${crash.crashReason}\n`;
                    }
                    if (crash.stackTrace) {
                      message += `  Stack trace (first 500 chars): ${crash.stackTrace.slice(0, 500)}\n`;
                    }
                  });
                  message += "\n";
                }

                message += "Please analyze ONLY what you can see in these screenshots. Do not assume features are broken just because they weren't demonstrated - focus on what IS visible and any actual errors in the logs.";

                // Send to Claude
                try {
                  await invoke("send_claude_message", { message });
                  console.log("Recording sent to Claude");
                } catch (e) {
                  console.error("Failed to send recording to Claude:", e);
                }
              }}
            />
          </div>

          {/* Dev Tools Pane - Version Control + Terminal */}
          {showDevTools && (
            <>
              <ResizeHandle onResize={handleDevToolsResize} direction="right" />
              <div
                style={{ width: devToolsWidth }}
                className="flex flex-col shrink-0 overflow-hidden"
              >
                <DevToolsPane
                  projectPath={ROOT_PROJECT_PATH}
                  onClose={() => setShowDevTools(false)}
                  onFileSelect={setSelectedDiffFile}
                  selectedFile={selectedDiffFile}
                />
              </div>
            </>
          )}
        </div>

        {/* Bottom Build Panel - collapsible & resizable */}
        {showBuildPanel && (
          <div className="bg-surface-raised flex flex-col shrink-0" style={{ height: buildPanelHeight }}>
            {/* Resize Handle */}
            <div
              onMouseDown={handlePanelResizeStart}
              className="h-1 bg-border hover:bg-accent/50 cursor-row-resize transition-colors shrink-0"
            />
            {/* Panel Header */}
            <div className="h-8 px-3 flex items-center justify-between border-b border-border-subtle bg-surface-raised shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">Build Output</span>
                <span className="text-xs text-text-tertiary">({buildLogs.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setBuildLogs([])}
                  className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
                  title="Clear"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeWidth="2" strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowBuildPanel(false)}
                  className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
                  title="Close"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeWidth="2" strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Log Content */}
            <div className="flex-1 overflow-auto p-2 font-mono text-[11px]">
              {buildLogs.map((log, i) => (
                <div key={i} className={`${getLogColor(log.type)} leading-relaxed`}>
                  <span className="text-text-tertiary opacity-50">
                    {log.timestamp.toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  {" "}
                  {log.message}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

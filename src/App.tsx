import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SimulatorPane } from "@/components/panes/SimulatorPane";
import { AgentPane } from "@/components/panes/AgentPane";
import { DevToolsPane } from "@/components/panes/DevToolsPane";
import { DiffViewer } from "@/components/DiffViewer";
import { Onboarding } from "@/components/Onboarding";
import { OpenInDropdown } from "@/components/OpenInDropdown";
import { ContextReviewModal, RecordingData } from "@/components/ContextReviewModal";
import { BottomPanel, BottomPanelHandle } from "@/components/BottomPanel";
import { PlaybookModal } from "@/components/PlaybookModal";
import { DeviceSelector } from "@/components/DeviceSelector";

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

interface DeviceInfo {
  id: string;
  name: string;
  model: string;
  osVersion: string;
  deviceType: "simulator" | "physical";
  state: "booted" | "shutdown" | "connected" | "disconnected" | "unavailable";
  isAvailable: boolean;
}

interface DeviceListResult {
  devices: DeviceInfo[];
  simulatorCount: number;
  physicalCount: number;
}

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

  // Pane widths
  const [rightWidth, setRightWidth] = useState(320);
  const [rightCollapsed, setRightCollapsed] = useState(true); // Hidden by default

  // Session state
  const [_currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Dev tools panel state
  const [showDevTools, setShowDevTools] = useState(false);
  const [devToolsWidth, setDevToolsWidth] = useState(320);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // Build state
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [buildTime, setBuildTime] = useState<number | null>(null);

  // Context review modal state
  const [showContextModal, setShowContextModal] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<RecordingData | null>(null);

  // ACE Playbook modal state
  const [showPlaybookModal, setShowPlaybookModal] = useState(false);

  // Git info
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  // Device selection
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null);

  // Bottom panel state (terminal + build logs)
  const [showBottomPanel, setShowBottomPanel] = useState(false);
  const [buildLogs, setBuildLogs] = useState<LogEntry[]>([]);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(220);
  const bottomPanelRef = useRef<BottomPanelHandle>(null);

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

  // Auto-select first available device on mount
  useEffect(() => {
    const loadSelectedDevice = async () => {
      try {
        // First, try to load previously selected device
        const device = await invoke<DeviceInfo | null>("get_selected_device");
        if (device) {
          setSelectedDevice(device);
          return;
        }

        // Otherwise, auto-select first active device
        const result = await invoke<DeviceListResult>("list_devices");
        const firstActive = result.devices.find(
          (d) => (d.state === "booted" || d.state === "connected") && d.isAvailable
        );
        if (firstActive) {
          setSelectedDevice(firstActive);
          await invoke("set_selected_device", { device: firstActive });
        } else if (result.devices.length > 0) {
          // If no active device, select first available one
          const firstAvailable = result.devices.find((d) => d.isAvailable);
          if (firstAvailable) {
            setSelectedDevice(firstAvailable);
            await invoke("set_selected_device", { device: firstAvailable });
          }
        }
      } catch (err) {
        console.error("Failed to load device:", err);
      }
    };
    loadSelectedDevice();
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
          setShowBottomPanel(true);
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

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(280, Math.min(400, w + delta)));
  }, []);

  const handleDevToolsResize = useCallback((delta: number) => {
    setDevToolsWidth((w) => Math.max(280, Math.min(600, w - delta)));
  }, []);

  // Keyboard shortcuts (VSCode/Cursor style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+J: Toggle bottom panel (VSCode style)
      if (e.metaKey && !e.shiftKey && e.key === "j") {
        e.preventDefault();
        setShowBottomPanel(prev => !prev);
      }
      // Ctrl+`: Toggle terminal (VSCode style)
      if (e.ctrlKey && !e.shiftKey && e.key === "`") {
        e.preventDefault();
        setShowBottomPanel(prev => !prev);
      }
      // Ctrl+Shift+`: New terminal (VSCode style)
      if (e.ctrlKey && e.shiftKey && e.key === "`") {
        e.preventDefault();
        setShowBottomPanel(true);
        // Use setTimeout to ensure the panel is rendered before calling addTerminal
        setTimeout(() => {
          bottomPanelRef.current?.addTerminal();
        }, 0);
      }
      // Cmd+B: Toggle right sidebar (simulator)
      if (e.metaKey && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        setRightCollapsed(prev => !prev);
      }
      // Cmd+Shift+E: Toggle dev tools (source control)
      if (e.metaKey && e.shiftKey && e.key === "e") {
        e.preventDefault();
        setShowDevTools(prev => !prev);
      }
      // Cmd+Shift+G: Toggle dev tools (git - same as E)
      if (e.metaKey && e.shiftKey && e.key === "g") {
        e.preventDefault();
        setShowDevTools(prev => !prev);
      }
      // Escape: Close panels/modals
      if (e.key === "Escape") {
        if (selectedDiffFile) {
          e.preventDefault();
          setSelectedDiffFile(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDiffFile]);

  // Build handlers
  const handleBuild = async () => {
    setBuildStatus("building");
    setBuildTime(null);

    try {
      const result = await invoke<BuildResult>("build_project", {
        projectPath: PROJECT_PATH,
        scheme: PROJECT_SCHEME,
        device: selectedDevice,
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
        device: selectedDevice,
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

  // Handle sending context from review modal
  const handleContextSend = async (
    message: string,
    selectedFrameIndices: number[],
    includeLogs: boolean
  ) => {
    if (!pendingRecording) return;

    // Get selected frames
    const selectedFrames = selectedFrameIndices.map(i => pendingRecording.frames[i]).filter(Boolean);

    // Save screenshots to temp files
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

    // Build the full message
    let fullMessage = message + "\n\n";

    // Add screenshot paths for Claude to view
    if (screenshotPaths.length > 0) {
      fullMessage += `Here are ${screenshotPaths.length} screenshots from the recording. Please read these image files to see the app state:\n`;
      screenshotPaths.forEach((path, i) => {
        fullMessage += `- Frame ${i + 1}: ${path}\n`;
      });
      fullMessage += "\n";
    }

    // Add logs if requested
    if (includeLogs) {
      const errorLogs = pendingRecording.logs.filter(l => l.level === "error" || l.level === "fault");
      if (errorLogs.length > 0) {
        fullMessage += `${errorLogs.length} errors detected in logs:\n`;
        errorLogs.slice(0, 10).forEach(log => {
          fullMessage += `- [${log.process}] ${log.message.slice(0, 200)}\n`;
        });
        if (errorLogs.length > 10) {
          fullMessage += `... and ${errorLogs.length - 10} more errors\n`;
        }
        fullMessage += "\n";
      }
    }

    // Add crash info if any
    if (pendingRecording.crashes.length > 0) {
      fullMessage += `${pendingRecording.crashes.length} crash(es) detected:\n`;
      pendingRecording.crashes.forEach(crash => {
        fullMessage += `- ${crash.processName}: ${crash.exceptionType || "Unknown"}\n`;
        if (crash.crashReason) {
          fullMessage += `  Reason: ${crash.crashReason}\n`;
        }
        if (crash.stackTrace) {
          fullMessage += `  Stack trace (first 500 chars): ${crash.stackTrace.slice(0, 500)}\n`;
        }
      });
      fullMessage += "\n";
    }

    // Send to Claude
    try {
      await invoke("send_claude_message", { message: fullMessage });
      console.log("Recording sent to Claude");
    } catch (e) {
      console.error("Failed to send recording to Claude:", e);
    }

    // Clear pending recording
    setPendingRecording(null);
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
          <DeviceSelector
            selectedDevice={selectedDevice}
            onDeviceSelect={setSelectedDevice}
            disabled={buildStatus === "building"}
          />
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
          {/* ACE Playbook button */}
          <button
            onClick={() => setShowPlaybookModal(true)}
            className="p-1.5 rounded hover:bg-hover text-text-tertiary hover:text-accent transition-colors"
            title="ACE Playbook"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </button>
          {/* Settings button */}
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
        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
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
              />
            )}
          </div>

          {/* Right Pane: Simulator (collapsible) */}
          {rightCollapsed ? (
            <div className="w-10 flex flex-col shrink-0 bg-surface-raised border-l border-border">
              <button
                onClick={() => setRightCollapsed(false)}
                className="p-2 m-1 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
                title="Show simulator"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              <ResizeHandle onResize={handleRightResize} direction="right" />
              <div
                style={{ width: rightWidth }}
                className="flex flex-col shrink-0 overflow-hidden bg-surface-raised relative group"
              >
                <SimulatorPane
                  isAppRunning={buildStatus === "success"}
                  onCapture={(data) => {
                    setPendingRecording(data);
                    setShowContextModal(true);
                  }}
                />
                {/* Collapse button */}
                <button
                  onClick={() => setRightCollapsed(true)}
                  className="absolute top-2 left-2 p-1 rounded bg-surface-overlay hover:bg-hover text-text-tertiary hover:text-text-primary transition-all opacity-0 group-hover:opacity-100 z-10"
                  title="Hide simulator"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </>
          )}

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

        {/* Bottom Panel - Terminal + Build Logs */}
        {showBottomPanel && (
          <BottomPanel
            ref={bottomPanelRef}
            height={bottomPanelHeight}
            onHeightChange={setBottomPanelHeight}
            onClose={() => setShowBottomPanel(false)}
            buildLogs={buildLogs}
            onClearBuildLogs={() => setBuildLogs([])}
            projectPath={PROJECT_PATH}
          />
        )}
      </div>

      {/* Context Review Modal */}
      <ContextReviewModal
        isOpen={showContextModal}
        onClose={() => {
          setShowContextModal(false);
          setPendingRecording(null);
        }}
        onSend={handleContextSend}
        recordingData={pendingRecording}
      />

      {/* ACE Playbook Modal */}
      <PlaybookModal
        isOpen={showPlaybookModal}
        onClose={() => setShowPlaybookModal(false)}
        projectPath={ROOT_PROJECT_PATH}
      />
    </div>
  );
};

export default App;

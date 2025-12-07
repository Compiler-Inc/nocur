import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface LogEntry {
  type: "info" | "error" | "warning" | "success";
  message: string;
  timestamp: Date;
}

interface TerminalLine {
  type: "input" | "output" | "error";
  content: string;
  timestamp: Date;
}

interface BottomPanelProps {
  height: number;
  onHeightChange: (height: number) => void;
  onClose: () => void;
  buildLogs: LogEntry[];
  onClearBuildLogs: () => void;
  projectPath: string;
}

export const BottomPanel = ({
  height,
  onHeightChange,
  onClose,
  buildLogs,
  onClearBuildLogs,
  projectPath,
}: BottomPanelProps) => {
  const [activeTab, setActiveTab] = useState<"build" | "terminal">("terminal");
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const buildEndRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLines]);

  // Auto-scroll build logs
  useEffect(() => {
    buildEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [buildLogs]);

  // Switch to build tab when new build logs come in
  useEffect(() => {
    if (buildLogs.length > 0) {
      const lastLog = buildLogs[buildLogs.length - 1];
      // Auto-switch to build tab when build starts
      if (lastLog.message.includes("Building")) {
        setActiveTab("build");
      }
    }
  }, [buildLogs]);

  // Focus input when terminal tab is active
  useEffect(() => {
    if (activeTab === "terminal") {
      inputRef.current?.focus();
    }
  }, [activeTab]);

  // Resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startY.current - e.clientY;
      const newHeight = Math.max(100, Math.min(500, startHeight.current + delta));
      onHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onHeightChange]);

  const handleResizeStart = (e: React.MouseEvent) => {
    resizing.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const executeCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    // Add to history
    setCommandHistory(prev => [...prev.filter(c => c !== cmd), cmd]);
    setHistoryIndex(-1);

    // Add input line
    setTerminalLines(prev => [...prev, {
      type: "input",
      content: `$ ${cmd}`,
      timestamp: new Date(),
    }]);

    setIsRunning(true);

    try {
      const result = await invoke<{ stdout: string; stderr: string; exitCode: number }>(
        "run_terminal_command",
        { command: cmd, workingDir: projectPath }
      );

      if (result.stdout) {
        setTerminalLines(prev => [...prev, {
          type: "output",
          content: result.stdout,
          timestamp: new Date(),
        }]);
      }

      if (result.stderr) {
        setTerminalLines(prev => [...prev, {
          type: "error",
          content: result.stderr,
          timestamp: new Date(),
        }]);
      }

      if (result.exitCode !== 0 && !result.stderr) {
        setTerminalLines(prev => [...prev, {
          type: "error",
          content: `Process exited with code ${result.exitCode}`,
          timestamp: new Date(),
        }]);
      }
    } catch (e) {
      setTerminalLines(prev => [...prev, {
        type: "error",
        content: `Error: ${e}`,
        timestamp: new Date(),
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [projectPath]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isRunning) {
      executeCommand(inputValue);
      setInputValue("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || "");
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputValue("");
      }
    } else if (e.key === "c" && e.ctrlKey) {
      // TODO: Send interrupt signal
      setTerminalLines(prev => [...prev, {
        type: "output",
        content: "^C",
        timestamp: new Date(),
      }]);
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setTerminalLines([]);
    }
  };

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "error": return "text-error";
      case "warning": return "text-warning";
      case "success": return "text-success";
      default: return "text-text-secondary";
    }
  };

  return (
    <div className="bg-surface-raised flex flex-col shrink-0" style={{ height }}>
      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className="h-1 bg-border hover:bg-accent/50 cursor-row-resize transition-colors shrink-0"
      />

      {/* Panel Header with Tabs */}
      <div className="h-9 px-2 flex items-center justify-between border-b border-border-subtle bg-surface-raised shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("terminal")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              activeTab === "terminal"
                ? "bg-surface-overlay text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            Terminal
          </button>
          <button
            onClick={() => setActiveTab("build")}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
              activeTab === "build"
                ? "bg-surface-overlay text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            Build
            {buildLogs.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-surface-sunken rounded">
                {buildLogs.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {activeTab === "terminal" && (
            <button
              onClick={() => setTerminalLines([])}
              className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
              title="Clear (Ctrl+L)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeWidth="2" strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          {activeTab === "build" && buildLogs.length > 0 && (
            <button
              onClick={onClearBuildLogs}
              className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
              title="Clear"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeWidth="2" strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
            title="Close"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === "terminal" ? (
        <div
          className="flex-1 flex flex-col overflow-hidden bg-surface-sunken"
          onClick={() => inputRef.current?.focus()}
        >
          {/* Terminal output */}
          <div className="flex-1 overflow-auto p-2 font-mono text-[12px]">
            {terminalLines.length === 0 && (
              <div className="text-text-tertiary">
                <span className="text-accent">$</span> Type a command and press Enter
              </div>
            )}
            {terminalLines.map((line, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all ${
                  line.type === "input"
                    ? "text-text-primary"
                    : line.type === "error"
                    ? "text-error"
                    : "text-text-secondary"
                }`}
              >
                {line.content}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Input line */}
          <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border-subtle bg-surface-raised">
            <span className="text-accent font-mono text-xs">$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              placeholder={isRunning ? "Running..." : "Enter command..."}
              className="flex-1 bg-transparent text-text-primary font-mono text-xs outline-none placeholder-text-tertiary disabled:opacity-50"
              autoFocus
            />
          </div>
        </div>
      ) : (
        /* Build logs */
        <div className="flex-1 overflow-auto p-2 font-mono text-[11px]">
          {buildLogs.length === 0 ? (
            <div className="text-text-tertiary text-center py-4">
              No build output yet. Click "Build" or "Run" to start.
            </div>
          ) : (
            buildLogs.map((log, i) => (
              <div key={i} className={`${getLogColor(log.type)} leading-relaxed`}>
                <span className="text-text-tertiary opacity-50">
                  {log.timestamp.toLocaleTimeString("en-US", { hour12: false })}
                </span>
                {" "}
                {log.message}
              </div>
            ))
          )}
          <div ref={buildEndRef} />
        </div>
      )}
    </div>
  );
};

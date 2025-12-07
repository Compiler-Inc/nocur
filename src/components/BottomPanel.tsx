import { useState, useEffect, useRef } from "react";
import { XTerminal } from "./XTerminal";

interface LogEntry {
  type: "info" | "error" | "warning" | "success";
  message: string;
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
  const [activeTab, setActiveTab] = useState<"terminal" | "build">("terminal");
  const buildEndRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Auto-scroll build logs
  useEffect(() => {
    buildEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [buildLogs]);

  // Switch to build tab when new build logs come in
  useEffect(() => {
    if (buildLogs.length > 0) {
      const lastLog = buildLogs[buildLogs.length - 1];
      if (lastLog.message.includes("Building")) {
        setActiveTab("build");
      }
    }
  }, [buildLogs]);

  // Resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startY.current - e.clientY;
      const newHeight = Math.max(150, Math.min(600, startHeight.current + delta));
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

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "error": return "text-error";
      case "warning": return "text-warning";
      case "success": return "text-success";
      default: return "text-text-secondary";
    }
  };

  return (
    <div className="bg-surface-raised flex flex-col shrink-0 border-t border-border" style={{ height }}>
      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className="h-1 bg-transparent hover:bg-accent/50 cursor-row-resize transition-colors shrink-0"
      />

      {/* Panel Header with Tabs */}
      <div className="h-9 px-2 flex items-center justify-between border-b border-border-subtle bg-surface-base shrink-0">
        <div className="flex items-center">
          <button
            onClick={() => setActiveTab("terminal")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-[1px] ${
              activeTab === "terminal"
                ? "text-text-primary border-accent"
                : "text-text-tertiary hover:text-text-secondary border-transparent"
            }`}
          >
            Terminal
          </button>
          <button
            onClick={() => setActiveTab("build")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-[1px] flex items-center gap-1.5 ${
              activeTab === "build"
                ? "text-text-primary border-accent"
                : "text-text-tertiary hover:text-text-secondary border-transparent"
            }`}
          >
            Output
            {buildLogs.length > 0 && (
              <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                activeTab === "build" ? "bg-accent/20 text-accent" : "bg-surface-sunken text-text-tertiary"
              }`}>
                {buildLogs.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {activeTab === "build" && buildLogs.length > 0 && (
            <button
              onClick={onClearBuildLogs}
              className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
              title="Clear output"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeWidth="2" strokeLinecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <div className="text-[10px] text-text-tertiary px-2">
            {activeTab === "terminal" ? "Ctrl+`" : ""}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
            title="Close panel"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "terminal" ? (
          <XTerminal workingDir={projectPath} />
        ) : (
          <div className="h-full overflow-auto p-2 font-mono text-[12px] bg-surface-sunken">
            {buildLogs.length === 0 ? (
              <div className="text-text-tertiary">
                No output yet. Build or run your project to see output here.
              </div>
            ) : (
              buildLogs.map((log, i) => (
                <div key={i} className={`${getLogColor(log.type)} leading-relaxed whitespace-pre-wrap`}>
                  <span className="text-text-tertiary opacity-50 select-none">
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
    </div>
  );
};

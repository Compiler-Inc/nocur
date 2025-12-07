import { useEffect, useState, useRef } from "react";

// Types matching SimulatorPane
interface CapturedFrame {
  image: string;
  timestamp: number;
  hierarchy?: string;
}

interface SimulatorLogEntry {
  timestamp: number;
  level: string;
  process: string;
  message: string;
}

interface CrashReport {
  path: string;
  processName: string;
  timestamp: number;
  exceptionType: string | null;
  crashReason: string | null;
  stackTrace: string | null;
}

export interface RecordingData {
  frames: CapturedFrame[];
  logs: SimulatorLogEntry[];
  crashes: CrashReport[];
  startTime: number;
  endTime: number;
}

interface ContextReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: string, selectedFrameIndices: number[], includeLogs: boolean) => void;
  recordingData: RecordingData | null;
  initialMessage?: string;
}

export const ContextReviewModal = ({
  isOpen,
  onClose,
  onSend,
  recordingData,
  initialMessage = "",
}: ContextReviewModalProps) => {
  const [message, setMessage] = useState(initialMessage);
  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set());
  const [includeLogs, setIncludeLogs] = useState(true);
  const [logFilter, setLogFilter] = useState<"all" | "errors">("errors");
  const [activeTab, setActiveTab] = useState<"frames" | "logs" | "crashes">("frames");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize when modal opens
  useEffect(() => {
    if (isOpen && recordingData) {
      // Auto-select ~5 evenly distributed frames
      const maxFrames = 5;
      const step = Math.max(1, Math.floor(recordingData.frames.length / maxFrames));
      const autoSelected = new Set<number>();
      for (let i = 0; i < recordingData.frames.length && autoSelected.size < maxFrames; i += step) {
        autoSelected.add(i);
      }
      setSelectedFrames(autoSelected);

      // Generate default message
      const duration = Math.round((recordingData.endTime - recordingData.startTime) / 1000);
      const errorLogs = recordingData.logs.filter(l => l.level === "error" || l.level === "fault");

      let defaultMsg = initialMessage || `I recorded the iOS simulator for ${duration}s. Please analyze what you see.`;

      if (errorLogs.length > 0) {
        defaultMsg += `\n\nNote: ${errorLogs.length} error(s) detected in logs.`;
      }
      if (recordingData.crashes.length > 0) {
        defaultMsg += `\n\nWarning: ${recordingData.crashes.length} crash(es) detected!`;
      }

      setMessage(defaultMsg);
      setIncludeLogs(true);
      setLogFilter("errors");
    }
  }, [isOpen, recordingData, initialMessage]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const toggleFrame = (index: number) => {
    setSelectedFrames(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const selectAllFrames = () => {
    if (!recordingData) return;
    setSelectedFrames(new Set(recordingData.frames.map((_, i) => i)));
  };

  const selectNoneFrames = () => {
    setSelectedFrames(new Set());
  };

  const handleSend = () => {
    onSend(message, Array.from(selectedFrames), includeLogs);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (message.trim()) {
        handleSend();
      }
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen || !recordingData) return null;

  const duration = Math.round((recordingData.endTime - recordingData.startTime) / 1000);
  const errorLogs = recordingData.logs.filter(l => l.level === "error" || l.level === "fault");
  const filteredLogs = logFilter === "errors" ? errorLogs : recordingData.logs;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface-base border border-border rounded-xl shadow-2xl w-[1000px] max-w-[95vw] h-[85vh] max-h-[900px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-raised">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Review Recording</h2>
            <span className="px-2 py-0.5 rounded-full bg-accent/20 text-accent text-xs">
              {duration}s · {recordingData.frames.length} frames · {recordingData.logs.length} logs
            </span>
            {recordingData.crashes.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-error/20 text-error text-xs">
                {recordingData.crashes.length} crash{recordingData.crashes.length > 1 ? "es" : ""}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {/* Left side - Context preview */}
          <div className="w-1/2 border-r border-border flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-border-subtle">
              <button
                onClick={() => setActiveTab("frames")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "frames"
                    ? "text-accent border-b-2 border-accent"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Frames ({selectedFrames.size}/{recordingData.frames.length})
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "logs"
                    ? "text-accent border-b-2 border-accent"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Logs ({errorLogs.length} errors)
              </button>
              {recordingData.crashes.length > 0 && (
                <button
                  onClick={() => setActiveTab("crashes")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === "crashes"
                      ? "text-error border-b-2 border-error"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  Crashes ({recordingData.crashes.length})
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3">
              {activeTab === "frames" && (
                <div className="space-y-3">
                  {/* Selection controls */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">
                      {selectedFrames.size} of {recordingData.frames.length} selected
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllFrames}
                        className="px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary hover:bg-hover rounded transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={selectNoneFrames}
                        className="px-2 py-1 text-xs text-text-tertiary hover:text-text-secondary hover:bg-hover rounded transition-colors"
                      >
                        Select None
                      </button>
                    </div>
                  </div>

                  {/* Frame grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {recordingData.frames.map((frame, index) => (
                      <button
                        key={index}
                        onClick={() => toggleFrame(index)}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                          selectedFrames.has(index)
                            ? "border-accent ring-2 ring-accent/30"
                            : "border-transparent hover:border-border"
                        }`}
                      >
                        <img
                          src={frame.image}
                          alt={`Frame ${index + 1}`}
                          className="w-full aspect-[9/19] object-cover bg-black"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                          <span className="text-[10px] text-white">
                            {((frame.timestamp - recordingData.startTime) / 1000).toFixed(1)}s
                          </span>
                        </div>
                        {selectedFrames.has(index) && (
                          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "logs" && (
                <div className="space-y-3">
                  {/* Log controls */}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeLogs}
                        onChange={(e) => setIncludeLogs(e.target.checked)}
                        className="w-4 h-4 rounded border-border bg-surface-overlay text-accent"
                      />
                      <span className="text-sm text-text-primary">Include logs in message</span>
                    </label>
                    <select
                      value={logFilter}
                      onChange={(e) => setLogFilter(e.target.value as "all" | "errors")}
                      className="px-2 py-1 text-xs rounded bg-surface-overlay border border-border text-text-primary"
                    >
                      <option value="errors">Errors only ({errorLogs.length})</option>
                      <option value="all">All logs ({recordingData.logs.length})</option>
                    </select>
                  </div>

                  {/* Log list */}
                  <div className="space-y-1 max-h-[400px] overflow-y-auto">
                    {filteredLogs.length === 0 ? (
                      <div className="text-center py-8 text-text-tertiary text-sm">
                        {logFilter === "errors" ? "No errors detected" : "No logs captured"}
                      </div>
                    ) : (
                      filteredLogs.map((log, index) => (
                        <div
                          key={index}
                          className={`p-2 rounded text-xs font-mono ${
                            log.level === "error" || log.level === "fault"
                              ? "bg-error/10 border border-error/30"
                              : "bg-surface-sunken"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1 rounded text-[10px] ${
                              log.level === "error" || log.level === "fault"
                                ? "bg-error/20 text-error"
                                : "bg-surface-overlay text-text-tertiary"
                            }`}>
                              {log.level}
                            </span>
                            <span className="text-text-tertiary">{log.process}</span>
                          </div>
                          <div className="text-text-secondary break-all">{log.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === "crashes" && (
                <div className="space-y-3">
                  {recordingData.crashes.map((crash, index) => (
                    <div key={index} className="p-3 rounded-lg bg-error/10 border border-error/30">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="font-medium text-error">{crash.processName}</span>
                      </div>
                      {crash.exceptionType && (
                        <div className="text-sm text-text-primary mb-1">
                          Exception: {crash.exceptionType}
                        </div>
                      )}
                      {crash.crashReason && (
                        <div className="text-sm text-text-secondary mb-2">
                          Reason: {crash.crashReason}
                        </div>
                      )}
                      {crash.stackTrace && (
                        <pre className="text-xs text-text-tertiary bg-surface-sunken p-2 rounded overflow-x-auto max-h-32">
                          {crash.stackTrace.slice(0, 500)}
                          {crash.stackTrace.length > 500 && "..."}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right side - Message editor */}
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-3 border-b border-border-subtle">
              <h3 className="text-sm font-medium text-text-primary">Your Message</h3>
              <p className="text-xs text-text-tertiary mt-0.5">Edit before sending to Claude</p>
            </div>

            <div className="flex-1 p-4">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="What would you like Claude to analyze?"
                className="w-full h-full resize-none rounded-lg bg-surface-sunken border border-border p-4 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent text-[15px] leading-relaxed"
              />
            </div>

            {/* Context summary */}
            <div className="px-4 py-3 border-t border-border-subtle bg-surface-raised">
              <div className="text-xs text-text-tertiary mb-2">Will send to Claude:</div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent text-xs">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {selectedFrames.size} screenshot{selectedFrames.size !== 1 ? "s" : ""}
                </span>
                {includeLogs && errorLogs.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-warning/10 text-warning text-xs">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {errorLogs.length} error log{errorLogs.length !== 1 ? "s" : ""}
                  </span>
                )}
                {recordingData.crashes.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-error/10 text-error text-xs">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {recordingData.crashes.length} crash{recordingData.crashes.length !== 1 ? "es" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface-raised">
          <div className="text-xs text-text-tertiary">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay border border-border">⌘</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay border border-border">Enter</kbd>
            <span className="ml-2">to send</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!message.trim() || selectedFrames.size === 0}
              className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span>Send to Claude</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

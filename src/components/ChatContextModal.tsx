import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileRef {
  path: string;
  name: string;
}

interface ContextItem {
  type: "screenshot" | "file";
  label: string;
  enabled: boolean;
  path?: string;
}

interface ChatContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: string, context: ContextItem[]) => void;
  initialMessage: string;
  fileReferences: FileRef[];
  projectPath: string;
}

export const ChatContextModal = ({
  isOpen,
  onClose,
  onSend,
  initialMessage,
  fileReferences,
  projectPath: _projectPath,
}: ChatContextModalProps) => {
  const [message, setMessage] = useState(initialMessage);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set(fileReferences.map(f => f.path)));
  const [activeTab, setActiveTab] = useState<"screenshot" | "files">("screenshot");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Capture screenshot when modal opens
  useEffect(() => {
    if (isOpen) {
      setMessage(initialMessage);
      setSelectedFiles(new Set(fileReferences.map(f => f.path)));
      captureScreenshot();
    }
  }, [isOpen, initialMessage, fileReferences]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const captureScreenshot = async () => {
    setScreenshotLoading(true);
    setScreenshotError(null);
    try {
      const result = await invoke<string>("take_screenshot");
      setScreenshot(result);
    } catch (e) {
      console.error("Failed to capture screenshot:", e);
      setScreenshotError("Failed to capture");
    } finally {
      setScreenshotLoading(false);
    }
  };

  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSend = () => {
    const context: ContextItem[] = [];

    if (includeScreenshot && screenshot) {
      context.push({ type: "screenshot", label: "Current screenshot", enabled: true });
    }

    fileReferences.forEach(ref => {
      if (selectedFiles.has(ref.path)) {
        context.push({ type: "file", label: ref.name, enabled: true, path: ref.path });
      }
    });

    // Use default message if none provided but context is selected
    const finalMessage = message.trim() || (context.length > 0 ? "Please analyze this." : "");

    onSend(finalMessage, context);
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

  if (!isOpen) return null;

  const selectedCount = (includeScreenshot && screenshot ? 1 : 0) + selectedFiles.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface-base border border-border rounded-xl shadow-2xl w-[800px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-raised">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Review Context</h2>
            <span className="px-2 py-0.5 rounded-full bg-accent/20 text-accent text-xs">
              {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
            </span>
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
          {/* Left side - Context items */}
          <div className="w-1/2 border-r border-border flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-border-subtle">
              <button
                onClick={() => setActiveTab("screenshot")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "screenshot"
                    ? "text-accent border-b-2 border-accent"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Screenshot
              </button>
              <button
                onClick={() => setActiveTab("files")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "files"
                    ? "text-accent border-b-2 border-accent"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                Files ({fileReferences.length})
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === "screenshot" && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeScreenshot}
                      onChange={(e) => setIncludeScreenshot(e.target.checked)}
                      className="w-4 h-4 rounded border-border bg-surface-overlay text-accent"
                    />
                    <span className="text-sm text-text-primary">Include screenshot</span>
                    <button
                      onClick={captureScreenshot}
                      className="ml-auto text-xs text-text-tertiary hover:text-accent transition-colors"
                    >
                      Refresh
                    </button>
                  </label>

                  <div className="rounded-lg overflow-hidden border border-border bg-black aspect-[9/16] max-h-[300px] flex items-center justify-center">
                    {screenshotLoading ? (
                      <div className="text-text-tertiary text-sm">Capturing...</div>
                    ) : screenshotError ? (
                      <div className="text-center p-4">
                        <svg className="w-8 h-8 mx-auto text-warning mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <p className="text-warning text-sm">{screenshotError}</p>
                      </div>
                    ) : screenshot ? (
                      <img src={screenshot} alt="Simulator screenshot" className="w-full h-full object-contain" />
                    ) : (
                      <div className="text-text-tertiary text-sm">No screenshot</div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "files" && (
                <div className="space-y-2">
                  {fileReferences.length === 0 ? (
                    <div className="text-center py-8 text-text-tertiary text-sm">
                      No files referenced. Use @filename to reference files.
                    </div>
                  ) : (
                    fileReferences.map((ref) => (
                      <label
                        key={ref.path}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-hover cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(ref.path)}
                          onChange={() => toggleFile(ref.path)}
                          className="w-4 h-4 rounded border-border bg-surface-overlay text-accent"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">{ref.name}</div>
                          <div className="text-xs text-text-tertiary truncate">{ref.path}</div>
                        </div>
                      </label>
                    ))
                  )}
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
                placeholder="What would you like Claude to do?"
                className="w-full h-full resize-none rounded-lg bg-surface-sunken border border-border p-4 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent text-[15px] leading-relaxed"
              />
            </div>

            {/* Context summary */}
            <div className="px-4 py-3 border-t border-border-subtle bg-surface-raised">
              <div className="flex flex-wrap gap-2">
                {includeScreenshot && screenshot && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent text-xs">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Current Screenshot
                  </span>
                )}
                {Array.from(selectedFiles).map(path => {
                  const ref = fileReferences.find(f => f.path === path);
                  return ref ? (
                    <span key={path} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-overlay text-text-secondary text-xs">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {ref.name}
                    </span>
                  ) : null;
                })}
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
              disabled={!message.trim() && !includeScreenshot && selectedFiles.size === 0}
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

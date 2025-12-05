import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GitChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

interface GitDiffStats {
  totalAdditions: number;
  totalDeletions: number;
  files: GitChangedFile[];
}

interface DevToolsPaneProps {
  projectPath: string;
  onClose: () => void;
  onFileSelect: (filePath: string) => void;
  selectedFile: string | null;
}

// Tab button component
const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "text-text-primary border-b-2 border-accent"
        : "text-text-tertiary hover:text-text-secondary"
    }`}
  >
    {children}
  </button>
);

export const DevToolsPane = ({ projectPath, onClose, onFileSelect, selectedFile }: DevToolsPaneProps) => {
  const [activeTab, setActiveTab] = useState<"changes" | "terminal">("changes");
  const [diffStats, setDiffStats] = useState<GitDiffStats | null>(null);

  // Fetch git diff stats
  useEffect(() => {
    const fetchDiffStats = async () => {
      try {
        const stats = await invoke<GitDiffStats>("get_git_diff_stats", {
          path: projectPath,
        });
        setDiffStats(stats);
      } catch (err) {
        console.error("Failed to get diff stats:", err);
      }
    };

    fetchDiffStats();
    const interval = setInterval(fetchDiffStats, 3000);
    return () => clearInterval(interval);
  }, [projectPath]);

  const getStatusColor = (status: string) => {
    if (status === "M" || status.includes("M")) return "text-warning";
    if (status === "A" || status.includes("A")) return "text-success";
    if (status === "D" || status.includes("D")) return "text-error";
    if (status === "?" || status === "??") return "text-text-tertiary";
    return "text-text-secondary";
  };

  const getStatusLabel = (status: string) => {
    if (status === "M" || status.includes("M")) return "M";
    if (status === "A" || status.includes("A")) return "A";
    if (status === "D" || status.includes("D")) return "D";
    if (status === "?" || status === "??") return "?";
    return status.charAt(0);
  };

  return (
    <div className="flex flex-col h-full bg-surface-raised border-l border-border">
      {/* Header with tabs */}
      <div className="h-10 flex items-center justify-between px-2 border-b border-border shrink-0">
        <div className="flex items-center">
          <TabButton
            active={activeTab === "changes"}
            onClick={() => setActiveTab("changes")}
          >
            Changes
            {diffStats && diffStats.files.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-accent-subtle text-accent rounded">
                {diffStats.files.length}
              </span>
            )}
          </TabButton>
          <TabButton
            active={activeTab === "terminal"}
            onClick={() => setActiveTab("terminal")}
          >
            Terminal
          </TabButton>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-tertiary mr-2">Shift+E</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="1.5" strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area */}
      {activeTab === "changes" ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Stats summary */}
          {diffStats && (
            <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-3 text-xs shrink-0">
              <span className="text-text-secondary">
                {diffStats.files.length} file{diffStats.files.length !== 1 ? "s" : ""} changed
              </span>
              {diffStats.totalAdditions > 0 && (
                <span className="text-success">+{diffStats.totalAdditions}</span>
              )}
              {diffStats.totalDeletions > 0 && (
                <span className="text-error">-{diffStats.totalDeletions}</span>
              )}
            </div>
          )}

          {/* File list - scrollable */}
          <div className="flex-1 overflow-auto">
            <div className="py-1">
              {diffStats?.files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => onFileSelect(file.path)}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-hover transition-colors ${
                    selectedFile === file.path ? "bg-accent/10 border-l-2 border-accent" : ""
                  }`}
                >
                  <span className={`font-mono w-4 ${getStatusColor(file.status)}`}>
                    {getStatusLabel(file.status)}
                  </span>
                  <span className="text-text-primary truncate flex-1 text-left font-mono">
                    {file.path.split("/").pop()}
                  </span>
                  <span className="text-text-tertiary text-[10px] font-mono truncate max-w-[80px]">
                    {file.path.includes("/") ? file.path.substring(0, file.path.lastIndexOf("/")) : ""}
                  </span>
                  {(file.additions > 0 || file.deletions > 0) && (
                    <span className="flex items-center gap-1 text-[10px] shrink-0">
                      {file.additions > 0 && (
                        <span className="text-success">+{file.additions}</span>
                      )}
                      {file.deletions > 0 && (
                        <span className="text-error">-{file.deletions}</span>
                      )}
                    </span>
                  )}
                </button>
              ))}
              {(!diffStats || diffStats.files.length === 0) && (
                <div className="px-3 py-8 text-xs text-text-tertiary text-center">
                  No changes detected
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Terminal tab */
        <div className="flex-1 flex flex-col overflow-hidden bg-surface-sunken">
          <div className="flex-1 p-3 font-mono text-xs text-text-secondary overflow-auto">
            <div className="text-text-tertiary mb-2">
              Terminal functionality coming soon...
            </div>
            <div className="flex items-center gap-2">
              <span className="text-accent">$</span>
              <span className="text-text-primary">cd {projectPath}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-accent">$</span>
              <span className="animate-pulse">_</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

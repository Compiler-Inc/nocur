import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DiffViewerProps {
  filePath: string;
  projectPath: string;
  onClose: () => void;
}

export const DiffViewer = ({ filePath, projectPath, onClose }: DiffViewerProps) => {
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDiff = async () => {
      setLoading(true);
      try {
        const diffContent = await invoke<string>("get_file_diff", {
          path: projectPath,
          filePath: filePath,
        });
        setDiff(diffContent);
      } catch (err) {
        console.error("Failed to get diff:", err);
        setDiff("");
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [filePath, projectPath]);

  const renderDiffLine = (line: string, index: number) => {
    let className = "text-text-secondary";
    let bgClass = "";

    if (line.startsWith("+") && !line.startsWith("+++")) {
      className = "text-success";
      bgClass = "bg-success/10";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className = "text-error";
      bgClass = "bg-error/10";
    } else if (line.startsWith("@@")) {
      className = "text-accent";
      bgClass = "bg-accent/5";
    } else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      className = "text-text-tertiary";
    }

    return (
      <div key={index} className={`${className} ${bgClass} px-4 font-mono text-sm leading-6 whitespace-pre`}>
        {line || " "}
      </div>
    );
  };

  const fileName = filePath.split("/").pop() || filePath;
  const dirPath = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-surface-raised shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 -ml-1.5 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
            title="Back to chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{fileName}</span>
            {dirPath && (
              <span className="text-xs text-text-tertiary font-mono">{dirPath}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">Press Esc to close</span>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-text-tertiary text-sm">Loading diff...</span>
          </div>
        ) : diff ? (
          <div className="py-2">
            {diff.split("\n").map((line, i) => renderDiffLine(line, i))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-text-tertiary text-sm">No changes in this file</span>
          </div>
        )}
      </div>
    </div>
  );
};

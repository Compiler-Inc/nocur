import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type BuildStatus = "idle" | "building" | "success" | "failed";

interface ProjectInfo {
  name: string;
  path: string;
  scheme?: string;
  bundleId?: string;
}

interface BuildResult {
  success: boolean;
  output: string;
  errors: BuildError[];
}

interface BuildError {
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

// Mock data - will be replaced with actual project detection
const mockProject: ProjectInfo | null = {
  name: "NocurTestApp",
  path: "<REPO_ROOT>/sample-app/NocurTestApp",
  scheme: "NocurTestApp",
  bundleId: "com.nocur.testapp",
};

const mockFiles = [
  { name: "NocurTestApp", type: "folder", children: [
    { name: "NocurTestAppApp.swift", type: "file" },
    { name: "ContentView.swift", type: "file" },
    { name: "Assets.xcassets", type: "folder" },
    { name: "Preview Content", type: "folder" },
  ]},
  { name: "NocurTestApp.xcodeproj", type: "project" },
];

const FileIcon = ({ type }: { type: string }) => {
  const icons: Record<string, string> = {
    folder: "▸",
    file: "◦",
    project: "◎",
  };
  return <span className="text-text-tertiary">{icons[type] || "◦"}</span>;
};

export const ProjectPane = () => {
  const [project] = useState<ProjectInfo | null>(mockProject);
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [buildErrors, setBuildErrors] = useState<BuildError[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["NocurTestApp"]));

  const handleBuild = async () => {
    if (!project) return;
    setBuildStatus("building");
    setBuildErrors([]);

    try {
      const result = await invoke<BuildResult>("build_project", {
        projectPath: project.path,
        scheme: project.scheme,
      });

      if (result.success) {
        setBuildStatus("success");
      } else {
        setBuildStatus("failed");
        setBuildErrors(result.errors);
      }
    } catch (error) {
      console.error("Build failed:", error);
      setBuildStatus("failed");
      setBuildErrors([{ file: null, line: null, column: null, message: String(error) }]);
    }
  };

  const handleRun = async () => {
    if (!project) return;
    setBuildStatus("building");
    setBuildErrors([]);

    try {
      const result = await invoke<BuildResult>("run_project", {
        projectPath: project.path,
        scheme: project.scheme,
      });

      if (result.success) {
        setBuildStatus("success");
      } else {
        setBuildStatus("failed");
      }
    } catch (error) {
      console.error("Run failed:", error);
      setBuildStatus("failed");
      setBuildErrors([{ file: null, line: null, column: null, message: String(error) }]);
    }
  };

  const statusConfig = {
    idle: { color: "bg-text-tertiary", text: "No build" },
    building: { color: "bg-warning animate-pulse", text: "Building..." },
    success: { color: "bg-success", text: "Build succeeded" },
    failed: { color: "bg-error", text: "Build failed" },
  };

  const toggleFolder = (name: string) => {
    const next = new Set(expandedFolders);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setExpandedFolders(next);
  };

  const renderFile = (file: { name: string; type: string; children?: any[] }, depth = 0) => {
    const isExpanded = expandedFolders.has(file.name);
    const hasChildren = file.children && file.children.length > 0;

    return (
      <div key={file.name}>
        <button
          className={`w-full flex items-center gap-2 px-2 py-1 text-xs font-mono hover:bg-hover rounded transition-colors ${
            file.type === "file" ? "text-text-secondary" : "text-text-primary"
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => hasChildren && toggleFolder(file.name)}
        >
          {hasChildren && (
            <span className={`text-text-tertiary transition-transform ${isExpanded ? "rotate-90" : ""}`}>
              ▸
            </span>
          )}
          {!hasChildren && <FileIcon type={file.type} />}
          <span className={hasChildren ? "text-text-primary" : ""}>{file.name}</span>
        </button>
        {isExpanded && file.children?.map((child) => renderFile(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border bg-surface-raised/50">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-text-primary">Project</h2>
          {project && (
            <span className="text-xs text-text-tertiary font-mono">{project.name}</span>
          )}
        </div>
        <button className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-secondary hover:text-text-primary transition-colors">
          Open...
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!project ? (
          <div className="h-full flex flex-col items-center justify-center text-text-tertiary p-4">
            <div className="text-4xl mb-4">◎</div>
            <p className="text-sm">No project selected</p>
            <p className="text-xs mt-1 text-text-tertiary">
              Open an Xcode project to get started
            </p>
            <button className="mt-4 px-4 py-2 text-xs rounded bg-accent hover:bg-accent-muted text-surface-base transition-colors">
              Open Project...
            </button>
          </div>
        ) : (
          <div className="p-2">
            {/* Project info */}
            <div className="mb-4 p-3 rounded border border-border bg-surface-raised/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-text-tertiary">◎</span>
                <span className="text-sm font-medium text-text-primary">{project.name}</span>
              </div>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary w-16">Path</span>
                  <span className="text-text-tertiary truncate">{project.path}</span>
                </div>
                {project.scheme && (
                  <div className="flex items-center gap-2">
                    <span className="text-text-tertiary w-16">Scheme</span>
                    <span className="text-text-secondary">{project.scheme}</span>
                  </div>
                )}
                {project.bundleId && (
                  <div className="flex items-center gap-2">
                    <span className="text-text-tertiary w-16">Bundle</span>
                    <span className="text-text-secondary">{project.bundleId}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Build status */}
            <div className="mb-4 p-3 rounded border border-border bg-surface-raised/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${statusConfig[buildStatus].color}`} />
                  <span className="text-xs text-text-secondary">{statusConfig[buildStatus].text}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleBuild}
                    disabled={buildStatus === "building"}
                    className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {buildStatus === "building" ? "..." : "Build"}
                  </button>
                  <button
                    onClick={handleRun}
                    disabled={buildStatus === "building"}
                    className="px-2 py-1 text-xs rounded bg-surface-overlay hover:bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {buildStatus === "building" ? "..." : "Run"}
                  </button>
                </div>
              </div>
            </div>

            {/* Build errors */}
            {buildErrors.length > 0 && (
              <div className="mb-4 p-3 rounded border border-error/30 bg-error-muted">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-error text-xs">✗</span>
                  <span className="text-xs font-medium text-error">{buildErrors.length} error(s)</span>
                </div>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {buildErrors.map((error, i) => (
                    <div key={i} className="text-xs font-mono text-text-secondary">
                      {error.file && (
                        <span className="text-text-tertiary">{error.file.split('/').pop()}:{error.line}: </span>
                      )}
                      <span className="text-error">{error.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File tree */}
            <div className="space-y-1">
              <div className="px-2 py-1 flex items-center justify-between">
                <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  Files
                </span>
                <button className="text-text-tertiary hover:text-text-secondary transition-colors">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeWidth="2" strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              <div className="rounded border border-border-subtle bg-surface-raised/20 py-1">
                {mockFiles.map((file) => renderFile(file))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="h-10 px-3 flex items-center justify-between border-t border-border bg-surface-raised/50 shrink-0">
        <div className="flex items-center gap-1 text-[10px] text-text-tertiary font-mono truncate">
          <span className="shrink-0">Xcode 16.0</span>
          <span className="text-border shrink-0">•</span>
          <span className="shrink-0">Swift 5.9</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded hover:bg-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

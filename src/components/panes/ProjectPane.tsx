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

// No default project - users should select their own project
const defaultProject: ProjectInfo | null = null;

export const ProjectPane = () => {
  const [project] = useState<ProjectInfo | null>(defaultProject);
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [buildErrors, setBuildErrors] = useState<BuildError[]>([]);
  const [buildTime, setBuildTime] = useState<number | null>(null);
  const [warnings, setWarnings] = useState(0);

  const handleBuild = async () => {
    if (!project) return;
    setBuildStatus("building");
    setBuildErrors([]);
    setBuildTime(null);
    setWarnings(0);

    try {
      const result = await invoke<BuildResult>("build_project", {
        projectPath: project.path,
        scheme: project.scheme,
      });

      if (result.success) {
        setBuildStatus("success");
        setBuildTime(result.buildTime);
        setWarnings(result.warnings);
      } else {
        setBuildStatus("failed");
        setBuildErrors(result.errors);
        setBuildTime(result.buildTime);
        setWarnings(result.warnings);
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
    setBuildTime(null);
    setWarnings(0);

    try {
      const result = await invoke<BuildResult>("run_project", {
        projectPath: project.path,
        scheme: project.scheme,
      });

      if (result.success) {
        setBuildStatus("success");
        setBuildTime(result.buildTime);
        setWarnings(result.warnings);
      } else {
        setBuildStatus("failed");
        setBuildErrors(result.errors);
        setBuildTime(result.buildTime);
        setWarnings(result.warnings);
      }
    } catch (error) {
      console.error("Run failed:", error);
      setBuildStatus("failed");
      setBuildErrors([{ file: null, line: null, column: null, message: String(error) }]);
    }
  };

  const statusConfig = {
    idle: { color: "bg-text-tertiary", text: "Ready" },
    building: { color: "bg-warning animate-pulse", text: "Building..." },
    success: { color: "bg-success", text: buildTime ? `${buildTime.toFixed(1)}s` : "Succeeded" },
    failed: { color: "bg-error", text: "Failed" },
  };

  return (
    <div className="flex flex-col h-full bg-surface-raised">
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
          <div className="p-3 space-y-3">
            {/* Build controls - compact */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${statusConfig[buildStatus].color}`} />
                <span className="text-xs font-medium text-text-primary">
                  {statusConfig[buildStatus].text}
                </span>
                {warnings > 0 && buildStatus !== "building" && (
                  <span className="text-xs text-warning">
                    {warnings} warning{warnings !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleBuild}
                  disabled={buildStatus === "building"}
                  className="px-3 py-1.5 text-xs rounded bg-surface-overlay hover:bg-hover text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  Build
                </button>
                <button
                  onClick={handleRun}
                  disabled={buildStatus === "building"}
                  className="px-3 py-1.5 text-xs rounded bg-accent hover:bg-accent-muted text-surface-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  ▶ Run
                </button>
              </div>
            </div>

            {/* Build errors - compact */}
            {buildErrors.length > 0 && (
              <div className="p-2 rounded border border-error/30 bg-error-muted">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-error text-xs font-medium">
                    {buildErrors.length} error{buildErrors.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {buildErrors.slice(0, 3).map((error, i) => (
                    <div key={i} className="text-[11px] font-mono text-error truncate">
                      {error.file && `${error.file.split("/").pop()}:${error.line}: `}
                      {error.message}
                    </div>
                  ))}
                  {buildErrors.length > 3 && (
                    <div className="text-[11px] text-text-tertiary">
                      +{buildErrors.length - 3} more errors
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Project info */}
            <div className="p-3 rounded border border-border bg-surface-raised/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-accent">◎</span>
                <span className="text-xs font-medium text-text-primary">{project.name}</span>
              </div>
              <div className="space-y-1 text-[11px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary w-14">Scheme</span>
                  <span className="text-text-secondary">{project.scheme}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary w-14">Bundle</span>
                  <span className="text-text-secondary">{project.bundleId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-text-tertiary w-14">Path</span>
                  <span className="text-text-tertiary truncate" title={project.path}>
                    {project.path}
                  </span>
                </div>
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

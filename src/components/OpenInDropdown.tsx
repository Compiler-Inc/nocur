import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DetectedProject {
  projectType: string;
  name: string;
  path: string;
}

interface InstalledApp {
  id: string;
  name: string;
  path: string;
  icon: string | null;
}

interface OpenInInfo {
  projects: DetectedProject[];
  apps: InstalledApp[];
}

interface OpenInDropdownProps {
  projectPath: string;
}

// App icons/emojis
const APP_ICONS: Record<string, string> = {
  finder: "📁",
  xcode: "🔨",
  "xcode-beta": "🔨",
  vscode: "💻",
  cursor: "▶️",
  zed: "⚡",
  sublime: "📝",
  fleet: "🚀",
  nova: "🌟",
  terminal: "⬛",
  iterm: "🖥️",
  warp: "🌀",
  ghostty: "👻",
  alacritty: "🔲",
  kitty: "🐱",
};

// Group apps by category
const EDITORS = ["vscode", "cursor", "zed", "sublime", "fleet", "nova"];
const TERMINALS = ["terminal", "iterm", "warp", "ghostty", "alacritty", "kitty"];

export const OpenInDropdown = ({ projectPath }: OpenInDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openInInfo, setOpenInInfo] = useState<OpenInInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load options when dropdown opens
  useEffect(() => {
    if (isOpen && !openInInfo) {
      invoke<OpenInInfo>("get_open_in_options", { path: projectPath })
        .then(setOpenInInfo)
        .catch(console.error);
    }
  }, [isOpen, projectPath, openInInfo]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleOpenIn = async (appId: string, projectPath?: string) => {
    try {
      await invoke("open_in_app", {
        appId,
        path: projectPath || openInInfo?.projects[0]?.path || "",
        projectPath,
      });
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to open in app:", err);
    }
  };

  const handleCopyPath = async () => {
    try {
      await invoke("copy_to_clipboard", { text: projectPath });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  };

  // Group installed apps
  const editors = openInInfo?.apps.filter(a => EDITORS.includes(a.id)) || [];
  const terminals = openInInfo?.apps.filter(a => TERMINALS.includes(a.id)) || [];
  const xcodeApps = openInInfo?.apps.filter(a => a.id.startsWith("xcode")) || [];
  const finder = openInInfo?.apps.find(a => a.id === "finder");

  // Get Xcode projects
  const xcodeProjects = openInInfo?.projects.filter(p => p.projectType === "xcode") || [];

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
      >
        <span>Open</span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-surface-overlay border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Finder - always first */}
          {finder && (
            <button
              onClick={() => handleOpenIn("finder", projectPath)}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-text-primary hover:bg-hover transition-colors"
            >
              <span>{APP_ICONS.finder}</span>
              <span>Finder</span>
            </button>
          )}

          {/* Xcode projects */}
          {xcodeApps.length > 0 && xcodeProjects.length > 0 && (
            <>
              <div className="h-px bg-border-subtle mx-2" />
              {xcodeProjects.map((project) => (
                <button
                  key={project.path}
                  onClick={() => handleOpenIn(xcodeApps[0].id, project.path)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-xs text-text-primary hover:bg-hover transition-colors"
                >
                  <span>{APP_ICONS.xcode}</span>
                  <span className="truncate">Xcode</span>
                  <span className="text-text-tertiary truncate ml-auto">{project.name}</span>
                </button>
              ))}
            </>
          )}

          {/* Editors */}
          {editors.length > 0 && (
            <>
              <div className="h-px bg-border-subtle mx-2" />
              {editors.map((app) => (
                <button
                  key={app.id}
                  onClick={() => handleOpenIn(app.id, projectPath)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-xs text-text-primary hover:bg-hover transition-colors"
                >
                  <span>{APP_ICONS[app.id] || "📝"}</span>
                  <span>{app.name}</span>
                </button>
              ))}
            </>
          )}

          {/* Terminals */}
          {terminals.length > 0 && (
            <>
              <div className="h-px bg-border-subtle mx-2" />
              {terminals.map((app) => (
                <button
                  key={app.id}
                  onClick={() => handleOpenIn(app.id, projectPath)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-xs text-text-primary hover:bg-hover transition-colors"
                >
                  <span>{APP_ICONS[app.id] || "⬛"}</span>
                  <span>{app.name}</span>
                </button>
              ))}
            </>
          )}

          {/* Copy path */}
          <div className="h-px bg-border-subtle mx-2" />
          <button
            onClick={handleCopyPath}
            className="w-full px-3 py-2 flex items-center gap-2 text-xs text-text-primary hover:bg-hover transition-colors"
          >
            <span>📋</span>
            <span>{copied ? "Copied!" : "Copy path"}</span>
            <span className="ml-auto text-text-tertiary text-[10px]">⌘C</span>
          </button>
        </div>
      )}
    </div>
  );
};

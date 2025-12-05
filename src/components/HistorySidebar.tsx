import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// City names for workspaces (like Conductor)
const CITY_NAMES = [
  "tokyo", "paris", "london", "berlin", "sydney", "cairo", "mumbai", "seoul",
  "rome", "vienna", "prague", "lisbon", "dublin", "oslo", "stockholm", "helsinki",
  "amsterdam", "brussels", "zurich", "milan", "barcelona", "madrid", "athens",
  "istanbul", "dubai", "singapore", "bangkok", "hanoi", "manila", "jakarta",
  "nairobi", "lagos", "casablanca", "capetown", "montreal", "vancouver", "seattle",
  "denver", "austin", "miami", "boston", "chicago", "portland", "phoenix",
  "havana", "lima", "bogota", "santiago", "buenosaires", "rio", "saopaulo",
  "reykjavik", "tallinn", "riga", "vilnius", "warsaw", "budapest", "bucharest",
  "sofia", "belgrade", "zagreb", "ljubljana", "bratislava", "kyiv", "minsk"
];

// Generate a deterministic city name from branch/path
const getCityName = (input: string): string => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return CITY_NAMES[Math.abs(hash) % CITY_NAMES.length];
};

// Format timestamp as relative time
const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
};

interface GitWorktree {
  path: string;
  branch: string;
  isMain: boolean;
  sessionId: string | null;
}

interface GitInfo {
  branch: string;
  isDirty: boolean;
  hasUntracked: boolean;
  ahead: number;
  behind: number;
  shortStatus: string;
}

interface ClaudeCodeSession {
  id: string;
  projectPath: string;
  projectHash: string;
  createdAt: number;
  lastMessage: string | null;
  messageCount: number;
}

interface WorkspaceSidebarProps {
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  projectPath: string;
}

export const HistorySidebar = ({
  currentSessionId,
  onSelectSession,
  onNewSession,
  projectPath,
}: WorkspaceSidebarProps) => {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeCodeSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [_sessionNames, _setSessionNames] = useState<Record<string, string>>({});
  const [currentSessionName, setCurrentSessionName] = useState<string | null>(null);

  // Load git worktrees
  const loadWorktrees = useCallback(async () => {
    try {
      const trees = await invoke<GitWorktree[]>("list_worktrees", { path: projectPath });
      setWorktrees(trees);
    } catch (err) {
      console.error("Failed to load worktrees:", err);
    }
  }, [projectPath]);

  // Load git info
  const loadGitInfo = useCallback(async () => {
    try {
      const info = await invoke<GitInfo>("get_git_info", { path: projectPath });
      setGitInfo(info);
    } catch (err) {
      console.error("Failed to load git info:", err);
    }
  }, [projectPath]);

  // Load Claude Code sessions
  const loadClaudeSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const sessions = await invoke<ClaudeCodeSession[]>("list_claude_code_sessions", { projectPath });
      setClaudeSessions(sessions);
    } catch (err) {
      console.error("Failed to load Claude sessions:", err);
    } finally {
      setLoadingSessions(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadWorktrees();
    loadGitInfo();

    const interval = setInterval(() => {
      loadWorktrees();
      loadGitInfo();
    }, 5000);

    return () => clearInterval(interval);
  }, [loadWorktrees, loadGitInfo]);

  // Load sessions when history panel opens
  useEffect(() => {
    if (showHistory) {
      loadClaudeSessions();
    }
  }, [showHistory, loadClaudeSessions]);

  // Load current session name when session ID changes
  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSessionName(null);
      return;
    }

    const loadSessionName = async () => {
      try {
        const name = await invoke<string>("get_session_name", { sessionId: currentSessionId });
        setCurrentSessionName(name);
      } catch (err) {
        console.error("Failed to get session name:", err);
        setCurrentSessionName(getCityName(currentSessionId)); // Fallback to hash
      }
    };
    loadSessionName();
  }, [currentSessionId]);

  // Load all session names when history opens
  useEffect(() => {
    if (showHistory) {
      const loadNames = async () => {
        try {
          const names = await invoke<Record<string, string>>("get_session_names");
          _setSessionNames(names);
        } catch (err) {
          console.error("Failed to load session names:", err);
        }
      };
      loadNames();
    }
  }, [showHistory]);

  // Create worktree for current session
  const createSessionWorktree = async () => {
    if (!currentSessionId) return;

    setIsCreatingWorktree(true);
    try {
      await invoke("create_session_worktree", {
        path: projectPath,
        sessionId: currentSessionId,
      });
      await loadWorktrees();
    } catch (err) {
      console.error("Failed to create worktree:", err);
    } finally {
      setIsCreatingWorktree(false);
    }
  };

  // Get non-main worktrees for display
  const otherWorktrees = worktrees.filter(w => !w.isMain);

  // For current session, just show "Current" unless it has a worktree
  // City names are only for worktrees (branches)
  const hasWorktree = worktrees.some(w => w.sessionId === currentSessionId);
  const displayName = hasWorktree
    ? (currentSessionName || (currentSessionId ? getCityName(currentSessionId) : "main"))
    : "Current";

  return (
    <div className="flex flex-col h-full bg-surface-raised">
      {/* Project name header */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <span className="text-sm font-medium text-text-primary">sample-app</span>
      </div>

      {/* Workspaces */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {/* New workspace button */}
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-text-secondary hover:bg-hover hover:text-text-primary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>New workspace</span>
        </button>

        {/* Current workspace */}
        {currentSessionId && (
          <div className="px-2 py-2.5 rounded-md bg-surface-overlay border border-border-subtle">
            <div className="flex items-center gap-2">
              {/* Git branch icon */}
              <svg className="w-4 h-4 text-text-tertiary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm text-text-primary font-medium truncate flex-1">
                {displayName}
              </span>
              {gitInfo && gitInfo.isDirty && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-surface-sunken">
                  <span className="text-success">+{gitInfo.ahead || 0}</span>
                  {" "}
                  <span className="text-error">-{gitInfo.behind || 0}</span>
                </span>
              )}
            </div>
            <div className="mt-1 ml-6 flex items-center gap-2 text-xs text-text-tertiary">
              <span>{gitInfo?.branch || "main"}</span>
              <span>·</span>
              <span>now</span>
              <span className="ml-auto">⌘1</span>
            </div>
            {/* Create branch button */}
            <button
              onClick={createSessionWorktree}
              disabled={isCreatingWorktree}
              className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-surface-sunken hover:bg-hover text-text-tertiary hover:text-text-secondary text-xs transition-colors disabled:opacity-50"
            >
              {isCreatingWorktree ? (
                <span>Creating branch...</span>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Create branch</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Other worktrees */}
        {otherWorktrees.map((worktree, index) => {
          const cityName = getCityName(worktree.branch);
          const shortcutNum = index + 2;

          return (
            <button
              key={worktree.path}
              className="w-full px-2 py-2.5 rounded-md text-left transition-colors hover:bg-hover"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-text-tertiary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm text-text-primary font-medium truncate flex-1">
                  {cityName}
                </span>
              </div>
              <div className="mt-1 ml-6 flex items-center gap-2 text-xs text-text-tertiary">
                <span>{worktree.branch}</span>
                {shortcutNum <= 9 && (
                  <span className="ml-auto">⌘{shortcutNum}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="p-2 border-t border-border-subtle">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`w-full flex items-center gap-2 px-2 py-2 rounded-md transition-colors text-sm ${
            showHistory
              ? "bg-surface-overlay text-text-primary"
              : "text-text-tertiary hover:bg-hover hover:text-text-secondary"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>History</span>
        </button>
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="absolute bottom-14 left-2 right-2 bg-surface-overlay border border-border rounded-lg shadow-lg p-3 max-h-72 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">Session History</span>
            <button
              onClick={() => setShowHistory(false)}
              className="p-1 rounded hover:bg-hover text-text-tertiary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-text-tertiary mb-2">
            Sessions from Claude Code (~/.claude/projects/)
          </p>
          {loadingSessions ? (
            <div className="text-xs text-text-tertiary text-center py-4">
              Loading sessions...
            </div>
          ) : claudeSessions.length === 0 ? (
            <div className="text-xs text-text-tertiary text-center py-4 border border-dashed border-border-subtle rounded">
              No sessions found
            </div>
          ) : (
            <div className="space-y-1">
              {claudeSessions.map((session) => {
                // For session history, show first message preview or just session ID snippet
                const displayTitle = session.lastMessage
                  ? (session.lastMessage.length > 40
                    ? session.lastMessage.slice(0, 40) + "..."
                    : session.lastMessage)
                  : `Session ${session.id.slice(0, 8)}`;
                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      onSelectSession(session.id);
                      setShowHistory(false);
                    }}
                    className="w-full text-left px-2 py-2 rounded hover:bg-hover transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-text-tertiary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span className="text-sm text-text-secondary truncate flex-1">
                        {displayTitle}
                      </span>
                      <span className="text-xs text-text-tertiary shrink-0">
                        {formatTimeAgo(session.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1 ml-5.5 text-xs text-text-tertiary">
                      {session.messageCount} messages
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

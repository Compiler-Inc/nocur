import { useProject, ProjectInfo } from "@/lib/project-context";

// Format relative time (e.g., "2 hours ago", "yesterday")
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000; // timestamp is in seconds
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 7) {
    return new Date(timestamp * 1000).toLocaleDateString();
  }
  if (days > 1) return `${days} days ago`;
  if (days === 1) return "yesterday";
  if (hours > 1) return `${hours} hours ago`;
  if (hours === 1) return "1 hour ago";
  if (minutes > 1) return `${minutes} minutes ago`;
  if (minutes === 1) return "1 minute ago";
  return "just now";
}

// Get project type badge color
function getProjectTypeBadge(type: string): { label: string; className: string } {
  switch (type) {
    case "tuist":
      return { label: "Tuist", className: "bg-purple-500/20 text-purple-400" };
    case "xcode":
      return { label: "Xcode", className: "bg-blue-500/20 text-blue-400" };
    case "swiftpackage":
      return { label: "SPM", className: "bg-orange-500/20 text-orange-400" };
    default:
      return { label: "Unknown", className: "bg-text-tertiary/20 text-text-tertiary" };
  }
}

// Shorten path for display
function shortenPath(path: string): string {
  const home = "/Users/";
  if (path.startsWith(home)) {
    const afterHome = path.slice(home.length);
    const userEnd = afterHome.indexOf("/");
    if (userEnd > 0) {
      return "~" + afterHome.slice(userEnd);
    }
  }
  return path;
}

interface RecentProjectItemProps {
  project: ProjectInfo;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

const RecentProjectItem = ({ project, onOpen, onRemove }: RecentProjectItemProps) => {
  const badge = getProjectTypeBadge(project.projectType);
  
  return (
    <div
      className="group flex items-center justify-between p-3 rounded-lg hover:bg-surface-overlay cursor-pointer transition-colors"
      onClick={() => onOpen(project.path)}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center text-accent shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary truncate">{project.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-xs text-text-tertiary truncate">
            {shortenPath(project.path)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
          {formatRelativeTime(project.lastOpened)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(project.path);
          }}
          className="p-1 rounded hover:bg-error/20 text-text-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-all"
          title="Remove from recent"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export const WelcomeScreen = () => {
  const {
    recentProjects,
    openProject,
    openProjectDialog,
    removeFromRecent,
    setShowNewProjectModal,
  } = useProject();

  return (
    <div className="h-screen w-screen bg-surface-base flex flex-col items-center justify-center animate-fade-in pt-8">
      <div className="w-full max-w-md px-8">
        {/* Logo and Title */}
        <div className="text-center mb-10">
          <div className="text-6xl mb-4 text-accent">◎</div>
          <h1 className="text-4xl font-bold text-text-primary mb-3 tracking-tight">Nocur</h1>
          <p className="text-lg text-text-secondary font-medium">Make iOS apps faster than ever before</p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => setShowNewProjectModal(true)}
            className="flex-1 py-2.5 px-4 rounded-lg bg-accent hover:bg-accent-muted text-surface-base font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Project
          </button>
          <button
            onClick={openProjectDialog}
            className="flex-1 py-2.5 px-4 rounded-lg bg-surface-overlay hover:bg-hover text-text-primary font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Open Project
          </button>
        </div>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-text-secondary">Recent Projects</h2>
              <span className="text-xs text-text-tertiary">{recentProjects.length} projects</span>
            </div>
            <div className="bg-surface-raised rounded-lg border border-border divide-y divide-border overflow-hidden">
              {recentProjects.slice(0, 5).map((project) => (
                <RecentProjectItem
                  key={project.path}
                  project={project}
                  onOpen={openProject}
                  onRemove={removeFromRecent}
                />
              ))}
            </div>
            {recentProjects.length > 5 && (
              <button className="w-full mt-2 py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors">
                Show {recentProjects.length - 5} more...
              </button>
            )}
          </div>
        )}

        {/* Empty State */}
        {recentProjects.length === 0 && (
          <div className="text-center py-8 px-4 bg-surface-raised rounded-lg border border-border">
            <div className="text-3xl mb-2">📱</div>
            <p className="text-sm text-text-secondary mb-1">No recent projects</p>
            <p className="text-xs text-text-tertiary">Create a new project or open an existing one to get started</p>
          </div>
        )}

        {/* Keyboard Shortcuts Hint */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-4 text-xs text-text-tertiary">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay border border-border font-mono">⌘N</kbd>
              {" "}New
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay border border-border font-mono">⌘O</kbd>
              {" "}Open
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

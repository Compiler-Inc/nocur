import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

// =============================================================================
// Types
// =============================================================================

export type ProjectType = "tuist" | "xcode" | "swiftpackage" | "unknown";

export interface ProjectInfo {
  path: string;
  name: string;
  lastOpened: number; // Unix timestamp
  projectType: ProjectType;
}

export interface ProjectValidation {
  isValid: boolean;
  projectType: ProjectType;
  name: string;
  hasTuist: boolean;
  hasXcodeproj: boolean;
  hasPackageSwift: boolean;
  error: string | null;
}

export interface CreateProjectRequest {
  name: string;
  location: string;
}

interface ProjectContextValue {
  // Current project state
  currentProject: ProjectInfo | null;
  recentProjects: ProjectInfo[];
  isLoading: boolean;
  
  // Actions
  openProject: (path: string) => Promise<void>;
  openProjectDialog: () => Promise<void>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectInfo>;
  closeProject: () => void;
  removeFromRecent: (path: string) => Promise<void>;
  clearRecent: () => Promise<void>;
  validateProject: (path: string) => Promise<ProjectValidation>;
  
  // Modals
  showNewProjectModal: boolean;
  setShowNewProjectModal: (show: boolean) => void;
}

// =============================================================================
// Context
// =============================================================================

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}

// =============================================================================
// Provider
// =============================================================================

interface ProjectProviderProps {
  children: ReactNode;
}

export function ProjectProvider({ children }: ProjectProviderProps) {
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  // Load recent projects on mount
  useEffect(() => {
    const loadRecent = async () => {
      try {
        const projects = await invoke<ProjectInfo[]>("get_recent_projects");
        setRecentProjects(projects);
      } catch (err) {
        console.error("Failed to load recent projects:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadRecent();
  }, []);

  // Listen for menu events
  useEffect(() => {
    let unlistenMenu: UnlistenFn | undefined;
    let unlistenRecent: UnlistenFn | undefined;
    let unlistenRecentUpdated: UnlistenFn | undefined;

    const setup = async () => {
      // Handle menu events (New Project, Open Project)
      unlistenMenu = await listen<string>("menu-event", (event) => {
        if (event.payload === "new-project") {
          setShowNewProjectModal(true);
        } else if (event.payload === "open-project") {
          openProjectDialog();
        }
      });

      // Handle opening recent project from menu
      unlistenRecent = await listen<string>("open-recent-project", async (event) => {
        await openProject(event.payload);
      });

      // Handle recent projects updated (e.g., cleared from menu)
      unlistenRecentUpdated = await listen("recent-projects-updated", async () => {
        const projects = await invoke<ProjectInfo[]>("get_recent_projects");
        setRecentProjects(projects);
      });
    };

    setup();
    return () => {
      if (unlistenMenu) unlistenMenu();
      if (unlistenRecent) unlistenRecent();
      if (unlistenRecentUpdated) unlistenRecentUpdated();
    };
  }, []);

  // Update window title when project changes
  useEffect(() => {
    const updateTitle = async () => {
      const window = getCurrentWindow();
      if (currentProject) {
        await window.setTitle(`Nocur - ${currentProject.name}`);
      } else {
        await window.setTitle("Nocur");
      }
    };
    updateTitle();
  }, [currentProject]);

  // Open a project by path
  const openProject = useCallback(async (path: string) => {
    try {
      setIsLoading(true);
      
      // Validate and add to recent
      const projects = await invoke<ProjectInfo[]>("add_to_recent_projects", { path });
      setRecentProjects(projects);
      
      // Find the project info
      const projectInfo = projects.find(p => p.path === path);
      if (projectInfo) {
        setCurrentProject(projectInfo);
      }
    } catch (err) {
      console.error("Failed to open project:", err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Open folder dialog
  const openProjectDialog = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
      });

      if (selected && typeof selected === "string") {
        await openProject(selected);
      }
    } catch (err) {
      console.error("Failed to open project dialog:", err);
    }
  }, [openProject]);

  // Create a new project
  const createProject = useCallback(async (request: CreateProjectRequest): Promise<ProjectInfo> => {
    try {
      setIsLoading(true);
      const projectInfo = await invoke<ProjectInfo>("create_project", { request });
      
      // Refresh recent projects
      const projects = await invoke<ProjectInfo[]>("get_recent_projects");
      setRecentProjects(projects);
      
      // Set as current project
      setCurrentProject(projectInfo);
      
      return projectInfo;
    } catch (err) {
      console.error("Failed to create project:", err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Close current project
  const closeProject = useCallback(() => {
    setCurrentProject(null);
  }, []);

  // Remove from recent projects
  const removeFromRecent = useCallback(async (path: string) => {
    try {
      const projects = await invoke<ProjectInfo[]>("remove_from_recent_projects", { path });
      setRecentProjects(projects);
    } catch (err) {
      console.error("Failed to remove from recent:", err);
    }
  }, []);

  // Clear all recent projects
  const clearRecent = useCallback(async () => {
    try {
      await invoke("clear_all_recent_projects");
      setRecentProjects([]);
    } catch (err) {
      console.error("Failed to clear recent projects:", err);
    }
  }, []);

  // Validate a project path
  const validateProject = useCallback(async (path: string): Promise<ProjectValidation> => {
    return await invoke<ProjectValidation>("validate_project_path", { path });
  }, []);

  const value: ProjectContextValue = {
    currentProject,
    recentProjects,
    isLoading,
    openProject,
    openProjectDialog,
    createProject,
    closeProject,
    removeFromRecent,
    clearRecent,
    validateProject,
    showNewProjectModal,
    setShowNewProjectModal,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

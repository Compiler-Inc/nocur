import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProjectPane } from "@/components/panes/ProjectPane";
import { SimulatorPane } from "@/components/panes/SimulatorPane";
import { AgentPane } from "@/components/panes/AgentPane";
import { Onboarding } from "@/components/Onboarding";

// DEBUG: Set to true to always show onboarding
const DEBUG_SHOW_ONBOARDING = false;

interface ClaudeCodeStatus {
  installed: boolean;
  path: string | null;
  loggedIn: boolean;
  hasActivePlan: boolean;
  error: string | null;
}

// Resizable divider component
const ResizeHandle = ({
  onResize,
  direction,
}: {
  onResize: (delta: number) => void;
  direction: "left" | "right";
}) => {
  const handleRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onResize(direction === "left" ? delta : -delta);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onResize, direction]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className="w-1 bg-border hover:bg-border-strong cursor-col-resize transition-colors shrink-0 group"
    >
      <div className="w-full h-full group-hover:bg-accent/50" />
    </div>
  );
};

const App = () => {
  const [isReady, setIsReady] = useState<boolean | null>(DEBUG_SHOW_ONBOARDING ? false : null);
  const [showOnboarding, setShowOnboarding] = useState(true);

  // Pane widths (in pixels)
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(360);

  // Check Claude Code status on mount and periodically
  const checkStatus = useCallback(async () => {
    if (DEBUG_SHOW_ONBOARDING) return;

    try {
      const status = await invoke<ClaudeCodeStatus>("check_claude_code_status");
      const ready = status.installed && status.loggedIn && status.hasActivePlan;
      setIsReady(ready);

      if (!ready && !showOnboarding) {
        setShowOnboarding(true);
      }
    } catch (error) {
      console.error("Failed to check Claude Code status:", error);
      setIsReady(false);
    }
  }, [showOnboarding]);

  useEffect(() => {
    if (DEBUG_SHOW_ONBOARDING) return;
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setIsReady(true);
  };

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(180, Math.min(400, w + delta)));
  }, []);

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(280, Math.min(500, w + delta)));
  }, []);

  // Show loading
  if (isReady === null) {
    return (
      <div className="h-screen w-screen bg-surface-base flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 text-accent">◎</div>
          <p className="text-sm text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Show onboarding
  if (showOnboarding && !isReady) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen w-screen bg-surface-base text-text-primary animate-fade-in overflow-hidden">
      {/* Left Pane: Project */}
      <div
        style={{ width: leftWidth }}
        className="flex flex-col shrink-0 overflow-hidden bg-surface-raised"
      >
        <ProjectPane />
      </div>

      <ResizeHandle onResize={handleLeftResize} direction="left" />

      {/* Center Pane: Claude Agent (main focus) */}
      <div className="flex-1 min-w-[400px] flex flex-col overflow-hidden bg-surface-base">
        <AgentPane />
      </div>

      <ResizeHandle onResize={handleRightResize} direction="right" />

      {/* Right Pane: Simulator */}
      <div
        style={{ width: rightWidth }}
        className="flex flex-col shrink-0 overflow-hidden bg-surface-raised"
      >
        <SimulatorPane />
      </div>
    </div>
  );
};

export default App;

import { useEffect, useRef, useState, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SkillsModal } from "../SkillsModal";
import { ChatContextModal } from "../ChatContextModal";

interface ClaudeEvent {
  eventType: string;
  content: string;
  toolName: string | null;
  toolInput: string | null;
  toolId: string | null;
  isError: boolean;
  rawJson: string | null;
  skills?: string[];
  model?: string;
  sessionId?: string;
  // Token usage
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  // SDK-specific fields
  cost?: number;
  duration?: number;
  numTurns?: number;
  // Result subtype (e.g., "error_max_turns", "end_turn")
  resultSubtype?: string;
}

interface Message {
  id: string;
  type: "user" | "assistant" | "tool" | "error" | "system";
  content: string;
  toolName?: string;
  toolInput?: string;
  timestamp: Date;
  duration?: number;
  // Tools used during this response turn
  toolsUsed?: Array<{ name: string; input?: string; result?: string; toolId?: string }>;
  // Token usage for this message
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  // Whether this response was truncated due to max turns
  hitMaxTurns?: boolean;
  numTurns?: number;
  // Agent mode this message was sent/received in
  agentMode?: "build" | "plan";
}

interface PermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId?: string;
}

interface ClaudeSessionInfo {
  active: boolean;
  skills: string[];
  model: string | null;
}

interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

interface SavedSession {
  sessionId: string;
  model: string | null;
  createdAt: number;
  lastMessagePreview: string | null;
}

interface UserPreferences {
  model: string | null;
  skills: string[];
  skipPermissions: boolean;
  agentMode?: "build" | "plan";
}

interface SessionMessage {
  id: string;
  messageType: string;
  content: string;
  timestamp: number;
  toolsUsed?: Array<{ name: string; input?: string }>;
}

const PROJECT_DIR = "<REPO_ROOT>"; // TODO: Make dynamic

// Memoized ReactMarkdown components to avoid re-creating on every render
const MARKDOWN_COMPONENTS = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 bg-surface-overlay rounded text-accent-muted font-mono text-[13px]" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="block bg-surface-sunken rounded-lg p-3 font-mono text-[13px] text-text-secondary overflow-x-auto" {...props}>
        {children}
      </code>
    );
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <pre className="bg-surface-sunken rounded-lg overflow-hidden my-3">{children}</pre>;
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="text-[15px] leading-relaxed mb-3 last:mb-0">{children}</p>;
  },
  strong({ children }: { children?: React.ReactNode }) {
    return <strong className="font-semibold text-text-primary">{children}</strong>;
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>;
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>;
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="text-[15px] leading-relaxed">{children}</li>;
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1 className="text-lg font-semibold text-text-primary mt-4 mb-2">{children}</h1>;
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2 className="text-base font-semibold text-text-primary mt-3 mb-2">{children}</h2>;
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3 className="text-sm font-semibold text-text-primary mt-2 mb-1">{children}</h3>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return <blockquote className="border-l-2 border-border pl-3 my-2 text-text-secondary italic">{children}</blockquote>;
  },
};

// Slash commands available in the chat
interface SlashCommand {
  name: string;
  description: string;
  action: "insert" | "execute";
  value?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Clear chat history", action: "execute" },
  { name: "new", description: "Start a new session", action: "execute" },
  { name: "screenshot", description: "Take a simulator screenshot", action: "insert", value: "Take a screenshot of the simulator" },
  { name: "build", description: "Build the project", action: "insert", value: "Build the project" },
  { name: "run", description: "Run the app", action: "insert", value: "Run the app in the simulator" },
  { name: "hierarchy", description: "Get view hierarchy", action: "insert", value: "Get the current view hierarchy" },
  { name: "help", description: "Show available commands", action: "insert", value: "What commands and tools do you have available?" },
];

// Isolated input component to prevent re-renders of the entire message list
// This component manages its own input state to avoid re-rendering the parent on every keystroke
const ChatInput = memo(({
  onSubmit,
  onSlashCommand,
  onOpenContextReview,
  disabled,
  inputRef,
  projectPath
}: {
  onSubmit: (text: string) => void;
  onSlashCommand?: (command: string) => void;
  onOpenContextReview?: (text: string, fileRefs: { path: string; name: string }[]) => void;
  disabled: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  projectPath: string;
}) => {
  const [value, setValue] = useState("");
  const [hasContent, setHasContent] = useState(false);

  // Autocomplete state
  const [autocompleteType, setAutocompleteType] = useState<"file" | "command" | null>(null);
  const [autocompleteItems, setAutocompleteItems] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autocompletePosition, setAutocompletePosition] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Detect @ or / triggers and update autocomplete state
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setValue(newValue);
    setHasContent(newValue.trim().length > 0);

    // Check for / at start of input (slash commands)
    if (newValue.startsWith("/") && !newValue.includes(" ")) {
      const query = newValue.slice(1).toLowerCase();
      setAutocompleteType("command");
      setAutocompletePosition({ start: 0, end: newValue.length });
      setSelectedIndex(0);

      // Filter slash commands
      const filtered = SLASH_COMMANDS
        .filter(cmd => cmd.name.toLowerCase().includes(query))
        .map(cmd => cmd.name);
      setAutocompleteItems(filtered);
      return;
    }

    // Check for @ trigger (file references)
    // Find the last @ before cursor that isn't followed by a space before cursor
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
      const query = atMatch[1];
      const atStart = cursorPos - atMatch[0].length;
      setAutocompleteType("file");
      setAutocompletePosition({ start: atStart, end: cursorPos });
      setSelectedIndex(0);

      // Fetch file suggestions
      invoke<string[]>("list_project_files", {
        projectPath,
        query: query || null,
        limit: 10,
      }).then(files => {
        setAutocompleteItems(files);
      }).catch(err => {
        console.error("Failed to fetch files:", err);
        setAutocompleteItems([]);
      });
      return;
    }

    // No autocomplete trigger found
    setAutocompleteType(null);
    setAutocompleteItems([]);
  };

  // Handle keyboard navigation in autocomplete
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle autocomplete navigation
    if (autocompleteType && autocompleteItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, autocompleteItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        selectAutocompleteItem(autocompleteItems[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocompleteType(null);
        setAutocompleteItems([]);
        return;
      }
    }

    // Shift+Enter to open context review modal
    if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (value.trim() && !disabled && onOpenContextReview) {
        // Extract file references from the message
        const fileRefs = extractFileReferences(value);
        onOpenContextReview(value.trim(), fileRefs);
        setValue("");
        setHasContent(false);
        setAutocompleteType(null);
        setAutocompleteItems([]);
      }
      return;
    }

    // Normal enter to submit directly
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) {
        onSubmit(value.trim());
        setValue("");
        setHasContent(false);
        setAutocompleteType(null);
        setAutocompleteItems([]);
      }
    }
  };

  // Extract @filepath references from the message text
  const extractFileReferences = (text: string): { path: string; name: string }[] => {
    const refs: { path: string; name: string }[] = [];
    const regex = /@([^\s@]+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const path = match[1];
      const name = path.split("/").pop() || path;
      refs.push({ path, name });
    }
    return refs;
  };

  // Select an autocomplete item
  const selectAutocompleteItem = (item: string) => {
    if (autocompleteType === "command") {
      const cmd = SLASH_COMMANDS.find(c => c.name === item);
      if (cmd) {
        if (cmd.action === "execute") {
          onSlashCommand?.(cmd.name);
          setValue("");
          setHasContent(false);
        } else if (cmd.action === "insert" && cmd.value) {
          setValue(cmd.value);
          setHasContent(true);
        }
      }
    } else if (autocompleteType === "file") {
      // Replace @query with @filepath
      const before = value.slice(0, autocompletePosition.start);
      const after = value.slice(autocompletePosition.end);
      const newValue = `${before}@${item} ${after}`;
      setValue(newValue);
      setHasContent(newValue.trim().length > 0);

      // Move cursor to after the inserted file reference
      const newCursorPos = autocompletePosition.start + item.length + 2; // +2 for @ and space
      setTimeout(() => {
        inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
        inputRef.current?.focus();
      }, 0);
    }

    setAutocompleteType(null);
    setAutocompleteItems([]);
  };

  const handleSubmitClick = () => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
      setHasContent(false);
      setAutocompleteType(null);
      setAutocompleteItems([]);
    }
  };

  return (
    <div className="relative flex items-end gap-2">
      {/* Autocomplete dropdown */}
      {autocompleteType && autocompleteItems.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 right-12 mb-1 bg-surface-raised border border-border rounded-lg shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto"
        >
          <div className="px-2 py-1.5 text-[10px] text-text-tertiary uppercase tracking-wide border-b border-border-subtle">
            {autocompleteType === "file" ? "Files" : "Commands"}
          </div>
          {autocompleteItems.map((item, index) => {
            const isSelected = index === selectedIndex;
            const cmd = autocompleteType === "command" ? SLASH_COMMANDS.find(c => c.name === item) : null;

            return (
              <button
                key={item}
                onClick={() => selectAutocompleteItem(item)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                  isSelected ? "bg-accent/20 text-accent" : "text-text-primary hover:bg-hover"
                }`}
              >
                {autocompleteType === "file" ? (
                  <>
                    <svg className="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="truncate font-mono text-xs">{item}</span>
                  </>
                ) : (
                  <>
                    <span className="text-accent">/</span>
                    <span className="font-medium">{item}</span>
                    {cmd && <span className="text-text-tertiary text-xs ml-auto">{cmd.description}</span>}
                  </>
                )}
              </button>
            );
          })}
          <div className="px-3 py-1.5 text-[10px] text-text-tertiary border-t border-border-subtle">
            <span className="text-text-secondary">↑↓</span> navigate · <span className="text-text-secondary">Tab</span> select · <span className="text-text-secondary">Esc</span> close
          </div>
        </div>
      )}

      <textarea
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask Claude... (@ files, / commands, Shift+Enter to review context)"
        disabled={disabled}
        rows={1}
        className="flex-1 bg-transparent px-4 py-3 text-[15px] text-text-primary placeholder-text-tertiary focus:outline-none resize-none disabled:opacity-50"
        style={{ minHeight: "48px", maxHeight: "200px" }}
      />
      <button
        type="button"
        onClick={handleSubmitClick}
        disabled={!hasContent || disabled}
        className="p-2 mr-2 mb-2 rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary disabled:opacity-30 disabled:hover:bg-surface-overlay transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      </button>
    </div>
  );
});

// Animated counter hook for smooth number transitions
const useAnimatedCounter = (value: number, duration = 300) => {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (value === prevValueRef.current) return;

    const startValue = prevValueRef.current;
    const endValue = value;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + (endValue - startValue) * eased);

      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevValueRef.current = endValue;
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return displayValue;
};

// Format token count nicely (e.g., 1234 -> "1.2k")
const formatTokenCount = (count: number): string => {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
};

// Simple diff display component for Edit tool
const DiffDisplay = ({ oldString, newString }: { oldString: string; newString: string }) => {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");

  return (
    <div className="mt-2 rounded-lg overflow-hidden font-mono text-xs border border-border">
      {/* Removed lines */}
      <div className="bg-error/5 border-b border-border">
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} className="flex items-start">
            <span className="w-6 shrink-0 text-center text-error py-0.5 select-none">-</span>
            <code className="flex-1 px-2 py-0.5 text-error overflow-x-auto">{line || " "}</code>
          </div>
        ))}
      </div>
      {/* Added lines */}
      <div className="bg-success/5">
        {newLines.map((line, i) => (
          <div key={`new-${i}`} className="flex items-start">
            <span className="w-6 shrink-0 text-center text-success py-0.5 select-none">+</span>
            <code className="flex-1 px-2 py-0.5 text-success overflow-x-auto">{line || " "}</code>
          </div>
        ))}
      </div>
    </div>
  );
};

// Parse bash commands into human-friendly summaries
const parseBashCommand = (cmd: string): string => {
  // Strip leading cd commands and get the actual command
  const actualCmd = cmd.replace(/^cd\s+[^\s;]+\s*[;&]+\s*/, "").trim();

  // Extract the first word/binary - handle paths
  const parts = actualCmd.split(/\s+/);
  const firstPart = parts[0] || "";
  const binary = firstPart.split("/").pop() || firstPart;
  const args = parts.slice(1);

  // nocur-swift specific commands
  if (binary === "nocur-swift" || firstPart.includes("nocur-swift")) {
    const subCmd = args[0];
    const action = args[1];
    if (subCmd === "app") {
      if (action === "launch") return "Launching app";
      if (action === "kill") return "Killing app";
      if (action === "build") return "Building app";
      return `App ${action || "command"}`;
    }
    if (subCmd === "sim") {
      if (action === "screenshot") return "Taking screenshot";
      if (action === "boot") return "Booting simulator";
      if (action === "list") return "Listing simulators";
      return `Simulator ${action || "command"}`;
    }
    if (subCmd === "ui") {
      if (action === "tap") return "Tapping UI";
      if (action === "type") return "Typing text";
      if (action === "hierarchy") return "Getting view hierarchy";
      return `UI ${action || "interaction"}`;
    }
    return `nocur-swift ${subCmd || ""}`.trim();
  }

  // Git commands
  if (binary === "git") {
    const subCmd = args[0];
    if (subCmd === "status") return "Checking git status";
    if (subCmd === "add") return "Staging changes";
    if (subCmd === "commit") return "Committing changes";
    if (subCmd === "push") return "Pushing to remote";
    if (subCmd === "pull") return "Pulling from remote";
    if (subCmd === "clone") return "Cloning repository";
    if (subCmd === "checkout") return `Switching to ${args[1] || "branch"}`;
    if (subCmd === "branch") return "Managing branches";
    if (subCmd === "merge") return `Merging ${args[1] || "branch"}`;
    if (subCmd === "diff") return "Viewing diff";
    if (subCmd === "log") return "Viewing history";
    if (subCmd === "stash") return "Stashing changes";
    return `git ${subCmd || ""}`.trim();
  }

  // Package managers
  if (binary === "npm" || binary === "pnpm" || binary === "yarn") {
    const subCmd = args[0];
    if (subCmd === "install" || subCmd === "i") return "Installing dependencies";
    if (subCmd === "run") return `Running ${args[1] || "script"}`;
    if (subCmd === "build") return "Building project";
    if (subCmd === "test") return "Running tests";
    if (subCmd === "dev") return "Starting dev server";
    if (subCmd === "start") return "Starting app";
    return `${binary} ${subCmd || ""}`.trim();
  }

  // Cargo (Rust)
  if (binary === "cargo") {
    const subCmd = args[0];
    if (subCmd === "build") return "Building Rust project";
    if (subCmd === "run") return "Running Rust project";
    if (subCmd === "test") return "Running Rust tests";
    if (subCmd === "check") return "Checking Rust code";
    if (subCmd === "clippy") return "Running Clippy";
    return `cargo ${subCmd || ""}`.trim();
  }

  // Xcode tools
  if (binary === "xcodebuild") return "Building with Xcode";
  if (binary === "xcrun") {
    if (args[0] === "simctl") {
      const simAction = args[1];
      if (simAction === "boot") return "Booting simulator";
      if (simAction === "shutdown") return "Shutting down simulator";
      if (simAction === "list") return "Listing simulators";
      if (simAction === "install") return "Installing to simulator";
      if (simAction === "launch") return "Launching in simulator";
      return `simctl ${simAction || ""}`.trim();
    }
    return `xcrun ${args[0] || ""}`.trim();
  }

  // Common commands
  if (binary === "ls") return "Listing files";
  if (binary === "cat") return `Viewing ${args[0]?.split("/").pop() || "file"}`;
  if (binary === "mkdir") return `Creating ${args[0]?.split("/").pop() || "directory"}`;
  if (binary === "rm") return "Removing files";
  if (binary === "cp") return "Copying files";
  if (binary === "mv") return "Moving files";
  if (binary === "chmod") return "Changing permissions";
  if (binary === "curl") return "Making HTTP request";
  if (binary === "wget") return "Downloading file";
  if (binary === "python" || binary === "python3") return "Running Python";
  if (binary === "node") return "Running Node.js";
  if (binary === "swift") return "Running Swift";
  if (binary === "make") return "Running make";
  if (binary === "pkill" || binary === "kill") return "Killing process";

  // Fallback: just show the binary name nicely
  if (binary.length > 20) {
    return `Running ${binary.slice(0, 20)}...`;
  }
  return `Running ${binary}`;
};

// Normalize tool names (strip MCP prefix)
const normalizeToolName = (toolName: string): string => {
  // mcp__nocur-swift__sim_screenshot -> sim_screenshot
  if (toolName.startsWith("mcp__")) {
    return toolName.split("__").pop() || toolName;
  }
  return toolName;
};

// Format tool calls in a user-friendly way
const formatToolDisplay = (toolName: string, toolInput: string | undefined): {
  summary: string;
  detail?: string;
  todos?: Array<{ content: string; status: string }>;
  diff?: { oldString: string; newString: string };
} => {
  // Handle MCP tool names (e.g., mcp__nocur-swift__sim_screenshot -> sim_screenshot)
  const normalizedName = toolName.startsWith("mcp__")
    ? toolName.split("__").pop() || toolName
    : toolName;

  let parsed: Record<string, unknown> = {};
  if (toolInput) {
    try {
      parsed = JSON.parse(toolInput);
    } catch {
      // Ignore parse errors
    }
  }

  switch (normalizedName) {
    // nocur-swift tools
    case "sim_screenshot":
      return { summary: "Taking screenshot" };
    case "sim_list":
      return { summary: parsed.booted ? "Listing booted simulators" : "Listing simulators" };
    case "sim_boot":
      return { summary: `Booting ${parsed.name || "simulator"}` };
    case "ui_interact": {
      if (parsed.tapX !== undefined && parsed.tapY !== undefined) {
        return { summary: `Tapping at (${parsed.tapX}, ${parsed.tapY})` };
      }
      if (parsed.tapId) return { summary: `Tapping "${parsed.tapId}"` };
      if (parsed.tapLabel) return { summary: `Tapping "${parsed.tapLabel}"` };
      if (parsed.typeText) return { summary: `Typing "${String(parsed.typeText).slice(0, 20)}..."` };
      if (parsed.scroll) return { summary: `Scrolling ${parsed.scroll}` };
      return { summary: "Interacting with UI" };
    }
    case "ui_hierarchy":
      return { summary: "Getting view hierarchy" };
    case "ui_find": {
      if (parsed.text) return { summary: `Finding UI: "${parsed.text}"` };
      if (parsed.id) return { summary: `Finding UI by ID: "${parsed.id}"` };
      if (parsed.type) return { summary: `Finding UI by type: "${parsed.type}"` };
      return { summary: "Finding UI elements" };
    }
    case "app_build":
      return { summary: "Building Xcode project", detail: String(parsed.project || "") };
    case "app_launch":
      return { summary: `Launching ${parsed.bundleId || "app"}` };
    case "app_kill":
      return { summary: `Killing ${parsed.bundleId || "app"}` };

    // Standard Claude Code tools
    case "Read": {
      const path = String(parsed.file_path || "");
      const filename = path.split("/").pop() || path;
      return { summary: `Reading ${filename}`, detail: path };
    }
    case "Edit": {
      const path = String(parsed.file_path || "");
      const filename = path.split("/").pop() || path;
      const oldString = String(parsed.old_string || "");
      const newString = String(parsed.new_string || "");
      return {
        summary: `Editing ${filename}`,
        detail: path,
        diff: oldString || newString ? { oldString, newString } : undefined
      };
    }
    case "Write": {
      const path = String(parsed.file_path || "");
      const filename = path.split("/").pop() || path;
      return { summary: `Writing ${filename}`, detail: path };
    }
    case "Bash": {
      const cmd = String(parsed.command || "");
      const summary = parseBashCommand(cmd);
      return { summary, detail: cmd };
    }
    case "Glob": {
      return { summary: `Finding ${parsed.pattern || "files"}` };
    }
    case "Grep": {
      const pattern = String(parsed.pattern || "");
      return { summary: `Searching "${pattern.slice(0, 30)}${pattern.length > 30 ? "..." : ""}"` };
    }
    case "Task": {
      return { summary: String(parsed.description || "Running agent task") };
    }
    case "TodoWrite": {
      const todos = (parsed.todos as Array<{ content: string; status: string }>) || [];
      return {
        summary: `Updating ${todos.length} todo${todos.length !== 1 ? "s" : ""}`,
        todos: todos.map((t) => ({ content: t.content, status: t.status }))
      };
    }
    case "WebFetch": {
      const url = String(parsed.url || "");
      try {
        const hostname = new URL(url).hostname;
        return { summary: `Fetching ${hostname}`, detail: url };
      } catch {
        return { summary: "Fetching URL", detail: url };
      }
    }
    case "WebSearch": {
      const query = String(parsed.query || "");
      const truncatedQuery = query.length > 50 ? query.slice(0, 50) + "..." : query;
      return {
        summary: `Searching: "${truncatedQuery}"`,
        detail: query,
      };
    }
    default:
      // Try to make any remaining tool names more readable
      return { summary: normalizedName.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2") };
  }
};

type SessionStatus = "disconnected" | "connecting" | "connected" | "working" | "error" | "interrupted";

interface AgentPaneProps {
  onSessionChange?: (sessionId: string | null) => void;
  pendingSessionAction?: { type: "resume" | "new"; sessionId?: string } | null;
  onPendingSessionActionHandled?: () => void;
}

export const AgentPane = ({
  onSessionChange,
  pendingSessionAction,
  onPendingSessionActionHandled,
}: AgentPaneProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  // Note: input state moved to ChatInput component to prevent re-renders
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [workingTime, setWorkingTime] = useState(0);
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const [currentActivity, setCurrentActivity] = useState<{
    type: "thinking" | "tool";
    toolName?: string;
    toolInput?: string;
    progressStep?: number;
    progressTotal?: number;
    progressMessage?: string;
  } | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [_claudeModel, setClaudeModel] = useState<string | null>(null);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  // Context review modal state
  const [showContextModal, setShowContextModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");
  const [pendingFileRefs, setPendingFileRefs] = useState<{ path: string; name: string }[]>([]);
  // Model selection and resume state
  const [selectedModel, setSelectedModel] = useState<string>("sonnet");
  // Agent mode: build (normal) or plan (read-only analysis)
  const [agentMode, setAgentMode] = useState<"build" | "plan">("build");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showResumeMenu, setShowResumeMenu] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<{
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  }>({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  // Track current turn's content for showing on interruption
  const [currentTurnContent, setCurrentTurnContent] = useState<string>("");
  const [currentTurnTools, setCurrentTurnTools] = useState<Array<{
    name: string;
    input?: string;
    result?: string;
    toolId?: string;
  }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const workingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const responseStartTimeRef = useRef<number>(0);
  const skipPermissionsRef = useRef(skipPermissions);
  // Use ref for turn tools to avoid React batching issues with rapid events
  const currentTurnToolsRef = useRef<Array<{ name: string; input?: string; result?: string; toolId?: string }>>([]);
  // Track token usage with ref for reliable access in event handlers (avoids stale closures)
  const tokenUsageRef = useRef({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  // Track if initial mount setup has completed - prevents race conditions with skipPermissions effect
  const initialMountCompleteRef = useRef(false);

  // Animated token counter
  const animatedOutputTokens = useAnimatedCounter(tokenUsage.output);

  // Track if preferences have been loaded (to avoid saving defaults on mount)
  const prefsLoadedRef = useRef(false);

  // Load user preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<UserPreferences>("get_user_preferences");
        console.log("Loaded preferences:", prefs);
        if (prefs.model) {
          setSelectedModel(prefs.model);
        }
        if (prefs.skipPermissions !== undefined) {
          setSkipPermissions(prefs.skipPermissions);
        }
        if (prefs.agentMode) {
          setAgentMode(prefs.agentMode);
        }
        // Mark preferences as loaded after a short delay
        setTimeout(() => {
          prefsLoadedRef.current = true;
        }, 100);
      } catch (err) {
        console.error("Failed to load preferences:", err);
        prefsLoadedRef.current = true;
      }
    };
    loadPreferences();
  }, []);

  // Save preferences when they change (but not on initial load)
  useEffect(() => {
    if (!prefsLoadedRef.current) return;

    const savePreferences = async () => {
      try {
        await invoke("save_user_preferences", {
          preferences: {
            model: selectedModel,
            skills: availableSkills,
            skipPermissions: skipPermissions,
            agentMode: agentMode,
          }
        });
        console.log("Saved preferences");
      } catch (err) {
        console.error("Failed to save preferences:", err);
      }
    };
    savePreferences();
  }, [selectedModel, skipPermissions, availableSkills, agentMode]);

  // Keep skipPermissionsRef in sync with state AND update backend
  useEffect(() => {
    skipPermissionsRef.current = skipPermissions;

    // Only update backend setting, don't restart during initial mount
    // The session is started with the correct flag in the main setup effect
    if (!initialMountCompleteRef.current) {
      // During initial mount, just update the backend setting
      invoke("set_skip_permissions", { enabled: skipPermissions }).catch(console.error);
      return;
    }

    // If skipPermissions changed after mount AND no messages yet, restart with the flag
    // This is faster than using our permission server for auto-approve
    if (skipPermissions && messages.length === 0 && status === "connected") {
      const restartWithFlag = async () => {
        try {
          console.log("Restarting Claude with skipPermissions flag...");
          await invoke("stop_claude_session");
          await invoke("start_claude_session", {
            workingDir: PROJECT_DIR,
            skipPermissions: true
          });
          console.log("Restarted Claude with --dangerously-skip-permissions");
        } catch (err) {
          console.error("Failed to restart with skip permissions:", err);
        }
      };
      restartWithFlag();
    } else {
      // Otherwise just update the auto-approve flag for our permission server
      invoke("set_skip_permissions", { enabled: skipPermissions }).catch(console.error);
    }
  }, [skipPermissions, messages.length, status]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Notify parent of session changes
  useEffect(() => {
    onSessionChange?.(currentSessionId);
  }, [currentSessionId, onSessionChange]);

  // Handle pending session actions from sidebar
  useEffect(() => {
    if (!pendingSessionAction) return;

    const performAction = async () => {
      setStatus("connecting");
      setMessages([]);

      try {
        if (pendingSessionAction.type === "resume" && pendingSessionAction.sessionId) {
          // Load previous messages from the session file
          const sessionMessages = await invoke<SessionMessage[]>("load_session_messages", {
            projectPath: PROJECT_DIR,
            sessionId: pendingSessionAction.sessionId,
          });

          // Resume session
          const newSessionId = await invoke<string>("start_claude_session", {
            workingDir: PROJECT_DIR,
            skipPermissions: skipPermissionsRef.current,
            model: selectedModel,
            resumeSessionId: pendingSessionAction.sessionId,
          });
          setCurrentSessionId(newSessionId);
          setStatus("connected");

          // Set loaded messages (or show system message if none)
          if (sessionMessages.length > 0) {
            // Deduplicate by ID
            const seen = new Set<string>();
            const loadedMessages: Message[] = [];
            for (const msg of sessionMessages) {
              if (!seen.has(msg.id)) {
                seen.add(msg.id);
                loadedMessages.push({
                  id: msg.id,
                  type: msg.messageType as "user" | "assistant",
                  content: msg.content,
                  timestamp: new Date(),
                  toolsUsed: msg.toolsUsed,
                });
              }
            }
            setMessages(loadedMessages);
          } else {
            setMessages([{
              id: Date.now().toString(),
              type: "system",
              content: "Resumed previous session. Context has been restored.",
              timestamp: new Date(),
            }]);
          }
        } else if (pendingSessionAction.type === "new") {
          // New session
          if (currentSessionId) {
            await invoke("save_session_to_history", { lastMessage: messages[messages.length - 1]?.content || null });
          }
          const sessionId = await invoke<string>("start_claude_session", {
            workingDir: PROJECT_DIR,
            skipPermissions: skipPermissionsRef.current,
            model: selectedModel,
            resumeSessionId: null,
          });
          setCurrentSessionId(sessionId);
          setStatus("connected");
          // Refresh saved sessions
          const sessions = await invoke<SavedSession[]>("get_recent_sessions");
          setSavedSessions(sessions);
        }
      } catch (err) {
        setStatus("error");
        setError(String(err));
      }
    };

    performAction();
    onPendingSessionActionHandled?.();
  }, [pendingSessionAction]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.relative')) {
        setShowModelMenu(false);
        setShowResumeMenu(false);
      }
    };

    if (showModelMenu || showResumeMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showModelMenu, showResumeMenu]);

  // Working timer
  useEffect(() => {
    if (status === "working") {
      setWorkingTime(0);
      responseStartTimeRef.current = Date.now();
      workingTimerRef.current = setInterval(() => {
        setWorkingTime((t) => t + 0.1);
      }, 100);
    } else {
      if (workingTimerRef.current) {
        clearInterval(workingTimerRef.current);
        workingTimerRef.current = null;
      }
    }
    return () => {
      if (workingTimerRef.current) {
        clearInterval(workingTimerRef.current);
      }
    };
  }, [status]);

  // Initialize Claude session
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let unlistenPermission: UnlistenFn | undefined;
    let unlistenUserMessage: UnlistenFn | undefined;

    const setup = async () => {
      // Listen for permission requests
      // Note: Auto-approve is handled in the Rust backend now for reliability
      unlistenPermission = await listen<PermissionRequest>("permission-request", async (event) => {
        console.log("Permission request received:", event.payload);
        setPermissionRequest(event.payload);
      });

      // Listen for user messages sent from outside (e.g., simulator recording)
      unlistenUserMessage = await listen<{ content: string }>("user-message", (event) => {
        console.log("User message received:", event.payload.content.slice(0, 100));
        setMessages((prev) => {
          // Prevent duplicate user messages
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.type === "user" && lastMsg.content === event.payload.content) {
            console.log("Skipping duplicate user message from event");
            return prev;
          }
          return [
            ...prev,
            {
              id: Date.now().toString(),
              type: "user",
              content: event.payload.content,
              timestamp: new Date(),
            },
          ];
        });
      });

      unlisten = await listen<ClaudeEvent>("claude-event", (event) => {
        const { eventType, content, toolName, isError } = event.payload;

        // Debug: log ALL events
        console.log("📥 EVENT:", eventType, toolName ? `tool=${toolName}` : "", content?.slice(0, 50) || "");

        // Deduplicate result events - SDK may emit multiple "result" events with same content
        // Don't dedupe "assistant" events as those accumulate content for streaming
        // Only dedupe "result" events which finalize messages
        if (eventType === "result" && content) {
          const contentKey = `result-${content.slice(0, 100)}`;
          if (processedEventsRef.current.has(contentKey)) {
            return;
          }
          processedEventsRef.current.add(contentKey);
          setTimeout(() => processedEventsRef.current.delete(contentKey), 5000);
        }

        if (eventType === "message_sent") {
          setStatus("working");
          setToolCalls([]);
          setCurrentActivity({ type: "thinking" });
          setTokenUsage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
          tokenUsageRef.current = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }; // Reset ref too
          // Clear turn tracking for new turn
          setCurrentTurnContent("");
          setCurrentTurnTools([]);
          currentTurnToolsRef.current = []; // Clear ref as well
          return;
        }

        // Handle service_ready - SDK service has started
        if (eventType === "service_ready") {
          console.log("Claude SDK service is ready");
          return;
        }

        // Handle ready - SDK service initialized with working directory
        if (eventType === "ready") {
          const { model } = event.payload;
          console.log("Claude ready with model:", model);
          if (model) {
            setClaudeModel(model);
          }
          return;
        }

        // Handle system init - extract skills, model, and session ID
        if (eventType === "system_init") {
          const { skills, model, sessionId } = event.payload;
          console.log("Received system_init:", { skills, model, sessionId });
          if (skills && skills.length > 0) {
            setAvailableSkills(skills);
          }
          if (model) {
            setClaudeModel(model);
          }
          // IMPORTANT: The SDK generates its own session ID which is used for the .jsonl files
          // We must save THIS ID (not our Rust-generated one) so we can find the session files later
          if (sessionId) {
            setCurrentSessionId(sessionId);
            // Save the SDK's session ID as the active session for this project
            invoke("set_active_session", {
              projectPath: PROJECT_DIR,
              sessionId: sessionId,
            }).catch(console.error);
          }
          // Cache in Rust backend so it survives HMR
          invoke("set_claude_session_info", { skills: skills || [], model: model || null }).catch(console.error);
          return;
        }

        // Handle token usage updates - use Math.max to keep cumulative count (tokens only go up)
        if (eventType === "usage") {
          const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = event.payload;
          // Update both state and ref (ref for reliable access in event handlers)
          const newUsage = {
            input: Math.max(tokenUsageRef.current.input, inputTokens || 0),
            output: Math.max(tokenUsageRef.current.output, outputTokens || 0),
            cacheRead: Math.max(tokenUsageRef.current.cacheRead, cacheReadTokens || 0),
            cacheCreation: Math.max(tokenUsageRef.current.cacheCreation, cacheCreationTokens || 0),
          };
          tokenUsageRef.current = newUsage;
          setTokenUsage(newUsage);
          return;
        }

        // Also check for token usage in other event types (assistant, result)
        const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = event.payload;
        if (inputTokens || outputTokens) {
          const newUsage = {
            input: Math.max(tokenUsageRef.current.input, inputTokens || 0),
            output: Math.max(tokenUsageRef.current.output, outputTokens || 0),
            cacheRead: Math.max(tokenUsageRef.current.cacheRead, cacheReadTokens || 0),
            cacheCreation: Math.max(tokenUsageRef.current.cacheCreation, cacheCreationTokens || 0),
          };
          tokenUsageRef.current = newUsage;
          setTokenUsage(newUsage);
        }

        if (eventType === "result") {
          const duration = (Date.now() - responseStartTimeRef.current) / 1000;
          // Use ONLY the result content - this is the final response
          // Don't use accumulated assistant content (those are intermediate thoughts between tool calls)
          if (content) {
            // Capture tools from ref (not state) to avoid React batching issues
            const toolsUsed = currentTurnToolsRef.current.length > 0
              ? [...currentTurnToolsRef.current]
              : undefined;

            console.log("Result event - tools used:", toolsUsed?.length || 0, toolsUsed);

            // Capture token usage - use values from the result event if available, otherwise from accumulated ref
            const finalOutputTokens = event.payload.outputTokens || tokenUsageRef.current.output;
            const finalInputTokens = event.payload.inputTokens || tokenUsageRef.current.input;
            const finalCacheReadTokens = event.payload.cacheReadTokens || tokenUsageRef.current.cacheRead;
            const finalCacheCreationTokens = event.payload.cacheCreationTokens || tokenUsageRef.current.cacheCreation;

            // Check if agent hit max turns limit
            const { resultSubtype, numTurns } = event.payload;
            const hitMaxTurns = resultSubtype === "error_max_turns";
            if (hitMaxTurns) {
              console.log("Agent hit max turns limit:", numTurns);
            }

            setMessages((prev) => {
              // Prevent duplicate messages - check if last message has same content
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.type === "assistant" && lastMsg.content === content) {
                console.log("Skipping duplicate assistant message");
                return prev;
              }
              return [
                ...prev,
                {
                  id: Date.now().toString(),
                  type: "assistant",
                  content: content,
                  timestamp: new Date(),
                  duration,
                  toolsUsed,
                  outputTokens: finalOutputTokens,
                  inputTokens: finalInputTokens,
                  cacheReadTokens: finalCacheReadTokens,
                  cacheCreationTokens: finalCacheCreationTokens,
                  hitMaxTurns,
                  numTurns,
                },
              ];
            });
          }
          // Clear tools from both ref and state
          currentTurnToolsRef.current = [];
          setCurrentTurnTools([]);
          setCurrentTurnContent(""); // Clear accumulated content
          setToolCalls([]);
          setCurrentActivity(null);
          setStatus("connected");
          return;
        }

        if (eventType === "error" || isError) {
          if (content) {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                type: "error",
                content,
                timestamp: new Date(),
              },
            ]);
          }
          setCurrentActivity(null);
          setStatus("error");
          return;
        }

        // Handle tool_use events (SDK sends these separately)
        if (eventType === "tool_use") {
          const { toolInput, toolId } = event.payload;
          console.log("🔧 TOOL_USE event:", toolName, "id:", toolId, "ref count:", currentTurnToolsRef.current.length);
          if (toolName) {
            setCurrentActivity({
              type: "tool",
              toolName,
              toolInput: toolInput || undefined,
            });
            setToolCalls((prev) => {
              if (prev.includes(toolName)) return prev;
              return [...prev, toolName];
            });
            // Add to turn tools history - use BOTH ref and state
            // Ref is for reliable capture on result, state is for UI display
            const toolEntry = { name: toolName, input: toolInput || undefined, toolId: toolId || undefined };
            currentTurnToolsRef.current = [...currentTurnToolsRef.current, toolEntry];
            console.log("🔧 Added to ref, new count:", currentTurnToolsRef.current.length);
            setCurrentTurnTools((prev) => [...prev, toolEntry]);
          }
          return;
        }

        // Handle tool_result events (SDK sends these after tool execution)
        if (eventType === "tool_result") {
          const { toolId, result } = event.payload as { toolId?: string; result?: string };
          console.log("📋 Tool result received for:", toolId, "result length:", result?.length || 0);

          // Attach result to the matching tool in our ref
          if (toolId && result) {
            const toolIndex = currentTurnToolsRef.current.findIndex(t => t.toolId === toolId);
            if (toolIndex !== -1) {
              currentTurnToolsRef.current[toolIndex] = {
                ...currentTurnToolsRef.current[toolIndex],
                result,
              };
              // Also update state for UI
              setCurrentTurnTools([...currentTurnToolsRef.current]);
              console.log("📋 Attached result to tool at index:", toolIndex);
            }
          }
          return;
        }

        // Handle tool_progress events (shows step progress for multi-step tools like app_context)
        if (eventType === "tool_progress") {
          const { progressStep, progressTotal, progressMessage } = event.payload as {
            progressStep?: number;
            progressTotal?: number;
            progressMessage?: string;
          };
          console.log("📊 Tool progress:", progressStep, "/", progressTotal, progressMessage);

          // Update current activity with progress info
          setCurrentActivity(prev => {
            if (!prev || prev.type !== "tool") return prev;
            return {
              ...prev,
              progressStep,
              progressTotal,
              progressMessage,
            };
          });
          return;
        }

        // Track tool calls and current activity
        if (eventType === "assistant") {
          const { toolInput } = event.payload;

          if (toolName) {
            // This is a tool call (legacy format - keep for backwards compatibility)
            setCurrentActivity({
              type: "tool",
              toolName,
              toolInput: toolInput || undefined,
            });
            setToolCalls((prev) => {
              if (prev.includes(toolName)) return prev;
              return [...prev, toolName];
            });
            // Add to turn tools history - use BOTH ref and state
            const toolEntry = { name: toolName, input: toolInput || undefined };
            currentTurnToolsRef.current = [...currentTurnToolsRef.current, toolEntry];
            setCurrentTurnTools((prev) => [...prev, toolEntry]);
          } else if (content) {
            // Accumulate text content for display during interruption
            // (not used for final message - result event has the complete response)
            setCurrentTurnContent((prev) => prev + content);
          }
        }
      });

      setStatus("connecting");
      try {
        // Load available models
        const models = await invoke<ModelInfo[]>("get_available_models");
        setAvailableModels(models);

        // Load saved sessions for resume functionality
        const sessions = await invoke<SavedSession[]>("get_recent_sessions");
        setSavedSessions(sessions);

        // Check for active session to resume
        const activeSessionId = await invoke<string | null>("get_active_session", {
          projectPath: PROJECT_DIR,
        });

        // If resuming, set the session ID immediately so it's not overwritten by system_init
        if (activeSessionId) {
          setCurrentSessionId(activeSessionId);

          // Load previous messages from the session file
          try {
            const sessionMessages = await invoke<SessionMessage[]>("load_session_messages", {
              projectPath: PROJECT_DIR,
              sessionId: activeSessionId,
            });

            if (sessionMessages.length > 0) {
              // Convert session messages to our Message format, deduplicating by ID
              const seen = new Set<string>();
              const loadedMessages: Message[] = [];
              for (const msg of sessionMessages) {
                if (!seen.has(msg.id)) {
                  seen.add(msg.id);
                  loadedMessages.push({
                    id: msg.id,
                    type: msg.messageType as "user" | "assistant",
                    content: msg.content,
                    timestamp: new Date(),
                    toolsUsed: msg.toolsUsed,
                  });
                }
              }
              setMessages(loadedMessages);
              console.log(`Loaded ${loadedMessages.length} messages from session`);
            }
          } catch (err) {
            console.error("Failed to load session messages:", err);
          }
        }

        // Start Claude session with selected model, resuming if we have an active session
        // Note: The actual session ID from the SDK will be received via system_init event
        // and saved there. The Rust-generated ID is just internal.
        await invoke<string>("start_claude_session", {
          workingDir: PROJECT_DIR,
          skipPermissions: false,
          model: selectedModel,
          resumeSessionId: activeSessionId,
        });

        setStatus("connected");
        // Mark initial mount as complete - skipPermissions effect will now behave normally
        initialMountCompleteRef.current = true;
        console.log("Initial mount complete, session connected");

        // Restore cached session info (survives HMR)
        try {
          const sessionInfo = await invoke<ClaudeSessionInfo>("get_claude_session_info");
          if (sessionInfo.skills && sessionInfo.skills.length > 0) {
            setAvailableSkills(sessionInfo.skills);
          }
          if (sessionInfo.model) {
            setClaudeModel(sessionInfo.model);
          }
        } catch (e) {
          console.error("Failed to restore session info:", e);
        }
      } catch (err) {
        setStatus("error");
        setError(String(err));
      }
    };

    setup();

    return () => {
      if (unlisten) unlisten();
      if (unlistenPermission) unlistenPermission();
      if (unlistenUserMessage) unlistenUserMessage();
      invoke("stop_claude_session").catch(console.error);
    };
  }, []); // Only run once on mount - skipPermissions is handled via ref

  // Handle permission response
  const handlePermissionResponse = async (approved: boolean, allowAlways = false) => {
    if (!permissionRequest) return;

    try {
      // If "Allow Always", add to settings first
      if (approved && allowAlways) {
        await invoke("add_permission_rule", {
          toolName: permissionRequest.toolName,
          toolInput: permissionRequest.toolInput,
          workingDir: PROJECT_DIR,
        });
      }

      await invoke("respond_to_permission", {
        requestId: permissionRequest.id,
        approved,
        reason: allowAlways ? "Always allowed by user" : (approved ? "Approved by user" : "Denied by user"),
      });
    } catch (err) {
      console.error("Failed to respond to permission:", err);
    }

    setPermissionRequest(null);
  };

  // Called by ChatInput component when user submits
  const handleInputSubmit = async (userMessage: string) => {
    if (!userMessage || status === "working") return;

    console.log("📤 handleInputSubmit called with:", userMessage.slice(0, 50));

    setMessages((prev) => {
      // Prevent duplicate user messages (can happen with React StrictMode or rapid submits)
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.type === "user" && lastMsg.content === userMessage) {
        console.log("Skipping duplicate user message");
        return prev;
      }
      return [
        ...prev,
        {
          id: Date.now().toString(),
          type: "user",
          content: userMessage,
          timestamp: new Date(),
        },
      ];
    });

    // Set working status IMMEDIATELY so user sees feedback
    // The message_sent event will also set it, but this ensures immediate feedback
    setStatus("working");
    setToolCalls([]);
    setCurrentActivity({ type: "thinking" });

    try {
      console.log("📤 Calling send_claude_message...");
      await invoke("send_claude_message", { message: userMessage, agentMode: agentMode });
      console.log("📤 send_claude_message returned successfully");
    } catch (err) {
      console.error("📤 send_claude_message FAILED:", err);
      setStatus("error");
      setError(String(err));
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "error",
          content: String(err),
          timestamp: new Date(),
        },
      ]);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Change model and restart session while preserving conversation
  const handleModelChange = async (modelId: string) => {
    setSelectedModel(modelId);
    setShowModelMenu(false);

    // Restart session with new model, keeping the same session to preserve conversation
    setStatus("connecting");
    try {
      const sessionId = await invoke<string>("start_claude_session", {
        workingDir: PROJECT_DIR,
        skipPermissions: skipPermissions,
        model: modelId,
        resumeSessionId: currentSessionId, // Resume same session with new model
      });
      setCurrentSessionId(sessionId);
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  };

  // Resume a previous session
  const handleResumeSession = async (sessionId: string) => {
    setShowResumeMenu(false);
    setStatus("connecting");
    setMessages([]); // Clear messages first

    try {
      // Load previous messages from the session file
      const sessionMessages = await invoke<SessionMessage[]>("load_session_messages", {
        projectPath: PROJECT_DIR,
        sessionId: sessionId,
      });

      const newSessionId = await invoke<string>("start_claude_session", {
        workingDir: PROJECT_DIR,
        skipPermissions: skipPermissions,
        model: selectedModel,
        resumeSessionId: sessionId,
      });
      setCurrentSessionId(newSessionId);
      setStatus("connected");

      // Set loaded messages (or show system message if none)
      if (sessionMessages.length > 0) {
        // Deduplicate by ID
        const seen = new Set<string>();
        const loadedMessages: Message[] = [];
        for (const msg of sessionMessages) {
          if (!seen.has(msg.id)) {
            seen.add(msg.id);
            loadedMessages.push({
              id: msg.id,
              type: msg.messageType as "user" | "assistant",
              content: msg.content,
              timestamp: new Date(),
              toolsUsed: msg.toolsUsed,
            });
          }
        }
        setMessages(loadedMessages);
        console.log(`Loaded ${loadedMessages.length} messages from resumed session`);
      } else {
        setMessages([{
          id: Date.now().toString(),
          type: "system",
          content: "Resumed previous session. Context has been restored.",
          timestamp: new Date(),
        }]);
      }
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  };

  // Start a new session (clear and restart)
  const handleNewSession = async () => {
    setShowResumeMenu(false);
    setStatus("connecting");
    setMessages([]);

    try {
      // Save current session first
      if (currentSessionId) {
        await invoke("save_session_to_history", { lastMessage: messages[messages.length - 1]?.content || null });
      }

      const sessionId = await invoke<string>("start_claude_session", {
        workingDir: PROJECT_DIR,
        skipPermissions: skipPermissions,
        model: selectedModel,
        resumeSessionId: null,
      });
      setCurrentSessionId(sessionId);
      setStatus("connected");

      // Refresh saved sessions
      const sessions = await invoke<SavedSession[]>("get_recent_sessions");
      setSavedSessions(sessions);
    } catch (err) {
      setStatus("error");
      setError(String(err));
    }
  };

  // Format timestamp for display
  const formatSessionTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Messages area */}
      <div className="flex-1 overflow-auto">
        <div className="w-full px-6 py-4 space-y-4">
          {messages.length === 0 && status === "connected" && (
            <div className="text-center py-12">
              <p className="text-text-secondary text-sm">
                Ask me anything about your project.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.type === "user" && (
                <div className="flex justify-end">
                  <div className="bg-surface-overlay rounded-2xl px-4 py-2.5 max-w-[85%]">
                    {msg.agentMode && (
                      <div className={`text-[10px] mb-1 font-medium ${
                        msg.agentMode === "plan" ? "text-violet-400" : "text-accent"
                      }`}>
                        {msg.agentMode === "plan" ? "▣ Plan" : "▣ Build"}
                      </div>
                    )}
                    <p className="text-text-primary text-[15px] leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              )}

              {msg.type === "assistant" && (
                <div className="space-y-2">
                  {/* Max turns warning banner */}
                  {msg.hitMaxTurns && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/30 rounded-lg text-warning text-sm">
                      <span className="text-lg">⚠</span>
                      <div>
                        <span className="font-medium">Agent stopped early</span>
                        <span className="text-warning/70 ml-1">
                          ({msg.numTurns} turns) — Task may be incomplete. Send another message to continue.
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="prose prose-invert prose-sm max-w-none text-text-primary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={MARKDOWN_COMPONENTS}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  {(msg.duration || msg.outputTokens) && (
                    <div className="flex items-center gap-2 text-text-tertiary text-xs">
                      {msg.duration && <span>{msg.duration.toFixed(1)}s</span>}
                      {msg.outputTokens && msg.outputTokens > 0 && (
                        <>
                          {msg.duration && <span>·</span>}
                          <span className="tabular-nums">↓ {formatTokenCount(msg.outputTokens)}</span>
                        </>
                      )}
                      {msg.inputTokens && msg.inputTokens > 0 && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">↑ {formatTokenCount(msg.inputTokens)}</span>
                        </>
                      )}
                      {msg.cacheReadTokens && msg.cacheReadTokens > 0 && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums text-success">⚡ {formatTokenCount(msg.cacheReadTokens)}</span>
                        </>
                      )}
                      <button
                        onClick={() => copyToClipboard(msg.content)}
                        className="hover:text-text-secondary transition-colors"
                        title="Copy response"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {/* Tool use summary - expanded by default for visibility */}
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <details className="mt-2 group" open={msg.toolsUsed.length <= 10}>
                      <summary className="text-xs text-text-tertiary cursor-pointer hover:text-text-secondary select-none flex items-center gap-1.5">
                        <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span>{msg.toolsUsed.length} tool{msg.toolsUsed.length > 1 ? "s" : ""} used</span>
                      </summary>
                      <div className="mt-2 pl-4 space-y-1.5 font-mono text-xs border-l border-border-subtle">
                        {msg.toolsUsed.map((tool, i) => {
                          const { summary, detail, diff } = formatToolDisplay(tool.name, tool.input);
                          const normalizedName = tool.name.startsWith("mcp__")
                            ? tool.name.split("__").pop() || tool.name
                            : tool.name;
                          const hasResult = tool.result && tool.result.length > 0;
                          const isSearchTool = normalizedName === "WebSearch" || normalizedName === "WebFetch";

                          return (
                            <div key={i} className="space-y-1">
                              <div className="flex items-start gap-2">
                                <span className="text-success">✓</span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-text-secondary">{summary}</span>
                                  {detail && (
                                    <div className="text-text-tertiary truncate" title={detail}>
                                      {detail}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {diff && <DiffDisplay oldString={diff.oldString} newString={diff.newString} />}
                              {/* Show result for search tools and other tools with results */}
                              {hasResult && isSearchTool && (
                                <details className="ml-4 mt-1 group/result">
                                  <summary className="text-[10px] text-text-tertiary cursor-pointer hover:text-text-secondary select-none flex items-center gap-1">
                                    <svg className="w-2.5 h-2.5 transition-transform group-open/result:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span>View result ({tool.result!.length > 1000 ? `${(tool.result!.length / 1000).toFixed(1)}KB` : `${tool.result!.length} chars`})</span>
                                  </summary>
                                  <pre className="mt-1 p-2 bg-surface-sunken rounded text-[10px] text-text-tertiary overflow-auto max-h-40 whitespace-pre-wrap">
                                    {tool.result!.slice(0, 2000)}{tool.result!.length > 2000 ? "\n... (truncated)" : ""}
                                  </pre>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {msg.type === "error" && (
                <div className="text-error text-[15px] leading-relaxed">
                  {msg.content}
                </div>
              )}

              {msg.type === "system" && (
                <div className="flex items-center gap-2 text-text-tertiary text-sm">
                  <span className="text-accent">→</span>
                  <span>{msg.content}</span>
                </div>
              )}
            </div>
          ))}

          {/* Working indicator - terminal style */}
          {status === "working" && (
            <div className="space-y-3 font-mono text-sm">
              {/* Current activity header */}
              <div className="flex items-center gap-2">
                <span className="text-accent animate-pulse">▸</span>
                <span className="text-text-secondary">
                  Working... {workingTime.toFixed(0)}s
                  {toolCalls.length > 0 && (
                    <span className="ml-2 tabular-nums text-text-tertiary">
                      · {toolCalls.length} turns
                    </span>
                  )}
                  {animatedOutputTokens > 0 && (
                    <span className="ml-2 text-text-tertiary tabular-nums">
                      · ↓ {formatTokenCount(animatedOutputTokens)} tokens
                    </span>
                  )}
                </span>
              </div>

              {/* Tool call display */}
              {currentActivity?.type === "tool" && currentActivity.toolName && (
                <div className="bg-surface-sunken rounded-lg p-3 border border-border-subtle">
                  {(() => {
                    const { summary, detail, todos, diff } = formatToolDisplay(currentActivity.toolName, currentActivity.toolInput);
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-success">●</span>
                          <span className="text-text-primary font-medium">{summary}</span>
                        </div>
                        {detail && (
                          <div className="mt-1.5 pl-4">
                            <span className="text-xs text-text-tertiary font-mono truncate block" title={detail}>
                              {detail}
                            </span>
                          </div>
                        )}
                        {/* Show progress for multi-step tools like app_context */}
                        {currentActivity.progressMessage && (
                          <div className="mt-2 pl-4 flex items-center gap-2">
                            <div className="flex-1 h-1 bg-surface-overlay rounded-full overflow-hidden">
                              <div
                                className="h-full bg-accent transition-all duration-300"
                                style={{
                                  width: currentActivity.progressTotal
                                    ? `${(currentActivity.progressStep || 0) / currentActivity.progressTotal * 100}%`
                                    : '0%'
                                }}
                              />
                            </div>
                            <span className="text-xs text-text-tertiary whitespace-nowrap">
                              {currentActivity.progressStep}/{currentActivity.progressTotal} {currentActivity.progressMessage}
                            </span>
                          </div>
                        )}
                        {/* Show diff if this is an Edit */}
                        {diff && <DiffDisplay oldString={diff.oldString} newString={diff.newString} />}
                        {/* Show todos if this is a TodoWrite */}
                        {todos && todos.length > 0 && (
                          <div className="mt-2 pl-4 space-y-1">
                            {todos.map((todo, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className={
                                  todo.status === "completed" ? "text-success" :
                                  todo.status === "in_progress" ? "text-accent" :
                                  "text-text-tertiary"
                                }>
                                  {todo.status === "completed" ? "✓" :
                                   todo.status === "in_progress" ? "●" : "○"}
                                </span>
                                <span className={
                                  todo.status === "completed" ? "text-text-tertiary line-through" :
                                  todo.status === "in_progress" ? "text-text-primary" :
                                  "text-text-secondary"
                                }>
                                  {todo.content}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Thinking indicator */}
              {currentActivity?.type === "thinking" && !currentTurnContent && (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <span className="animate-pulse">∴</span>
                  <span>Thinking...</span>
                </div>
              )}

              {/* Show most recent thought (last sentence/chunk, not entire history) */}
              {currentTurnContent && (() => {
                // Get just the last meaningful chunk - find last sentence or take last 150 chars
                const trimmed = currentTurnContent.trim();
                const sentences = trimmed.split(/(?<=[.!?])\s+/);
                const lastSentence = sentences[sentences.length - 1] || "";
                const display = lastSentence.length > 150
                  ? "..." + lastSentence.slice(-150)
                  : lastSentence;

                return (
                  <div className="flex items-start gap-2 text-text-tertiary text-sm italic">
                    <span className="text-text-tertiary/50">💭</span>
                    <span className="line-clamp-2">{display}</span>
                  </div>
                );
              })()}

              {/* Tool call history */}
              {toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {toolCalls.map((tool, i) => {
                    const displayName = normalizeToolName(tool);
                    return (
                      <span
                        key={i}
                        className={`px-2 py-0.5 rounded text-xs ${
                          tool === currentActivity?.toolName
                            ? "bg-success/20 text-success"
                            : "bg-surface-overlay text-text-tertiary"
                        }`}
                      >
                        {displayName}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Interrupted indicator - shows full reasoning trace */}
          {status === "interrupted" && (
            <div className="space-y-3">
              {/* Show accumulated text content if any */}
              {currentTurnContent && (
                <div className="prose prose-invert prose-sm max-w-none text-text-primary">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }) {
                        const isInline = !className;
                        if (isInline) {
                          return (
                            <code className="px-1.5 py-0.5 bg-surface-overlay rounded text-accent-muted font-mono text-[13px]" {...props}>
                              {children}
                            </code>
                          );
                        }
                        return (
                          <code className="block bg-surface-sunken rounded-lg p-3 font-mono text-[13px] text-text-secondary overflow-x-auto" {...props}>
                            {children}
                          </code>
                        );
                      },
                      pre({ children }) {
                        return <pre className="bg-surface-sunken rounded-lg overflow-hidden my-3">{children}</pre>;
                      },
                      p({ children }) {
                        return <p className="text-[15px] leading-relaxed mb-3 last:mb-0">{children}</p>;
                      },
                    }}
                  >
                    {currentTurnContent}
                  </ReactMarkdown>
                </div>
              )}

              {/* Show tool calls history */}
              {currentTurnTools.length > 0 && (
                <div className="space-y-2 font-mono text-sm">
                  {currentTurnTools.map((tool, i) => {
                    const { summary, detail, diff } = formatToolDisplay(tool.name, tool.input);
                    const isLast = i === currentTurnTools.length - 1;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-start gap-2">
                          <span className={isLast ? "text-warning" : "text-success"}>
                            {isLast ? "●" : "✓"}
                          </span>
                          <div className="flex-1">
                            <span className={isLast ? "text-text-primary" : "text-text-secondary"}>
                              {summary}
                            </span>
                            {detail && (
                              <div className="text-xs text-text-tertiary truncate" title={detail}>
                                {detail}
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Show diff for Edit tools */}
                        {diff && <DiffDisplay oldString={diff.oldString} newString={diff.newString} />}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Interrupted message */}
              <div className="flex items-center gap-2 font-mono text-sm">
                <span className="text-text-tertiary">└</span>
                <span className="text-error">Interrupted</span>
                <span className="text-text-tertiary">·</span>
                <span className="text-text-secondary">What should Claude do instead?</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border-subtle bg-surface-base">
        <div className="w-full px-6 py-3">
          <div className={`bg-surface-raised border rounded-xl transition-colors ${
              agentMode === "plan" 
                ? "border-violet-500/50 ring-1 ring-violet-500/20" 
                : "border-border"
            }`}>
            <ChatInput
              onSubmit={handleInputSubmit}
              onSlashCommand={(cmd) => {
                if (cmd === "clear") {
                  setMessages([]);
                } else if (cmd === "new") {
                  handleNewSession();
                }
              }}
              onOpenContextReview={(message, fileRefs) => {
                setPendingMessage(message);
                setPendingFileRefs(fileRefs);
                setShowContextModal(true);
              }}
              disabled={status === "working" || status === "connecting"}
              inputRef={inputRef}
              projectPath={PROJECT_DIR}
            />
            <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  {/* Model selector dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowModelMenu(!showModelMenu);
                        setShowResumeMenu(false);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary text-xs transition-colors"
                      title="Click to change model"
                    >
                      <span className="text-accent">✳</span>
                      <span className="capitalize">{selectedModel}</span>
                      <svg className="w-3 h-3 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showModelMenu && (
                      <div className="absolute bottom-full left-0 mb-1 bg-surface-raised border border-border rounded-lg shadow-xl py-1 min-w-[180px] z-50">
                        {availableModels.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => handleModelChange(model.id)}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-hover transition-colors ${
                              selectedModel === model.id ? "text-accent" : "text-text-primary"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {selectedModel === model.id && <span>✓</span>}
                              <div className={selectedModel === model.id ? "" : "ml-4"}>
                                <div className="font-medium">{model.name}</div>
                                <div className="text-text-tertiary text-[10px]">{model.description}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Agent Mode Toggle (Build/Plan) */}
                  <div className="flex items-center rounded-lg bg-surface-overlay p-0.5">
                    <button
                      type="button"
                      onClick={() => setAgentMode("build")}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        agentMode === "build"
                          ? "bg-accent text-surface-base font-medium shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                      title="Build mode - Full capabilities"
                    >
                      Build
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgentMode("plan")}
                      className={`px-2 py-1 text-xs rounded-md transition-all ${
                        agentMode === "plan"
                          ? "bg-violet-500 text-white font-medium shadow-sm"
                          : "text-text-tertiary hover:text-text-secondary"
                      }`}
                      title="Plan mode - Read-only analysis"
                    >
                      Plan
                    </button>
                  </div>

                  {/* Resume/New Session button */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowResumeMenu(!showResumeMenu);
                        setShowModelMenu(false);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary text-xs transition-colors"
                      title="New session or resume previous"
                    >
                      <span>↻</span>
                      <span>Session</span>
                    </button>
                    {showResumeMenu && (
                      <div className="absolute bottom-full left-0 mb-1 bg-surface-raised border border-border rounded-lg shadow-xl py-1 min-w-[220px] z-50">
                        <button
                          onClick={handleNewSession}
                          className="w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-hover transition-colors border-b border-border-subtle"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-success">+</span>
                            <span className="font-medium">New Session</span>
                          </div>
                        </button>
                        {savedSessions.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 text-[10px] text-text-tertiary uppercase tracking-wide">
                              Resume Previous
                            </div>
                            {savedSessions.slice(0, 5).map((session) => (
                              <button
                                key={session.sessionId}
                                onClick={() => handleResumeSession(session.sessionId)}
                                className="w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-hover transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="truncate text-text-secondary">
                                      {session.lastMessagePreview || "No preview"}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
                                      <span>{formatSessionTime(session.createdAt)}</span>
                                      {session.model && <span>• {session.model}</span>}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </>
                        )}
                        {savedSessions.length === 0 && (
                          <div className="px-3 py-2 text-xs text-text-tertiary">
                            No previous sessions
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Skills indicator button */}
                  <button
                    type="button"
                    onClick={() => setShowSkillsModal(true)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                      availableSkills.length > 0
                        ? "bg-accent/10 text-accent hover:bg-accent/20"
                        : "bg-surface-overlay text-text-tertiary hover:bg-hover"
                    }`}
                  >
                    <span>⚙</span>
                    <span>
                      {availableSkills.length > 0
                        ? `${availableSkills.length} skill${availableSkills.length > 1 ? "s" : ""}`
                        : "Skills"}
                    </span>
                  </button>
                  {/* Permissions toggle */}
                  <button
                    type="button"
                    onClick={() => setSkipPermissions(!skipPermissions)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                      skipPermissions
                        ? "bg-warning/20 text-warning hover:bg-warning/30"
                        : "bg-surface-overlay text-text-tertiary hover:bg-hover"
                    }`}
                    title={skipPermissions ? "Click to enable permission prompts" : "Click to skip all permission prompts (dangerous)"}
                  >
                    <span>{skipPermissions ? "⚡" : "🔒"}</span>
                    <span>{skipPermissions ? "Skip Perms" : "Safe Mode"}</span>
                  </button>
                  {/* Context button - opens modal to add screenshot */}
                  <button
                    type="button"
                    onClick={() => {
                      setPendingMessage("");
                      setPendingFileRefs([]);
                      setShowContextModal(true);
                    }}
                    disabled={status === "working" || status === "connecting"}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50"
                    title="Add screenshot context"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Context</span>
                  </button>
                </div>
                {/* Context remaining indicator */}
                {tokenUsage.input > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                    <span>Context left:</span>
                    <span className={`font-mono ${
                      Math.max(0, 100 - Math.round(tokenUsage.input / 2000)) <= 20
                        ? "text-error"
                        : Math.max(0, 100 - Math.round(tokenUsage.input / 2000)) <= 40
                          ? "text-warning"
                          : "text-text-secondary"
                    }`}>
                      {Math.max(0, 100 - Math.round(tokenUsage.input / 2000))}%
                    </span>
                  </div>
                )}
                {status === "working" && (
                  <button
                    type="button"
                    onClick={() => {
                      // Set status immediately for instant feedback
                      // Don't wait for the backend - user wants it stopped NOW
                      setStatus("interrupted");
                      setCurrentActivity(null);

                      // Fire and forget - don't await
                      invoke("cancel_claude_request", {
                        workingDir: PROJECT_DIR,
                        skipPermissions: false,
                      }).catch((err) => {
                        console.error("Failed to cancel:", err);
                      });
                    }}
                    className="px-3 py-1.5 text-xs text-text-tertiary hover:text-error transition-colors"
                  >
                    Cancel
                  </button>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-error-muted border-t border-error/30">
          <p className="text-xs text-error text-center">{error}</p>
        </div>
      )}

      {/* Status indicator - minimal */}
      {(status === "connecting" || status === "disconnected") && (
        <div className="absolute top-4 right-4">
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <div className={`w-2 h-2 rounded-full ${
              status === "connecting" ? "bg-warning animate-pulse" : "bg-text-tertiary"
            }`} />
            <span>{status === "connecting" ? "Connecting..." : "Disconnected"}</span>
          </div>
        </div>
      )}

      {/* Permission Request Modal */}
      {permissionRequest && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-raised border border-border rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border-subtle bg-surface-overlay">
              <div className="flex items-center gap-2">
                <span className="text-warning text-lg">⚠</span>
                <h3 className="font-semibold text-text-primary">Permission Required</h3>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary">Tool:</span>
                <span className="px-2 py-0.5 bg-surface-overlay rounded text-sm font-mono text-accent">
                  {permissionRequest.toolName}
                </span>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-text-tertiary">Input:</span>
                <pre className="bg-surface-sunken rounded-lg p-3 text-xs font-mono text-text-secondary overflow-auto max-h-48">
                  {JSON.stringify(permissionRequest.toolInput, null, 2)}
                </pre>
              </div>
            </div>

            {/* Actions */}
            <div className="px-4 py-3 border-t border-border-subtle bg-surface-overlay flex items-center justify-between">
              <button
                onClick={() => handlePermissionResponse(false)}
                className="px-4 py-2 rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary text-sm transition-colors"
              >
                Deny
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePermissionResponse(true, true)}
                  className="px-4 py-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-sm transition-colors"
                >
                  Always Allow
                </button>
                <button
                  onClick={() => handlePermissionResponse(true)}
                  className="px-4 py-2 rounded-lg bg-success hover:bg-success/80 text-white text-sm font-medium transition-colors"
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Skills Modal */}
      <SkillsModal
        isOpen={showSkillsModal}
        onClose={() => setShowSkillsModal(false)}
        activeSkills={availableSkills}
        projectPath={PROJECT_DIR}
      />

      {/* Chat Context Review Modal */}
      <ChatContextModal
        isOpen={showContextModal}
        onClose={() => {
          setShowContextModal(false);
          setPendingMessage("");
          setPendingFileRefs([]);
        }}
        onSend={(message, context) => {
          // Build enhanced message with context info
          let enhancedMessage = message;

          const screenshotIncluded = context.some(c => c.type === "screenshot" && c.enabled);
          const fileRefs = context.filter(c => c.type === "file" && c.enabled);

          if (screenshotIncluded || fileRefs.length > 0) {
            const contextParts: string[] = [];
            if (screenshotIncluded) {
              contextParts.push("a screenshot of the current simulator state");
            }
            if (fileRefs.length > 0) {
              contextParts.push(`the following files: ${fileRefs.map(f => f.label).join(", ")}`);
            }
            enhancedMessage = `${message}\n\n[Context: I've included ${contextParts.join(" and ")}. Please use the available tools to access this context.]`;
          }

          handleInputSubmit(enhancedMessage);
          setShowContextModal(false);
          setPendingMessage("");
          setPendingFileRefs([]);
        }}
        initialMessage={pendingMessage}
        fileReferences={pendingFileRefs}
        projectPath={PROJECT_DIR}
      />
    </div>
  );
};

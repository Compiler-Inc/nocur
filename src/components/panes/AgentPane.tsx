import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SkillsModal } from "../SkillsModal";

interface ClaudeEvent {
  eventType: string;
  content: string;
  toolName: string | null;
  toolInput: string | null;
  isError: boolean;
  rawJson: string | null;
  skills?: string[];
  model?: string;
  // Token usage
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
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
  toolsUsed?: Array<{ name: string; input?: string }>;
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

const PROJECT_DIR = "<REPO_ROOT>"; // TODO: Make dynamic

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
    <div className="mt-2 bg-surface-sunken rounded-lg overflow-hidden font-mono text-xs">
      {/* Removed lines */}
      {oldLines.map((line, i) => (
        <div key={`old-${i}`} className="flex">
          <span className="w-6 text-center bg-error/20 text-error select-none">-</span>
          <pre className="flex-1 px-2 bg-error/10 text-error/80 overflow-x-auto whitespace-pre">{line || " "}</pre>
        </div>
      ))}
      {/* Added lines */}
      {newLines.map((line, i) => (
        <div key={`new-${i}`} className="flex">
          <span className="w-6 text-center bg-success/20 text-success select-none">+</span>
          <pre className="flex-1 px-2 bg-success/10 text-success/80 overflow-x-auto whitespace-pre">{line || " "}</pre>
        </div>
      ))}
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

// Format tool calls in a user-friendly way
const formatToolDisplay = (toolName: string, toolInput: string | undefined): {
  summary: string;
  detail?: string;
  todos?: Array<{ content: string; status: string }>;
  diff?: { oldString: string; newString: string };
} => {
  if (!toolInput) return { summary: toolName };

  try {
    const parsed = JSON.parse(toolInput);

    switch (toolName) {
      case "Read": {
        const path = parsed.file_path || "";
        const filename = path.split("/").pop() || path;
        return { summary: `Reading ${filename}`, detail: path };
      }
      case "Edit": {
        const path = parsed.file_path || "";
        const filename = path.split("/").pop() || path;
        const oldString = parsed.old_string || "";
        const newString = parsed.new_string || "";
        return {
          summary: `Editing ${filename}`,
          detail: path,
          diff: oldString || newString ? { oldString, newString } : undefined
        };
      }
      case "Write": {
        const path = parsed.file_path || "";
        const filename = path.split("/").pop() || path;
        return { summary: `Writing ${filename}`, detail: path };
      }
      case "Bash": {
        const cmd = parsed.command || "";
        // Parse the command intelligently
        const summary = parseBashCommand(cmd);
        return { summary, detail: cmd };
      }
      case "Glob": {
        return { summary: `Finding ${parsed.pattern || "files"}` };
      }
      case "Grep": {
        const pattern = parsed.pattern || "";
        return { summary: `Searching "${pattern.slice(0, 30)}${pattern.length > 30 ? "..." : ""}"` };
      }
      case "Task": {
        return { summary: parsed.description || "Running agent task" };
      }
      case "TodoWrite": {
        const todos = parsed.todos || [];
        return {
          summary: `Updating ${todos.length} todo${todos.length !== 1 ? "s" : ""}`,
          todos: todos.map((t: { content: string; status: string }) => ({ content: t.content, status: t.status }))
        };
      }
      case "WebFetch": {
        const url = parsed.url || "";
        try {
          const hostname = new URL(url).hostname;
          return { summary: `Fetching ${hostname}`, detail: url };
        } catch {
          return { summary: "Fetching URL", detail: url };
        }
      }
      default:
        return { summary: toolName };
    }
  } catch {
    return { summary: toolName };
  }
};

type SessionStatus = "disconnected" | "connecting" | "connected" | "working" | "error" | "interrupted";

export const AgentPane = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [workingTime, setWorkingTime] = useState(0);
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const [currentActivity, setCurrentActivity] = useState<{
    type: "thinking" | "tool";
    toolName?: string;
    toolInput?: string;
  } | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [claudeModel, setClaudeModel] = useState<string | null>(null);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
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
  }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const workingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const responseStartTimeRef = useRef<number>(0);
  const skipPermissionsRef = useRef(skipPermissions);

  // Animated token counter
  const animatedOutputTokens = useAnimatedCounter(tokenUsage.output);

  // Keep skipPermissionsRef in sync with state AND update backend
  useEffect(() => {
    skipPermissionsRef.current = skipPermissions;

    // If skipPermissions enabled AND no messages yet, restart Claude with the native flag
    // This is faster than using our permission server for auto-approve
    if (skipPermissions && messages.length === 0 && status === "connected") {
      const restartWithFlag = async () => {
        try {
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

    const setup = async () => {
      // Listen for permission requests
      // Note: Auto-approve is handled in the Rust backend now for reliability
      unlistenPermission = await listen<PermissionRequest>("permission-request", async (event) => {
        console.log("Permission request received:", event.payload);
        setPermissionRequest(event.payload);
      });

      unlisten = await listen<ClaudeEvent>("claude-event", (event) => {
        const { eventType, content, toolName, isError } = event.payload;

        // Deduplicate events
        const eventKey = `${eventType}-${content?.slice(0, 50)}-${toolName || ""}`;
        if (eventType === "result" || eventType === "assistant") {
          if (processedEventsRef.current.has(eventKey)) {
            return;
          }
          processedEventsRef.current.add(eventKey);
          setTimeout(() => processedEventsRef.current.delete(eventKey), 5000);
        }

        if (eventType === "message_sent") {
          setStatus("working");
          setToolCalls([]);
          setCurrentActivity({ type: "thinking" });
          setTokenUsage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
          // Clear turn tracking for new turn
          setCurrentTurnContent("");
          setCurrentTurnTools([]);
          return;
        }

        // Handle system init - extract skills and model
        if (eventType === "system_init") {
          const { skills, model } = event.payload;
          console.log("Received system_init:", { skills, model });
          if (skills && skills.length > 0) {
            setAvailableSkills(skills);
          }
          if (model) {
            setClaudeModel(model);
          }
          // Cache in Rust backend so it survives HMR
          invoke("set_claude_session_info", { skills: skills || [], model: model || null }).catch(console.error);
          return;
        }

        // Handle token usage updates - use Math.max to keep cumulative count (tokens only go up)
        if (eventType === "usage") {
          const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = event.payload;
          setTokenUsage((prev) => ({
            input: Math.max(prev.input, inputTokens || 0),
            output: Math.max(prev.output, outputTokens || 0),
            cacheRead: Math.max(prev.cacheRead, cacheReadTokens || 0),
            cacheCreation: Math.max(prev.cacheCreation, cacheCreationTokens || 0),
          }));
          return;
        }

        // Also check for token usage in other event types (assistant, result)
        const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = event.payload;
        if (inputTokens || outputTokens) {
          setTokenUsage((prev) => ({
            input: Math.max(prev.input, inputTokens || 0),
            output: Math.max(prev.output, outputTokens || 0),
            cacheRead: Math.max(prev.cacheRead, cacheReadTokens || 0),
            cacheCreation: Math.max(prev.cacheCreation, cacheCreationTokens || 0),
          }));
        }

        if (eventType === "result") {
          const duration = (Date.now() - responseStartTimeRef.current) / 1000;
          if (content) {
            // Capture tools used before clearing (use functional update to access latest state)
            setCurrentTurnTools((tools) => {
              setMessages((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  type: "assistant",
                  content,
                  timestamp: new Date(),
                  duration,
                  toolsUsed: tools.length > 0 ? [...tools] : undefined,
                },
              ]);
              return []; // Clear tools after capturing
            });
          } else {
            setCurrentTurnTools([]);
          }
          setToolCalls([]);
          setCurrentActivity(null);
          setCurrentTurnContent("");
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

        // Track tool calls and current activity
        if (eventType === "assistant") {
          const { toolInput } = event.payload;

          if (toolName) {
            // This is a tool call
            setCurrentActivity({
              type: "tool",
              toolName,
              toolInput: toolInput || undefined,
            });
            setToolCalls((prev) => {
              if (prev.includes(toolName)) return prev;
              return [...prev, toolName];
            });
            // Add to turn tools history
            setCurrentTurnTools((prev) => [...prev, {
              name: toolName,
              input: toolInput || undefined,
            }]);
          } else if (content) {
            // This is text content - accumulate it
            setCurrentTurnContent((prev) => prev + content);
          }
        }
      });

      setStatus("connecting");
      try {
        // Always start with permissions enabled - we handle auto-approve client-side
        await invoke("start_claude_session", { workingDir: PROJECT_DIR, skipPermissions: false });
        setStatus("connected");

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "working") return;

    const userMessage = input.trim();
    setInput("");

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        type: "user",
        content: userMessage,
        timestamp: new Date(),
      },
    ]);

    try {
      await invoke("send_claude_message", { message: userMessage });
    } catch (err) {
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full bg-surface-base">
      {/* Messages area */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
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
                    <p className="text-text-primary text-[15px] leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                </div>
              )}

              {msg.type === "assistant" && (
                <div className="space-y-2">
                  <div className="prose prose-invert prose-sm max-w-none text-text-primary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // Code blocks
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
                        // Pre wrapper for code blocks
                        pre({ children }) {
                          return <pre className="bg-surface-sunken rounded-lg overflow-hidden my-3">{children}</pre>;
                        },
                        // Paragraphs
                        p({ children }) {
                          return <p className="text-[15px] leading-relaxed mb-3 last:mb-0">{children}</p>;
                        },
                        // Bold
                        strong({ children }) {
                          return <strong className="font-semibold text-text-primary">{children}</strong>;
                        },
                        // Lists
                        ul({ children }) {
                          return <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>;
                        },
                        ol({ children }) {
                          return <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>;
                        },
                        li({ children }) {
                          return <li className="text-[15px] leading-relaxed">{children}</li>;
                        },
                        // Headings
                        h1({ children }) {
                          return <h1 className="text-lg font-semibold text-text-primary mt-4 mb-2">{children}</h1>;
                        },
                        h2({ children }) {
                          return <h2 className="text-base font-semibold text-text-primary mt-3 mb-2">{children}</h2>;
                        },
                        h3({ children }) {
                          return <h3 className="text-sm font-semibold text-text-primary mt-2 mb-1">{children}</h3>;
                        },
                        // Links
                        a({ href, children }) {
                          return <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
                        },
                        // Blockquotes
                        blockquote({ children }) {
                          return <blockquote className="border-l-2 border-border pl-3 my-2 text-text-secondary italic">{children}</blockquote>;
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  {msg.duration && (
                    <div className="flex items-center gap-2 text-text-tertiary text-xs">
                      <span>{msg.duration.toFixed(1)}s</span>
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
                  {/* Tool use summary - collapsible */}
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <details className="mt-2 group">
                      <summary className="text-xs text-text-tertiary cursor-pointer hover:text-text-secondary select-none flex items-center gap-1.5">
                        <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span>{msg.toolsUsed.length} tool{msg.toolsUsed.length > 1 ? "s" : ""} used</span>
                      </summary>
                      <div className="mt-2 pl-4 space-y-1.5 font-mono text-xs border-l border-border-subtle">
                        {msg.toolsUsed.map((tool, i) => {
                          const { summary, detail, diff } = formatToolDisplay(tool.name, tool.input);
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
              {currentActivity?.type === "thinking" && (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <span className="animate-pulse">∴</span>
                  <span>Thinking...</span>
                </div>
              )}

              {/* Tool call history */}
              {toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {toolCalls.map((tool, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 rounded text-xs ${
                        tool === currentActivity?.toolName
                          ? "bg-success/20 text-success"
                          : "bg-surface-overlay text-text-tertiary"
                      }`}
                    >
                      {tool}
                    </span>
                  ))}
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
        <div className="max-w-3xl mx-auto p-4">
          <form onSubmit={handleSubmit}>
            <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Claude to make changes..."
                disabled={status === "working" || status === "connecting"}
                rows={1}
                className="w-full bg-transparent px-4 py-3 text-[15px] text-text-primary placeholder-text-tertiary focus:outline-none resize-none disabled:opacity-50"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  {/* Model indicator */}
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-overlay text-text-secondary text-xs"
                    title={claudeModel || "Claude model"}
                  >
                    <span className="text-accent">✳</span>
                    <span>{claudeModel ? claudeModel.replace("claude-", "").replace("-20251101", "") : "Claude"}</span>
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
                </div>
                <div className="flex items-center gap-1">
                  {status === "working" && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await invoke("cancel_claude_request", {
                            workingDir: PROJECT_DIR,
                            skipPermissions: false,
                          });
                          // Keep currentActivity and toolCalls so user sees what was happening
                          setStatus("interrupted");
                        } catch (err) {
                          console.error("Failed to cancel:", err);
                        }
                      }}
                      className="px-3 py-1.5 text-xs text-text-tertiary hover:text-error transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={!input.trim() || status === "working" || status === "connecting"}
                    className="p-2 rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary disabled:opacity-30 disabled:hover:bg-surface-overlay transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </form>
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
    </div>
  );
};

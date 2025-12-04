import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ClaudeEvent {
  eventType: string;
  content: string;
  toolName: string | null;
  toolInput: string | null;
  isError: boolean;
  rawJson: string | null;
}

interface Message {
  id: string;
  type: "user" | "assistant" | "tool" | "error" | "system";
  content: string;
  toolName?: string;
  toolInput?: string;
  timestamp: Date;
  duration?: number;
}

const PROJECT_DIR = "<REPO_ROOT>"; // TODO: Make dynamic

type SessionStatus = "disconnected" | "connecting" | "connected" | "working" | "error";

export const AgentPane = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [workingTime, setWorkingTime] = useState(0);
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const workingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const responseStartTimeRef = useRef<number>(0);

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

    const setup = async () => {
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
          return;
        }

        if (eventType === "result") {
          const duration = (Date.now() - responseStartTimeRef.current) / 1000;
          if (content) {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                type: "assistant",
                content,
                timestamp: new Date(),
                duration,
              },
            ]);
          }
          setToolCalls([]);
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
          setStatus("error");
          return;
        }

        // Track tool calls
        if (eventType === "assistant" && toolName) {
          setToolCalls((prev) => {
            if (prev.includes(toolName)) return prev;
            return [...prev, toolName];
          });
        }
      });

      setStatus("connecting");
      try {
        await invoke("start_claude_session", { workingDir: PROJECT_DIR });
        setStatus("connected");
      } catch (err) {
        setStatus("error");
        setError(String(err));
      }
    };

    setup();

    return () => {
      if (unlisten) unlisten();
      invoke("stop_claude_session").catch(console.error);
    };
  }, []);

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
                  <div className="text-text-primary text-[15px] leading-relaxed whitespace-pre-wrap">
                    {msg.content}
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
                </div>
              )}

              {msg.type === "error" && (
                <div className="text-error text-[15px] leading-relaxed">
                  {msg.content}
                </div>
              )}
            </div>
          ))}

          {/* Working indicator */}
          {status === "working" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <span className="text-accent">{workingTime.toFixed(1)}s</span>
                {toolCalls.length > 0 && (
                  <>
                    <span className="text-text-tertiary">·</span>
                    <span className="text-text-tertiary">
                      {toolCalls.length} tool call{toolCalls.length !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
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
                placeholder="Ask to make changes, @mention files, run /commands"
                disabled={status === "working" || status === "connecting"}
                rows={1}
                className="w-full bg-transparent px-4 py-3 text-[15px] text-text-primary placeholder-text-tertiary focus:outline-none resize-none disabled:opacity-50"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
              <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-overlay hover:bg-hover text-text-secondary text-xs transition-colors"
                  >
                    <span className="text-accent">✳</span>
                    <span>Opus 4.5</span>
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  {status === "working" && (
                    <button
                      type="button"
                      onClick={() => {
                        // TODO: Implement cancel
                      }}
                      className="px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
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
    </div>
  );
};

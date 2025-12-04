import { useState } from "react";

type MessageRole = "user" | "assistant" | "tool";

interface ToolCall {
  name: string;
  status: "running" | "done" | "error";
  args?: string;
  result?: string;
}

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolCall?: ToolCall;
}

// Mock messages for now - will be replaced with actual Claude Code integration
const mockMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "Build the app and check if there are any errors",
    timestamp: new Date(),
  },
  {
    id: "2",
    role: "tool",
    content: "",
    timestamp: new Date(),
    toolCall: {
      name: "Bash",
      status: "done",
      args: "nocur-swift app build",
      result: "Build succeeded",
    },
  },
  {
    id: "3",
    role: "assistant",
    content: "The build completed successfully with no errors. The app is ready to run on the simulator.",
    timestamp: new Date(),
  },
];

const ToolIcon = ({ name }: { name: string }) => {
  const icons: Record<string, string> = {
    Bash: "⌘",
    Read: "◉",
    Write: "✎",
    Glob: "◎",
    Grep: "⌕",
    Screenshot: "▢",
    Tap: "◉",
  };
  return <span className="text-zinc-500">{icons[name] || "▸"}</span>;
};

const ToolCallBlock = ({ toolCall }: { toolCall: ToolCall }) => {
  const statusColors = {
    running: "text-yellow-500",
    done: "text-green-500",
    error: "text-red-500",
  };

  return (
    <div className="my-2 rounded border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/50 border-b border-zinc-800">
        <ToolIcon name={toolCall.name} />
        <span className="text-xs font-medium text-zinc-300">{toolCall.name}</span>
        <span className={`text-xs ${statusColors[toolCall.status]}`}>
          {toolCall.status === "running" ? "●" : toolCall.status === "done" ? "✓" : "✗"}
        </span>
      </div>
      {toolCall.args && (
        <div className="px-3 py-2 text-xs text-zinc-400 font-mono">
          <span className="text-zinc-600">$ </span>
          {toolCall.args}
        </div>
      )}
      {toolCall.result && (
        <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-800/50">
          {toolCall.result}
        </div>
      )}
    </div>
  );
};

const MessageBlock = ({ message }: { message: Message }) => {
  if (message.role === "tool" && message.toolCall) {
    return <ToolCallBlock toolCall={message.toolCall} />;
  }

  if (message.role === "user") {
    return (
      <div className="my-3">
        <div className="flex items-start gap-2">
          <span className="text-blue-400 font-bold shrink-0">❯</span>
          <p className="text-zinc-200">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="my-3 pl-4 border-l-2 border-zinc-800">
      <p className="text-zinc-300 leading-relaxed">{message.content}</p>
    </div>
  );
};

type AgentStatus = "idle" | "thinking" | "running" | "waiting";

export const AgentPane = () => {
  const [messages] = useState<Message[]>(mockMessages);
  const [input, setInput] = useState("");
  const [status] = useState<AgentStatus>("idle");

  const statusConfig = {
    idle: { color: "bg-zinc-500", text: "Idle" },
    thinking: { color: "bg-yellow-500 animate-pulse", text: "Thinking..." },
    running: { color: "bg-blue-500 animate-pulse", text: "Running" },
    waiting: { color: "bg-green-500", text: "Waiting for input" },
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    // TODO: Send to Claude Code subprocess
    console.log("Send:", input);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-zinc-300">Claude</h2>
          <span className="text-xs text-zinc-600 font-mono">nocur agent</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${statusConfig[status].color}`} />
          <span className="text-xs text-zinc-500">{statusConfig[status].text}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600">
            <div className="text-4xl mb-4">◎</div>
            <p className="text-sm">Start a conversation with Claude</p>
            <p className="text-xs mt-1 text-zinc-700">
              Ask it to build, test, or verify your iOS app
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg) => (
              <MessageBlock key={msg.id} message={msg} />
            ))}
            {status === "thinking" && (
              <div className="my-3 pl-4 border-l-2 border-zinc-800">
                <span className="text-zinc-500 animate-pulse">Thinking...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center gap-2 p-3">
          <span className="text-blue-400 font-mono font-bold">❯</span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Claude to help with your iOS app..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none font-mono"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-zinc-800 disabled:hover:text-zinc-400 transition-colors"
          >
            Send
          </button>
        </div>
        <div className="px-4 pb-2 flex items-center gap-4 text-xs text-zinc-600">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">↵</kbd>
            send
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">esc</kbd>
            cancel
          </span>
        </div>
      </form>
    </div>
  );
};

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { spawn, IPty } from "tauri-pty";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  workingDir: string;
  onReady?: () => void;
}

export const XTerminal = ({ workingDir, onReady }: XTerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const initTerminal = useCallback(async () => {
    if (!terminalRef.current || termRef.current) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "SF Mono", "Menlo", "Monaco", "Courier New", monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e4e4e4",
        cursor: "#f5a623",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#f5a62333",
        black: "#0a0a0a",
        red: "#ff6b6b",
        green: "#4ecdc4",
        yellow: "#f5a623",
        blue: "#45aaf2",
        magenta: "#a55eea",
        cyan: "#26de81",
        white: "#e4e4e4",
        brightBlack: "#666666",
        brightRed: "#ff8787",
        brightGreen: "#7bed9f",
        brightYellow: "#ffc048",
        brightBlue: "#70a1ff",
        brightMagenta: "#cd84f1",
        brightCyan: "#7efff5",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    // Create fit addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Open terminal in container
    term.open(terminalRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Spawn shell
    try {
      const shell = process.platform === "win32" ? "powershell.exe" : "/bin/zsh";
      const pty = await spawn(shell, [], {
        cols: term.cols,
        rows: term.rows,
        cwd: workingDir,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });

      ptyRef.current = pty;

      // Connect PTY to terminal
      pty.onData((data: string) => {
        term.write(data);
      });

      pty.onExit(() => {
        term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
      });

      // Connect terminal input to PTY
      term.onData((data: string) => {
        pty.write(data);
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        pty.resize(cols, rows);
      });

      onReady?.();
    } catch (e) {
      console.error("Failed to spawn shell:", e);
      term.write(`\x1b[31mFailed to spawn shell: ${e}\x1b[0m\r\n`);
    }
  }, [workingDir, onReady]);

  // Initialize terminal
  useEffect(() => {
    initTerminal();

    return () => {
      ptyRef.current?.kill();
      termRef.current?.dispose();
      termRef.current = null;
      ptyRef.current = null;
    };
  }, [initTerminal]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (e) {
          // Ignore fit errors during resize
        }
      }
    };

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div
      ref={terminalRef}
      className="w-full h-full"
      style={{ padding: "4px 8px" }}
    />
  );
};

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { spawn, IPty } from "tauri-pty";
import { platform } from "@tauri-apps/plugin-os";
import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  workingDir: string;
  onReady?: () => void;
  onExit?: () => void;
}

export interface XTerminalHandle {
  focus: () => void;
  fit: () => void;
  write: (data: string) => void;
}

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(
  ({ workingDir, onReady, onExit }, ref) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const ptyRef = useRef<IPty | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      focus: () => termRef.current?.focus(),
      fit: () => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore fit errors
        }
      },
      write: (data: string) => termRef.current?.write(data),
    }));

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
        // Use Tauri's platform API instead of process.platform
        const currentPlatform = platform();
        const shell = currentPlatform === "windows" ? "powershell.exe" : "/bin/zsh";

        console.log("[XTerminal] Platform:", currentPlatform);
        console.log("[XTerminal] Shell:", shell);
        console.log("[XTerminal] Working dir:", workingDir);
        console.log("[XTerminal] Terminal size:", term.cols, "x", term.rows);

        // Get environment from Rust backend (tauri-pty doesn't inherit parent env)
        const env = await invoke<Record<string, string>>("get_shell_env");
        console.log("[XTerminal] Got environment with", Object.keys(env).length, "variables");

        // Use -l for login shell to properly initialize environment
        // Also set name to xterm-256color for proper terminal emulation
        const pty = await spawn(shell, ["-l"], {
          cols: term.cols,
          rows: term.rows,
          cwd: workingDir,
          name: "xterm-256color",
          env: {
            ...env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
        });

        console.log("[XTerminal] PTY spawned successfully");

        ptyRef.current = pty;

        // Connect PTY to terminal
        pty.onData((data: string) => {
          console.log("[XTerminal] PTY data received:", data.length, "bytes");
          term.write(data);
        });

        pty.onExit(() => {
          term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
          onExit?.();
        });

        // Connect terminal input to PTY
        term.onData((data: string) => {
          console.log("[XTerminal] Terminal input:", JSON.stringify(data));
          pty.write(data);
        });

        // Handle resize
        term.onResize(({ cols, rows }) => {
          pty.resize(cols, rows);
        });

        // Focus the terminal
        term.focus();
        onReady?.();
      } catch (e) {
        console.error("Failed to spawn shell:", e);
        term.write(`\x1b[31mFailed to spawn shell: ${e}\x1b[0m\r\n`);
      }
    }, [workingDir, onReady, onExit]);

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
          } catch {
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
  }
);

XTerminal.displayName = "XTerminal";

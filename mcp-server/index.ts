#!/usr/bin/env npx tsx
/**
 * Nocur MCP Server
 *
 * Exposes nocur-swift CLI commands as MCP tools for Claude Code integration.
 * This allows Claude to build, run, and verify iOS apps autonomously.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { z } from "zod";

// Path to nocur-swift CLI (built in debug mode)
const NOCUR_SWIFT_PATH = new URL("../nocur-swift/.build/debug/nocur-swift", import.meta.url).pathname;

// Helper to run nocur-swift commands
async function runNocurSwift(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(NOCUR_SWIFT_PATH, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, exitCode: 1 });
    });
  });
}

// Tool definitions
const tools = [
  // Simulator tools
  {
    name: "sim_list",
    description: "List all available iOS simulators with their UDIDs, names, and states",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "sim_boot",
    description: "Boot an iOS simulator by its UDID",
    inputSchema: {
      type: "object" as const,
      properties: {
        udid: { type: "string", description: "The simulator UDID to boot" },
      },
      required: ["udid"],
    },
  },
  {
    name: "sim_screenshot",
    description: "Take a screenshot of the booted iOS simulator. Returns the path to the screenshot file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        udid: { type: "string", description: "Optional simulator UDID (uses booted if not specified)" },
        outputPath: { type: "string", description: "Optional output path for the screenshot" },
      },
      required: [],
    },
  },
  {
    name: "sim_shutdown",
    description: "Shutdown an iOS simulator",
    inputSchema: {
      type: "object" as const,
      properties: {
        udid: { type: "string", description: "Optional simulator UDID (uses booted if not specified)" },
      },
      required: [],
    },
  },

  // App lifecycle tools
  {
    name: "app_build",
    description: "Build an Xcode project. Returns structured build errors if the build fails.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the Xcode project or workspace" },
        scheme: { type: "string", description: "Build scheme name" },
        destination: { type: "string", description: "Optional destination (defaults to booted simulator)" },
      },
      required: [],
    },
  },
  {
    name: "app_run",
    description: "Build and run an app on the simulator",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the Xcode project or workspace" },
        scheme: { type: "string", description: "Build scheme name" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: [],
    },
  },
  {
    name: "app_launch",
    description: "Launch an already-installed app by bundle ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        bundleId: { type: "string", description: "The app's bundle identifier" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: ["bundleId"],
    },
  },
  {
    name: "app_terminate",
    description: "Terminate a running app by bundle ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        bundleId: { type: "string", description: "The app's bundle identifier" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: ["bundleId"],
    },
  },

  // UI interaction tools
  {
    name: "ui_hierarchy",
    description: "Get the view hierarchy of the currently running app. Returns structured JSON with all UI elements and their accessibility identifiers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: [],
    },
  },
  {
    name: "ui_tap",
    description: "Tap at specific screen coordinates",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: { type: "number", description: "X coordinate (in device pixels)" },
        y: { type: "number", description: "Y coordinate (in device pixels)" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "ui_tap_element",
    description: "Tap on a UI element by its accessibility identifier",
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: { type: "string", description: "Accessibility identifier of the element to tap" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: ["identifier"],
    },
  },
  {
    name: "ui_scroll",
    description: "Scroll the screen in a direction",
    inputSchema: {
      type: "object" as const,
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction" },
        amount: { type: "number", description: "Amount to scroll (in pixels)" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: ["direction"],
    },
  },
  {
    name: "ui_type",
    description: "Type text into the currently focused field",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Text to type" },
        elementIdentifier: { type: "string", description: "Optional accessibility identifier to tap first" },
        clearFirst: { type: "boolean", description: "Whether to clear existing text first" },
        udid: { type: "string", description: "Optional simulator UDID" },
      },
      required: ["text"],
    },
  },

  // Project tools
  {
    name: "project_detect",
    description: "Auto-detect Xcode project in a directory",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Directory to search for Xcode projects" },
      },
      required: ["path"],
    },
  },
  {
    name: "project_info",
    description: "Get detailed information about an Xcode project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the Xcode project or workspace" },
      },
      required: ["projectPath"],
    },
  },
];

// Tool handlers
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  const cmdArgs: string[] = [];

  switch (name) {
    // Simulator tools
    case "sim_list":
      cmdArgs.push("sim", "list");
      break;
    case "sim_boot":
      cmdArgs.push("sim", "boot", args.udid as string);
      break;
    case "sim_screenshot":
      cmdArgs.push("sim", "screenshot");
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      if (args.outputPath) cmdArgs.push("--output", args.outputPath as string);
      break;
    case "sim_shutdown":
      cmdArgs.push("sim", "shutdown");
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;

    // App lifecycle tools
    case "app_build":
      cmdArgs.push("app", "build");
      if (args.projectPath) cmdArgs.push("--project", args.projectPath as string);
      if (args.scheme) cmdArgs.push("--scheme", args.scheme as string);
      if (args.destination) cmdArgs.push("--destination", args.destination as string);
      break;
    case "app_run":
      cmdArgs.push("app", "run");
      if (args.projectPath) cmdArgs.push("--project", args.projectPath as string);
      if (args.scheme) cmdArgs.push("--scheme", args.scheme as string);
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;
    case "app_launch":
      cmdArgs.push("app", "launch", args.bundleId as string);
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;
    case "app_terminate":
      cmdArgs.push("app", "terminate", args.bundleId as string);
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;

    // UI interaction tools
    case "ui_hierarchy":
      cmdArgs.push("ui", "hierarchy");
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;
    case "ui_tap":
      cmdArgs.push("ui", "tap", String(args.x), String(args.y));
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;
    case "ui_tap_element":
      cmdArgs.push("ui", "tap-element", args.identifier as string);
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;
    case "ui_scroll":
      cmdArgs.push("ui", "scroll", args.direction as string);
      if (args.amount) cmdArgs.push("--amount", String(args.amount));
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;
    case "ui_type":
      cmdArgs.push("ui", "type", args.text as string);
      if (args.elementIdentifier) cmdArgs.push("--element", args.elementIdentifier as string);
      if (args.clearFirst) cmdArgs.push("--clear");
      if (args.udid) cmdArgs.push("--udid", args.udid as string);
      break;

    // Project tools
    case "project_detect":
      cmdArgs.push("project", "detect", "--path", args.path as string);
      break;
    case "project_info":
      cmdArgs.push("project", "info", "--path", args.projectPath as string);
      break;

    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  const result = await runNocurSwift(cmdArgs);

  // Try to parse and re-format JSON for better readability
  try {
    const parsed = JSON.parse(result.stdout);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // If not valid JSON, return raw output
    if (result.exitCode !== 0) {
      return `Error (exit ${result.exitCode}):\n${result.stderr || result.stdout}`;
    }
    return result.stdout;
  }
}

// Create and start the server
const server = new Server(
  {
    name: "nocur",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleToolCall(name, args ?? {});
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nocur MCP server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

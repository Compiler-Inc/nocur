/**
 * Nocur Claude Service
 *
 * A Node.js service that wraps the Claude Agent SDK for use with Tauri.
 * Communicates via JSON over stdin/stdout.
 *
 * Input commands (JSON per line):
 * - { type: "start", workingDir, model?, systemPrompt?, resumeSessionId? }
 * - { type: "message", content }
 * - { type: "interrupt" }
 * - { type: "changeModel", model }
 * - { type: "stop" }
 *
 * Output events (JSON per line):
 * - { type: "system_init", sessionId, model }
 * - { type: "assistant", content, toolName?, toolInput? }
 * - { type: "tool_use", toolName, toolInput }
 * - { type: "tool_result", toolName, result }
 * - { type: "result", content, usage }
 * - { type: "error", message }
 * - { type: "ready" }
 */

import { createInterface } from 'readline';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { spawn } from 'child_process';

// Types for stdin commands
interface StartCommand {
  type: 'start';
  workingDir: string;
  model?: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  skipPermissions?: boolean;
}

interface MessageCommand {
  type: 'message';
  content: string;
}

interface InterruptCommand {
  type: 'interrupt';
}

interface ChangeModelCommand {
  type: 'changeModel';
  model: string;
}

interface StopCommand {
  type: 'stop';
}

type Command = StartCommand | MessageCommand | InterruptCommand | ChangeModelCommand | StopCommand;

// Output event types
interface OutputEvent {
  type: string;
  [key: string]: unknown;
}

// Service state
let currentQuery: AsyncGenerator<unknown, void, unknown> | null = null;
let currentSessionId: string | null = null;
let resumeSessionId: string | null = null;
let currentModel: string = 'sonnet';
let workingDir: string = process.cwd();
let nocurSwiftPath: string = '';

// Helper to emit events to stdout
function emit(event: OutputEvent) {
  console.log(JSON.stringify(event));
}

// Helper to log errors to stderr (won't interfere with JSON protocol)
function logError(message: string) {
  console.error(`[claude-service] ${message}`);
}

// Create nocur-swift MCP tools server
function createNocurSwiftServer(swiftPath: string) {
  return createSdkMcpServer({
    name: 'nocur-swift',
    version: '1.0.0',
    tools: [
      // Screenshot tool
      tool(
        'sim_screenshot',
        'Take a screenshot of the iOS simulator. Returns base64 JPEG image.',
        {
          base64: z.boolean().optional().describe('Return base64 output (faster)'),
        },
        async (_args: { base64?: boolean }) => {
          const result = await runNocurSwift(['sim', 'screenshot', '--base64']);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // List simulators
      tool(
        'sim_list',
        'List available iOS simulators',
        {
          booted: z.boolean().optional().describe('Only show booted simulators'),
        },
        async (args: { booted?: boolean }) => {
          const cmdArgs = ['sim', 'list'];
          if (args.booted) cmdArgs.push('--booted');
          const result = await runNocurSwift(cmdArgs);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // Boot simulator
      tool(
        'sim_boot',
        'Boot an iOS simulator by name',
        {
          name: z.string().describe('Simulator name (e.g., "iPhone 16 Pro")'),
        },
        async (args: { name: string }) => {
          const result = await runNocurSwift(['sim', 'boot', args.name]);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // UI Interact (tap + screenshot in one call)
      tool(
        'ui_interact',
        'Perform a UI action and capture screenshot. Most efficient for agents.',
        {
          tapX: z.number().optional().describe('X coordinate to tap'),
          tapY: z.number().optional().describe('Y coordinate to tap'),
          tapId: z.string().optional().describe('Accessibility ID to tap'),
          tapLabel: z.string().optional().describe('Label text to tap'),
          typeText: z.string().optional().describe('Text to type'),
          typeInto: z.string().optional().describe('Element ID to type into'),
          scroll: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction'),
        },
        async (args: { tapX?: number; tapY?: number; tapId?: string; tapLabel?: string; typeText?: string; typeInto?: string; scroll?: 'up' | 'down' | 'left' | 'right' }) => {
          const cmdArgs = ['ui', 'interact'];

          if (args.tapX !== undefined && args.tapY !== undefined) {
            cmdArgs.push('--tap', String(args.tapX), String(args.tapY));
          } else if (args.tapId) {
            cmdArgs.push('--tap-id', args.tapId);
          } else if (args.tapLabel) {
            cmdArgs.push('--tap-label', args.tapLabel);
          } else if (args.typeText) {
            cmdArgs.push('--type', args.typeText);
            if (args.typeInto) cmdArgs.push('--into', args.typeInto);
          } else if (args.scroll) {
            cmdArgs.push('--scroll', args.scroll);
          }

          const result = await runNocurSwift(cmdArgs);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // UI Hierarchy
      tool(
        'ui_hierarchy',
        'Get the view hierarchy of the running iOS app',
        {},
        async () => {
          const result = await runNocurSwift(['ui', 'hierarchy']);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // UI Find
      tool(
        'ui_find',
        'Find UI elements by text, type, or accessibility ID',
        {
          text: z.string().optional().describe('Find by text content'),
          type: z.string().optional().describe('Find by element type'),
          id: z.string().optional().describe('Find by accessibility ID'),
        },
        async (args: { text?: string; type?: string; id?: string }) => {
          const cmdArgs = ['ui', 'find'];
          if (args.text) cmdArgs.push('--text', args.text);
          if (args.type) cmdArgs.push('--type', args.type);
          if (args.id) cmdArgs.push('--id', args.id);
          const result = await runNocurSwift(cmdArgs);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // App Build
      tool(
        'app_build',
        'Build an Xcode project',
        {
          project: z.string().describe('Path to .xcodeproj or .xcworkspace'),
          scheme: z.string().optional().describe('Build scheme'),
        },
        async (args: { project: string; scheme?: string }) => {
          const cmdArgs = ['app', 'build', '--project', args.project];
          if (args.scheme) cmdArgs.push('--scheme', args.scheme);
          const result = await runNocurSwift(cmdArgs);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // App Launch
      tool(
        'app_launch',
        'Launch an app in the simulator',
        {
          bundleId: z.string().describe('App bundle ID (e.g., com.example.app)'),
        },
        async (args: { bundleId: string }) => {
          const result = await runNocurSwift(['app', 'launch', args.bundleId]);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      // App Kill
      tool(
        'app_kill',
        'Kill a running app in the simulator',
        {
          bundleId: z.string().describe('App bundle ID'),
        },
        async (args: { bundleId: string }) => {
          const result = await runNocurSwift(['app', 'kill', args.bundleId]);
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),
    ],
  });
}

// Helper to run nocur-swift commands
async function runNocurSwift(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(nocurSwiftPath, args, {
      cwd: workingDir,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`nocur-swift failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// Map model short names to full model IDs
function resolveModel(model: string): string {
  const modelMap: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-20250514',
    'opus': 'claude-opus-4-20250514',
    'haiku': 'claude-3-5-haiku-20241022',
  };
  return modelMap[model.toLowerCase()] || model;
}

// Process a query with the Agent SDK
async function processQuery(prompt: string, options: {
  model: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  skipPermissions?: boolean;
}) {
  const nocurServer = createNocurSwiftServer(nocurSwiftPath);

  // Build system prompt for iOS development
  const defaultSystemPrompt = `You are an AI assistant helping with iOS development. You have access to nocur-swift tools for:
- Taking screenshots of the iOS simulator
- Inspecting UI hierarchy and finding elements
- Interacting with the UI (tap, type, scroll)
- Building and launching Xcode projects

IMPORTANT: Always verify your iOS work visually with screenshots after making changes.
Use ui_interact for efficient interaction - it performs the action AND returns a screenshot in one call.`;

  const fullSystemPrompt = options.systemPrompt
    ? `${defaultSystemPrompt}\n\n${options.systemPrompt}`
    : defaultSystemPrompt;

  try {
    const queryOptions: Record<string, unknown> = {
      model: resolveModel(options.model),
      systemPrompt: fullSystemPrompt,
      mcpServers: { 'nocur-swift': nocurServer },
      allowedTools: [
        // Standard Claude Code tools
        'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
        // Our nocur-swift MCP tools
        'mcp__nocur-swift__sim_screenshot',
        'mcp__nocur-swift__sim_list',
        'mcp__nocur-swift__sim_boot',
        'mcp__nocur-swift__ui_interact',
        'mcp__nocur-swift__ui_hierarchy',
        'mcp__nocur-swift__ui_find',
        'mcp__nocur-swift__app_build',
        'mcp__nocur-swift__app_launch',
        'mcp__nocur-swift__app_kill',
      ],
      cwd: workingDir,
    };

    if (options.resumeSessionId) {
      queryOptions.resume = options.resumeSessionId;
    }

    if (options.skipPermissions) {
      queryOptions.permissionMode = 'bypassPermissions';
    }

    // Use string prompt directly for simpler interaction
    const queryGenerator = query({
      prompt,
      options: queryOptions,
    });
    currentQuery = queryGenerator;

    for await (const message of queryGenerator) {
      const msg = message as Record<string, unknown>;

      // Handle system init
      if (msg.type === 'system' && msg.subtype === 'init') {
        currentSessionId = msg.session_id as string;
        emit({
          type: 'system_init',
          sessionId: currentSessionId,
          model: options.model,
        });
      }

      // Handle assistant messages
      else if (msg.type === 'assistant') {
        const assistantMsg = msg.message as Record<string, unknown>;
        const content = assistantMsg.content as Array<Record<string, unknown>>;

        for (const block of content) {
          if (block.type === 'text') {
            emit({
              type: 'assistant',
              content: block.text as string,
            });
          } else if (block.type === 'tool_use') {
            emit({
              type: 'tool_use',
              toolName: block.name as string,
              toolInput: JSON.stringify(block.input),
              toolId: block.id as string,
            });
          }
        }
      }

      // Handle user messages (tool results)
      else if (msg.type === 'user') {
        const userMsg = msg.message as Record<string, unknown>;
        const content = userMsg.content as Array<Record<string, unknown>>;

        for (const block of content) {
          if (block.type === 'tool_result') {
            emit({
              type: 'tool_result',
              toolId: block.tool_use_id as string,
              result: typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
            });
          }
        }
      }

      // Handle result
      else if (msg.type === 'result') {
        const usage = msg.usage as Record<string, number> | undefined;
        emit({
          type: 'result',
          content: msg.result as string || '',
          subtype: msg.subtype as string,
          usage: usage ? {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheCreationTokens: usage.cache_creation_input_tokens,
          } : undefined,
          cost: msg.cost,
          duration: msg.duration,
          numTurns: msg.num_turns,
        });
      }
    }
  } catch (error) {
    emit({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    currentQuery = null;
  }
}

// Handle incoming commands
async function handleCommand(command: Command) {
  switch (command.type) {
    case 'start':
      workingDir = command.workingDir;
      nocurSwiftPath = `${workingDir}/nocur-swift/.build/release/nocur-swift`;
      currentModel = command.model || 'sonnet';
      resumeSessionId = command.resumeSessionId || null;

      emit({ type: 'ready', workingDir, model: currentModel, resumeSessionId });

      // If there's an initial system prompt, we don't start a query yet
      // We wait for the first message
      break;

    case 'message':
      if (!workingDir) {
        emit({ type: 'error', message: 'Service not started. Send "start" command first.' });
        return;
      }

      await processQuery(command.content, {
        model: currentModel,
        skipPermissions: true, // For now, skip permissions in SDK mode
        resumeSessionId: resumeSessionId || undefined,
      });
      // After first query, use the currentSessionId for subsequent queries
      // (the SDK creates a new session if we always pass resumeSessionId)
      if (currentSessionId && !resumeSessionId) {
        resumeSessionId = currentSessionId;
      }
      break;

    case 'interrupt':
      if (currentQuery) {
        // The SDK doesn't have a direct interrupt method on the generator
        // We'll set currentQuery to null to stop processing
        currentQuery = null;
        emit({ type: 'interrupted' });
      }
      break;

    case 'changeModel':
      currentModel = command.model;
      emit({ type: 'model_changed', model: currentModel });
      break;

    case 'stop':
      currentQuery = null;
      emit({ type: 'stopped' });
      process.exit(0);
      break;
  }
}

// Main entry point
async function main() {
  // Set up readline for stdin
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Signal that we're ready
  emit({ type: 'service_ready', version: '1.0.0' });

  // Process commands line by line
  rl.on('line', async (line) => {
    if (!line.trim()) return;

    try {
      const command = JSON.parse(line) as Command;
      await handleCommand(command);
    } catch (error) {
      emit({
        type: 'error',
        message: `Failed to parse command: ${error instanceof Error ? error.message : String(error)}`,
        raw: line,
      });
    }
  });

  // Handle stdin close
  rl.on('close', () => {
    logError('stdin closed, exiting');
    process.exit(0);
  });
}

main().catch((error) => {
  logError(`Fatal error: ${error}`);
  process.exit(1);
});

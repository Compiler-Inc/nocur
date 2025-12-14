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
import {
  ACEManager,
  createACEManager,
  extractUsedBullets,
  Playbook,
} from './ace/index.js';
import { getLSPManager, resetLSPManager, createLSPTools } from './lsp/index.js';

// Types for stdin commands
interface StartCommand {
  type: 'start';
  workingDir: string;
  model?: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  skipPermissions?: boolean;
  // ACE: Project ID for playbook lookup (calculated by Rust using its hash algorithm)
  projectId?: string;
  // ACE: Alternatively, pass the full playbook directly
  playbook?: Playbook;
}

interface MessageCommand {
  type: 'message';
  content: string;
  agentMode?: 'build' | 'plan';
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


// Plan mode system prompt - instructs Claude to be read-only
const PLAN_MODE_PROMPT = `# Plan Mode - READ-ONLY

You are in PLAN mode. You must NOT make any changes to files or the system.

## STRICTLY FORBIDDEN in Plan Mode:
- ANY file edits or writes (Edit tool, Write tool)
- Running bash commands that modify state (git commit, git push, npm install, rm, mv, mkdir, touch, etc.)
- Creating or deleting files
- Making any changes to the codebase

## You MAY in Plan Mode:
- Read and analyze files (Read tool)
- Search the codebase (Glob, Grep tools)
- Run read-only commands (git diff, git log, git status, git show, ls, cat, head, tail, grep, find, wc, pwd)
- Provide detailed analysis and recommendations
- Create comprehensive implementation plans
- Ask clarifying questions

## Your Role in Plan Mode:
Think deeply, analyze thoroughly, and create a comprehensive plan. Present your analysis clearly with:
1. Understanding of the current state
2. Proposed changes with reasoning
3. Potential risks or considerations
4. Step-by-step implementation plan

The user will switch to Build mode when ready to implement your plan.`;

// Patterns for allowed read-only bash commands in plan mode
const PLAN_MODE_ALLOWED_BASH_PATTERNS = [
  /^git\s+(diff|log|status|show|branch|remote|rev-parse)/,
  /^ls\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^grep\b/,
  /^rg\b/,
  /^find\b/,
  /^wc\b/,
  /^file\b/,
  /^pwd$/,
  /^echo\b/,
  /^which\b/,
  /^type\b/,
  /^stat\b/,
  /^du\b/,
  /^tree\b/,
];

function isCommandAllowedInPlanMode(command: string): boolean {
  return PLAN_MODE_ALLOWED_BASH_PATTERNS.some(pattern => pattern.test(command.trim()));
}

// Service state
let currentQuery: AsyncGenerator<unknown, void, unknown> | null = null;
let currentSessionId: string | null = null;
let resumeSessionId: string | null = null;
let currentModel: string = 'sonnet';
let workingDir: string = process.cwd();
let nocurSwiftPath: string = '';

// ACE (Agentic Context Engineering) state
let aceManager: ACEManager | null = null;
let currentPlaybook: Playbook | null = null;
let aceEnabled: boolean = true; // Can be toggled via command

// Helper to emit events to stdout
function emit(event: OutputEvent) {
  console.log(JSON.stringify(event));
}

// Helper to log errors to stderr (won't interfere with JSON protocol)
function logError(message: string) {
  console.error(`[claude-service] ${message}`);
}

// CRITICAL: Strict token budget to NEVER exceed context limits
// Rule: ~4 chars = 1 token. 200K context, reserve 50K for response = 150K for conversation
// But compaction happens at 95%, and we want buffer. So limit tool outputs aggressively.
const MAX_TOOL_OUTPUT_CHARS = 4000; // ~1000 tokens per tool output MAX
const MAX_TOOL_OUTPUT_TOKENS = 1000;

// Estimate tokens (rough: 4 chars = 1 token for English, 3 for code/JSON)
function estimateTokens(text: string): number {
  // JSON/code is denser, use 3 chars per token
  const isStructured = text.startsWith('{') || text.startsWith('[') || text.includes('function');
  return Math.ceil(text.length / (isStructured ? 3 : 4));
}

function truncateOutput(output: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (output.length <= maxChars) return output;

  const estimatedTokens = estimateTokens(output);

  // For base64 images - NEVER include, always use file paths
  if (output.includes('data:image') || /^[A-Za-z0-9+/=]{500,}/.test(output)) {
    return `[IMAGE DATA BLOCKED - ${Math.round(output.length / 1024)}KB / ~${estimatedTokens} tokens. Images must be saved to files.]`;
  }

  // For JSON, try to truncate gracefully
  if (output.startsWith('{') || output.startsWith('[')) {
    const truncated = output.slice(0, maxChars - 150);
    return truncated + `\n... [TRUNCATED from ${output.length} chars / ~${estimatedTokens} tokens]`;
  }

  return output.slice(0, maxChars - 100) + `\n... [TRUNCATED from ~${estimatedTokens} tokens]`;
}

// Save base64 image to temp file and return path instead of raw data
// Also emits event so frontend can display the screenshot
async function saveImageToTemp(input: string): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');

  // Input might be JSON from nocur-swift or raw base64
  let base64Data = input;

  // Try to parse as JSON (nocur-swift output format)
  try {
    const parsed = JSON.parse(input);
    if (parsed.data?.base64) {
      base64Data = parsed.data.base64;
    } else if (parsed.base64) {
      base64Data = parsed.base64;
    }
  } catch {
    // Not JSON, assume raw base64 or data URL
  }

  // Extract actual base64 if it has data URL prefix
  let imageData = base64Data;
  if (base64Data.includes(',')) {
    imageData = base64Data.split(',')[1];
  }

  const tempDir = os.tmpdir();
  const filename = `nocur-screenshot-${Date.now()}.jpg`;
  const filepath = path.join(tempDir, filename);

  await fs.writeFile(filepath, Buffer.from(imageData, 'base64'));

  // Emit screenshot event with just the filepath (NOT the huge base64 data)
  // Frontend should read the file if it wants to display it
  emit({
    type: 'agent_screenshot',
    filepath,
  });

  return filepath;
}

// Create nocur-swift MCP tools server
function createNocurSwiftServer(_swiftPath: string) {
  // Initialize LSP manager with progress callback
  const lspManager = getLSPManager({
    onProgress: (msg) => emit({ type: 'lsp_progress', message: msg }),
    onError: (msg) => logError(`[LSP] ${msg}`),
  });

  // Create LSP tools
  const lspTools = createLSPTools(lspManager, workingDir);

  return createSdkMcpServer({
    name: 'nocur-swift',
    version: '1.0.0',
    tools: [
      // Screenshot tool - saves to file to avoid context bloat
      tool(
        'sim_screenshot',
        'Take a screenshot of the iOS simulator. Returns file path to the saved image.',
        {
          base64: z.boolean().optional().describe('Ignored - always saves to file'),
        },
        async (_args: { base64?: boolean }) => {
          const result = await runNocurSwift(['sim', 'screenshot', '--base64']);
          if (!result.success) {
            return { isError: true, content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
          }
          try {
            const filepath = await saveImageToTemp(result.output);
            return { content: [{ type: 'text' as const, text: `Screenshot saved to: ${filepath}\nUse the Read tool to view this image.` }] };
          } catch (e) {
            return { isError: true, content: [{ type: 'text' as const, text: `ERROR: Screenshot captured but failed to save: ${e}` }] };
          }
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
          return toolResponse(result);
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
          return toolResponse(result);
        }
      ),

      // UI Interact (tap + screenshot in one call) - saves screenshot to file
      tool(
        'ui_interact',
        'Perform a UI action and capture screenshot. Returns file path to screenshot. Coordinates are logical points (same as ui_hierarchy output).',
        {
          tapX: z.number().optional().describe('X coordinate to tap (logical points, same as ui_hierarchy)'),
          tapY: z.number().optional().describe('Y coordinate to tap (logical points, same as ui_hierarchy)'),
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

          // Check for command failure first
          if (!result.success) {
            return { isError: true, content: [{ type: 'text' as const, text: `ERROR: UI interaction failed: ${result.error}` }] };
          }

          // Try to parse JSON result which contains screenshot
          try {
            const parsed = JSON.parse(result.output);
            if (parsed.screenshot) {
              const filepath = await saveImageToTemp(parsed.screenshot);
              const summary = {
                action: parsed.action || 'interact',
                success: parsed.success !== false,
                screenshotPath: filepath,
              };
              // If the action itself failed (e.g., element not found)
              if (parsed.success === false) {
                return { isError: true, content: [{ type: 'text' as const, text: `ERROR: Action failed: ${parsed.error || 'Unknown error'}\nScreenshot: ${filepath}` }] };
              }
              return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) + '\nUse Read tool to view the screenshot.' }] };
            }
          } catch {
            // Not JSON or no screenshot field
          }

          // Fallback: truncate raw output
          return toolResponse(result);
        }
      ),

      // UI Hierarchy - truncated to prevent context overflow
      tool(
        'ui_hierarchy',
        'Get the view hierarchy of the running iOS app (truncated)',
        {},
        async () => {
          const result = await runNocurSwift(['ui', 'hierarchy']);
          return toolResponse(result);
        }
      ),

      // UI Find - preferred over ui_hierarchy for targeted searches
      tool(
        'ui_find',
        'Find UI elements by text, type, or ID. More efficient than ui_hierarchy.',
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
          return toolResponse(result);
        }
      ),

      // App Build - output truncated to prevent context overflow
      tool(
        'app_build',
        'Build an Xcode project (output truncated)',
        {
          project: z.string().describe('Path to .xcodeproj or .xcworkspace'),
          scheme: z.string().optional().describe('Build scheme'),
        },
        async (args: { project: string; scheme?: string }) => {
          const cmdArgs = ['app', 'build', '--project', args.project];
          if (args.scheme) cmdArgs.push('--scheme', args.scheme);
          const result = await runNocurSwift(cmdArgs);
          return toolResponse(result);
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
          return toolResponse(result);
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
          return toolResponse(result);
        }
      ),

      // App Run (Build + Install + Launch) - USE THIS INSTEAD OF SEPARATE BUILD/LAUNCH
      tool(
        'app_run',
        'Build and run the app in simulator (like Xcode Run button). Ensures latest code changes are included. USE THIS instead of separate build/launch commands.',
        {
          project: z.string().optional().describe('Path to .xcodeproj or .xcworkspace (auto-detects if not specified)'),
          scheme: z.string().optional().describe('Scheme to build and run'),
          clean: z.boolean().optional().describe('Clean before building'),
        },
        async (args: { project?: string; scheme?: string; clean?: boolean }) => {
          const cmdArgs = ['app', 'run'];
          if (args.project) cmdArgs.push('--project', args.project);
          if (args.scheme) cmdArgs.push('--scheme', args.scheme);
          if (args.clean) cmdArgs.push('--clean');
          const result = await runNocurSwift(cmdArgs);
          return toolResponse(result);
        }
      ),

      // Project Add Files - CRITICAL for new Swift files to appear in Xcode
      tool(
        'project_add_files',
        'Add files to Xcode project. MUST be called after creating new Swift files with Write tool, or they won\'t appear in Xcode or be compiled.',
        {
          files: z.array(z.string()).describe('File paths to add to the project'),
          project: z.string().optional().describe('Path to .xcodeproj (auto-detects if not specified)'),
          target: z.string().optional().describe('Target name (uses first target if not specified)'),
          group: z.string().optional().describe('Group path in project (e.g., "Sources/Views")'),
        },
        async (args: { files: string[]; project?: string; target?: string; group?: string }) => {
          const cmdArgs = ['project', 'add-files', ...args.files];
          if (args.project) cmdArgs.push('--project', args.project);
          if (args.target) cmdArgs.push('--target', args.target);
          if (args.group) cmdArgs.push('--group', args.group);
          const result = await runNocurSwift(cmdArgs);
          return toolResponse(result);
        }
      ),

      // Analyze Project Structure - Learn conventions from existing code
      tool(
        'project_analyze',
        'Analyze existing project structure to learn conventions. Call BEFORE writing new code to understand patterns.',
        {
          directory: z.string().describe('Project directory to analyze'),
        },
        async (args: { directory: string }) => {
          const fs = await import('fs/promises');
          const path = await import('path');

          const stats = {
            folders: [] as string[],
            fileCounts: {} as Record<string, number>,
            avgFileLines: 0,
            maxFileLines: 0,
            namingPatterns: [] as string[],
            structure: [] as string[],
          };

          const fileSizes: number[] = [];

          async function scan(dir: string, depth = 0): Promise<void> {
            if (depth > 3) return; // Don't go too deep
            try {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'DerivedData' || entry.name === 'build') continue;

                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(args.directory, fullPath);

                if (entry.isDirectory()) {
                  stats.folders.push(relativePath);
                  stats.structure.push('  '.repeat(depth) + '📁 ' + entry.name + '/');
                  await scan(fullPath, depth + 1);
                } else if (entry.name.endsWith('.swift')) {
                  const content = await fs.readFile(fullPath, 'utf-8');
                  const lines = content.split('\n').length;
                  fileSizes.push(lines);
                  stats.maxFileLines = Math.max(stats.maxFileLines, lines);

                  // Track folder file counts
                  const folder = path.dirname(relativePath) || 'root';
                  stats.fileCounts[folder] = (stats.fileCounts[folder] || 0) + 1;

                  stats.structure.push('  '.repeat(depth) + '📄 ' + entry.name + ' (' + lines + ' lines)');
                }
              }
            } catch { /* ignore errors */ }
          }

          await scan(args.directory);

          stats.avgFileLines = fileSizes.length > 0 ? Math.round(fileSizes.reduce((a, b) => a + b, 0) / fileSizes.length) : 0;

          // Detect naming patterns
          if (stats.folders.some(f => f.includes('Views'))) stats.namingPatterns.push('Views/ folder for UI');
          if (stats.folders.some(f => f.includes('ViewModels'))) stats.namingPatterns.push('ViewModels/ folder for MVVM');
          if (stats.folders.some(f => f.includes('Services'))) stats.namingPatterns.push('Services/ folder for business logic');
          if (stats.folders.some(f => f.includes('Models'))) stats.namingPatterns.push('Models/ folder for data types');
          if (stats.folders.some(f => f.includes('Components'))) stats.namingPatterns.push('Components/ folder for reusable UI');

          const response = [
            '=== PROJECT STRUCTURE ===',
            '',
            stats.structure.join('\n'),
            '',
            '=== CONVENTIONS TO FOLLOW ===',
            '',
            'File sizes: avg ' + stats.avgFileLines + ' lines, max ' + stats.maxFileLines + ' lines',
            'Keep new files similar in size.',
            '',
            'Folder patterns found:',
            ...stats.namingPatterns.map(p => '  • ' + p),
            '',
            'When creating new files:',
            '  • Match existing folder organization',
            '  • Keep file sizes consistent with project (~' + stats.avgFileLines + ' lines)',
            '  • Follow existing naming conventions',
          ].join('\n');

          return { content: [{ type: 'text' as const, text: response }] };
        }
      ),

      // Verify Implementation - Test with novel inputs
      tool(
        'verify_implementation',
        'Test an implementation with novel/random inputs to prove it actually works. Call after implementing any feature.',
        {
          description: z.string().describe('What was implemented'),
          testInputs: z.array(z.string()).describe('Novel test inputs to try (should be unique, not obvious patterns)'),
        },
        async (args: { description: string; testInputs: string[] }) => {
          // This tool just returns guidance - the agent must actually run the tests
          const response = [
            '=== VERIFICATION REQUIRED ===',
            '',
            'Implementation: ' + args.description,
            '',
            'You must now test with these novel inputs:',
            ...args.testInputs.map((input, i) => (i + 1) + '. "' + input + '"'),
            '',
            'For EACH input:',
            '1. Use ui_interact to enter the input',
            '2. Take a screenshot of the result',
            '3. Check: Does the response make sense for THIS SPECIFIC input?',
            '4. If responses are generic or identical regardless of input = FAKE',
            '',
            'A real implementation will give DIFFERENT, RELEVANT responses to different inputs.',
            'A fake implementation will give similar/generic responses regardless of input.',
            '',
            'Report your findings with screenshots as evidence.',
          ].join('\n');

          return { content: [{ type: 'text' as const, text: response }] };
        }
      ),

      // Sim Observe - Screenshot sequence, saves to files
      tool(
        'sim_observe',
        'Observe simulator over time. Captures multiple screenshots (saved to files). Returns file paths.',
        {
          duration: z.number().describe('Duration in seconds (max 5)'),
          frames: z.number().optional().describe('Number of frames to capture (default: 3, max: 5)'),
        },
        async (args: { duration: number; frames?: number }) => {
          // Limit frames to prevent context explosion
          const maxFrames = Math.min(args.frames || 3, 5);
          const cmdArgs = ['sim', 'observe', '--duration', String(Math.min(args.duration, 5)), '--frames', String(maxFrames)];
          const result = await runNocurSwift(cmdArgs);

          if (!result.success) {
            return { isError: true, content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }] };
          }

          // Try to parse and save each frame to a file
          try {
            const parsed = JSON.parse(result.output);
            if (parsed.frames && Array.isArray(parsed.frames)) {
              const savedPaths: string[] = [];
              for (const frame of parsed.frames.slice(0, 5)) {
                if (frame.image) {
                  const path = await saveImageToTemp(frame.image);
                  savedPaths.push(path);
                }
              }
              return { content: [{ type: 'text' as const, text: `Captured ${savedPaths.length} frames:\n${savedPaths.map((p, i) => `Frame ${i + 1}: ${p}`).join('\n')}\nUse Read tool to view these images.` }] };
            }
          } catch {
            // Not JSON format
          }

          return toolResponse(result);
        }
      ),

      // Sim Diff - Compare current screen to reference
      tool(
        'sim_diff',
        'Compare current simulator screen to a reference screenshot. Useful for verifying UI changes were applied correctly.',
        {
          reference: z.string().describe('Path to reference screenshot to compare against'),
          threshold: z.number().optional().describe('Minimum change percentage to report (default: 5)'),
        },
        async (args: { reference: string; threshold?: number }) => {
          const cmdArgs = ['sim', 'diff', args.reference];
          if (args.threshold !== undefined) cmdArgs.push('--threshold', String(args.threshold));
          const result = await runNocurSwift(cmdArgs);
          return toolResponse(result);
        }
      ),

      // App Debug - Get React app debug state
      tool(
        'app_debug',
        'Get Nocur app debug state including React component render counts, memory usage, recent errors, and last user interaction. Use this to diagnose performance issues or understand app behavior.',
        {},
        async () => {
          const debugPath = '/tmp/nocur-debug.json';
          try {
            const fs = await import('fs/promises');
            const content = await fs.readFile(debugPath, 'utf-8');
            const debug = JSON.parse(content);
            // Format for readability
            const summary = [
              `=== Nocur App Debug State ===`,
              `Timestamp: ${new Date(debug.timestamp).toISOString()}`,
              ``,
              `--- Render Stats ---`,
              `Total renders: ${debug.totalRenders}`,
              `Top re-rendering components:`,
              ...(debug.topRerenders?.slice(0, 10).map((r: { component: string; count: number }) =>
                `  ${r.component}: ${r.count} renders`
              ) || ['  (none tracked)']),
              ``,
              `--- Memory ---`,
              debug.memory
                ? `Used: ${debug.memory.usedMB}MB / Total: ${debug.memory.totalMB}MB / Limit: ${debug.memory.limitMB}MB`
                : 'Memory info not available',
              ``,
              `--- Last Interaction ---`,
              debug.lastInteraction
                ? `${debug.lastInteraction.type} at ${new Date(debug.lastInteraction.timestamp).toISOString()}${debug.lastInteraction.details ? `: ${debug.lastInteraction.details}` : ''}`
                : 'No interaction recorded',
              ``,
              `--- Recent Errors ---`,
              debug.recentErrors?.length > 0
                ? debug.recentErrors.map((e: { message: string; timestamp: number }) => `  [${new Date(e.timestamp).toISOString()}] ${e.message}`).join('\n')
                : '  (no errors)',
            ].join('\n');
            return { content: [{ type: 'text' as const, text: summary }] };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: `Debug file not found or unreadable. Is Nocur running in dev mode? Error: ${e}` }] };
          }
        }
      ),

      // Sim Logs - Capture simulator logs
      tool(
        'sim_logs',
        'Capture logs from the iOS simulator. Filter by bundle ID or process name. Use this to debug runtime errors, view print statements, and monitor app behavior.',
        {
          bundleId: z.string().optional().describe('Filter logs by bundle ID (e.g., com.example.app)'),
          process: z.string().optional().describe('Filter logs by process name'),
          duration: z.number().optional().describe('Capture duration in seconds (default: 5, max: 30)'),
          level: z.enum(['default', 'info', 'debug']).optional().describe('Log level filter (default: default)'),
        },
        async (args: { bundleId?: string; process?: string; duration?: number; level?: 'default' | 'info' | 'debug' }) => {
          const cmdArgs = ['sim', 'logs'];
          if (args.bundleId) cmdArgs.push('--bundle-id', args.bundleId);
          if (args.process) cmdArgs.push('--process', args.process);
          if (args.duration) cmdArgs.push('--duration', String(Math.min(args.duration, 30)));
          if (args.level) cmdArgs.push('--level', args.level);
          const result = await runNocurSwift(cmdArgs);
          return toolResponse(result);
        }
      ),

      // App Crashes - List and view crash reports
      tool(
        'app_crashes',
        'List and view crash reports from the iOS simulator. Use this to understand why an app crashed.',
        {
          bundleId: z.string().optional().describe('Filter crashes by bundle ID'),
          show: z.string().optional().describe('Show detailed crash report by name (from list)'),
          limit: z.number().optional().describe('Maximum number of crashes to list (default: 10)'),
        },
        async (args: { bundleId?: string; show?: string; limit?: number }) => {
          const cmdArgs = ['app', 'crashes'];
          if (args.bundleId) cmdArgs.push('--bundle-id', args.bundleId);
          if (args.show) cmdArgs.push('--show', args.show);
          if (args.limit) cmdArgs.push('--limit', String(args.limit));
          const result = await runNocurSwift(cmdArgs);
          return toolResponse(result);
        }
      ),

      // App Context - Aggregated context for efficient agent understanding
      tool(
        'app_context',
        'Get app context: screenshot + UI elements. Only use when you need to SEE the app state. For code problems, just read the code instead.',
        {
          bundleId: z.string().optional().describe('Bundle ID for filtering logs (e.g., com.example.app)'),
          includeLogs: z.boolean().optional().describe('Include logs (default: false, adds 2s delay)'),
          includeHierarchy: z.boolean().optional().describe('Include full view hierarchy (default: false)'),
        },
        async (args: { bundleId?: string; includeLogs?: boolean; includeHierarchy?: boolean }) => {
          const context: {
            screenshotPath?: string;
            tappableElements: Array<{ label?: string; id?: string; type: string }>;
            hierarchySummary?: string;
            fullHierarchy?: unknown;
            recentLogs: Array<{ level: string; message: string; process: string }>;
            recentCrashes: number;
          } = {
            tappableElements: [],
            recentLogs: [],
            recentCrashes: 0,
          };

          // 1. Take screenshot (saves to file)
          emit({ type: 'tool_progress', toolName: 'app_context', step: 1, total: 4, message: 'Taking screenshot...' });
          try {
            const screenshotResult = await runNocurSwift(['sim', 'screenshot', '--base64']);
            if (screenshotResult.success) {
              const filepath = await saveImageToTemp(screenshotResult.output);
              context.screenshotPath = filepath;
            }
          } catch { /* ignore screenshot errors */ }

          // 2. Get view hierarchy for tappable elements
          emit({ type: 'tool_progress', toolName: 'app_context', step: 2, total: 4, message: 'Getting UI hierarchy...' });
          try {
            const hierarchyResult = await runNocurSwift(['ui', 'hierarchy']);
            if (hierarchyResult.success) {
              const parsed = JSON.parse(hierarchyResult.output);
              if (args.includeHierarchy) {
                context.fullHierarchy = parsed;
              }

              // Extract tappable elements (buttons, cells, etc.)
              const extractTappable = (node: Record<string, unknown>): void => {
                const type = node.className as string || node.type as string || '';
                const label = node.accessibilityLabel as string || node.AXLabel as string;
                const id = node.accessibilityIdentifier as string || node.AXUniqueId as string;
                const isEnabled = node.isEnabled !== false && node.enabled !== false;

                // Include buttons, cells, and elements with labels/IDs
                if (isEnabled && (type.includes('Button') || type.includes('Cell') || label || id)) {
                  context.tappableElements.push({
                    label: label || undefined,
                    id: id || undefined,
                    type: type,
                  });
                }

                // Recurse into children
                const children = (node.children || []) as Record<string, unknown>[];
                children.forEach(extractTappable);
              };

              if (parsed.data?.root) {
                extractTappable(parsed.data.root);
              } else if (parsed.success && parsed.data) {
                extractTappable(parsed.data);
              }

              // Create summary
              const buttonCount = context.tappableElements.filter(e => e.type.includes('Button')).length;
              const withLabels = context.tappableElements.filter(e => e.label).length;
              context.hierarchySummary = `Found ${context.tappableElements.length} tappable elements (${buttonCount} buttons, ${withLabels} with labels)`;
            }
          } catch { /* ignore hierarchy errors */ }

          // 3. Get recent logs (only if requested - adds 2s delay)
          if (args.includeLogs) {
            emit({ type: 'tool_progress', toolName: 'app_context', step: 3, total: 4, message: 'Capturing logs...' });
            try {
              const logArgs = ['sim', 'logs', '--duration', '2'];
              if (args.bundleId) logArgs.push('--bundle-id', args.bundleId);
              const logsResult = await runNocurSwift(logArgs);
              if (logsResult.success) {
                const parsed = JSON.parse(logsResult.output);
                if (parsed.data?.logs) {
                  // Keep only last 10 logs to avoid context bloat
                  context.recentLogs = parsed.data.logs.slice(-10).map((log: Record<string, string>) => ({
                    level: log.level || 'default',
                    message: (log.message || '').slice(0, 200),
                    process: log.process || 'unknown',
                  }));
                }
              }
            } catch { /* ignore log errors */ }
          }

          // 4. Check for recent crashes
          emit({ type: 'tool_progress', toolName: 'app_context', step: 4, total: 4, message: 'Checking crashes...' });
          try {
            const crashArgs = ['app', 'crashes', '--limit', '5'];
            if (args.bundleId) crashArgs.push('--bundle-id', args.bundleId);
            const crashResult = await runNocurSwift(crashArgs);
            if (crashResult.success) {
              const parsed = JSON.parse(crashResult.output);
              context.recentCrashes = parsed.data?.count || 0;
            }
          } catch { /* ignore crash errors */ }

          // Format output
          const output = [
            `=== App Context ===`,
            ``,
            `Screenshot: ${context.screenshotPath || 'Failed to capture'}`,
            `Use Read tool to view the screenshot.`,
            ``,
            `--- Tappable Elements (${context.tappableElements.length}) ---`,
            ...context.tappableElements.slice(0, 15).map(e => {
              const parts = [e.type];
              if (e.label) parts.push(`label="${e.label}"`);
              if (e.id) parts.push(`id="${e.id}"`);
              return `  ${parts.join(' | ')}`;
            }),
            context.tappableElements.length > 15 ? `  ... and ${context.tappableElements.length - 15} more` : '',
            ``,
            `--- Recent Logs (${context.recentLogs.length}) ---`,
            ...context.recentLogs.map(log => `  [${log.level}] ${log.process}: ${log.message.slice(0, 100)}`),
            context.recentLogs.length === 0 ? '  (no recent logs)' : '',
            ``,
            `Crashes: ${context.recentCrashes > 0 ? `${context.recentCrashes} found - use app_crashes for details` : 'None'}`,
          ].filter(Boolean).join('\n');

          return { content: [{ type: 'text' as const, text: output }] };
        }
      ),

      // LSP Tools for Swift code intelligence
      ...lspTools,
    ],
  });
}

// Result type for nocur-swift commands - NEVER throws, always returns result
interface NocurResult {
  success: boolean;
  output: string;
  error?: string;
}

// Helper to run nocur-swift commands - returns structured result, never throws
async function runNocurSwift(args: string[]): Promise<NocurResult> {
  return new Promise((resolve) => {
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
        resolve({ success: true, output: stdout });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: `Command failed (exit ${code}): ${stderr || stdout}`
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to execute: ${err.message}`
      });
    });
  });
}

// Helper to create tool response with proper error handling
function toolResponse(result: NocurResult, processor?: (output: string) => string) {
  if (!result.success) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `ERROR: ${result.error}` }]
    };
  }
  const output = processor ? processor(result.output) : result.output;
  return { content: [{ type: 'text' as const, text: truncateOutput(output) }] };
}

// Map model short names to full model IDs
// Using latest Claude 4.5 models as of Dec 2024
function resolveModel(model: string): string {
  const modelMap: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5-20250929',
    'opus': 'claude-opus-4-5-20251101',
    'haiku': 'claude-haiku-4-5-20251001',
  };
  return modelMap[model.toLowerCase()] || model;
}

// Process a query with the Agent SDK
async function processQuery(prompt: string, options: {
  model: string;
  systemPrompt?: string;
  resumeSessionId?: string;
  skipPermissions?: boolean;
  agentMode?: 'build' | 'plan';
}) {
  const nocurServer = createNocurSwiftServer(nocurSwiftPath);

  // Use Claude Code's built-in system prompt with minimal iOS-specific additions
  // This gives us all of Claude Code's battle-tested behavior
  const iosAppend = `
iOS simulator tools available: app_run, app_build, app_launch, app_kill, sim_screenshot, sim_logs, ui_interact, ui_hierarchy, ui_find, app_crashes, app_context, project_add_files, project_analyze, verify_implementation.

Swift LSP tools available for code intelligence: lsp_hover (get type info), lsp_definition (go to definition), lsp_references (find usages), lsp_symbols (file outline), lsp_diagnostics (compiler errors), lsp_workspace_symbol (search symbols). Use these to understand Swift code structure and types before making changes.

Use WebSearch for iOS 26 / post-2025 Apple APIs (not in training data).

After creating new .swift files, call project_add_files to add them to the Xcode project.`;

  // ACE: Build playbook context addition if enabled
  let acePromptAddition = '';
  let bulletsIncluded: string[] = [];

  if (aceEnabled && aceManager && currentPlaybook) {
    const aceResult = aceManager.getSystemPromptAddition(currentPlaybook);
    if (aceResult) {
      acePromptAddition = `\n\n${aceResult.promptAddition}`;
      bulletsIncluded = aceResult.bulletsIncluded;
      logError(`[ACE] Injected ${bulletsIncluded.length} bullets into context`);
    }
  }

  // Track task for potential reflection
  const taskStartTime = Date.now();
  let fullAssistantResponse = '';
  let queryOutcome: 'success' | 'failure' | 'unknown' = 'unknown';

  try {
    // Plan mode: inject read-only instructions
    const planModeAddition = options.agentMode === 'plan' ? PLAN_MODE_PROMPT : '';

    // Build the full append: iOS tools + custom prompt + ACE playbook + plan mode
    const fullAppend = [
      planModeAddition,  // Plan mode first so it takes precedence
      iosAppend,
      options.systemPrompt || '',
      acePromptAddition,
    ].filter(Boolean).join('\n\n');

    const queryOptions: Record<string, unknown> = {
      model: resolveModel(options.model),
      // Use Claude Code's preset system prompt instead of custom one
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: fullAppend,
      },
      settingSources: ['project'],  // Load CLAUDE.md from working directory
      mcpServers: { 'nocur-swift': nocurServer },
      // Context management - CRITICAL to prevent "prompt too long" errors
      maxOutputTokens: 16000,  // Limit per-response output (was 128000 - way too high)
      // No turn limit - let the agent work until it's done or hits context limits
      // The SDK will auto-compact conversation history to stay within context window
      // In plan mode, restrict to read-only tools
      allowedTools: options.agentMode === 'plan' ? [
        // Read-only tools for plan mode
        'Read', 'Glob', 'Grep', 'Bash',  // Bash will be filtered by command
        // Our nocur-swift MCP tools (read-only ones)
        'mcp__nocur-swift__sim_screenshot',
        'mcp__nocur-swift__sim_list',
        'mcp__nocur-swift__ui_hierarchy',
        'mcp__nocur-swift__ui_find',
        'mcp__nocur-swift__project_analyze',
        'mcp__nocur-swift__lsp_hover',
        'mcp__nocur-swift__lsp_definition',
        'mcp__nocur-swift__lsp_references',
        'mcp__nocur-swift__lsp_symbols',
        'mcp__nocur-swift__lsp_diagnostics',
        'mcp__nocur-swift__lsp_workspace_symbol',
        // Web search
        'WebSearch',
      ] : [
        // Standard Claude Code tools
        'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
        // Our nocur-swift MCP tools
        'mcp__nocur-swift__sim_screenshot',
        'mcp__nocur-swift__sim_list',
        'mcp__nocur-swift__sim_boot',
        'mcp__nocur-swift__sim_observe',
        'mcp__nocur-swift__sim_diff',
        'mcp__nocur-swift__sim_logs',
        'mcp__nocur-swift__ui_interact',
        'mcp__nocur-swift__ui_hierarchy',
        'mcp__nocur-swift__ui_find',
        'mcp__nocur-swift__app_build',
        'mcp__nocur-swift__app_run',
        'mcp__nocur-swift__app_launch',
        'mcp__nocur-swift__app_kill',
        'mcp__nocur-swift__app_crashes',
        'mcp__nocur-swift__app_context',
        'mcp__nocur-swift__project_add_files',
        'mcp__nocur-swift__project_analyze',
        'mcp__nocur-swift__verify_implementation',
        // LSP tools for Swift code intelligence
        'mcp__nocur-swift__lsp_hover',
        'mcp__nocur-swift__lsp_definition',
        'mcp__nocur-swift__lsp_references',
        'mcp__nocur-swift__lsp_symbols',
        'mcp__nocur-swift__lsp_diagnostics',
        'mcp__nocur-swift__lsp_workspace_symbol',
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

        // Extract usage from assistant message if available
        const usage = assistantMsg.usage as Record<string, number> | undefined;
        if (usage) {
          emit({
            type: 'usage',
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheCreationTokens: usage.cache_creation_input_tokens,
          });
        }

        for (const block of content) {
          if (block.type === 'text') {
            const text = block.text as string;
            fullAssistantResponse += text + '\n'; // Track for ACE bullet extraction
            emit({
              type: 'assistant',
              content: text,
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
        const subtype = msg.subtype as string;

        // Track outcome for ACE reflection
        if (subtype === 'end_turn' || subtype === 'success') {
          queryOutcome = 'success';
        } else if (subtype === 'error' || subtype === 'max_turns') {
          queryOutcome = 'failure';
        }

        emit({
          type: 'result',
          content: msg.result as string || '',
          subtype,
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

    // ACE: Extract used bullets from response and emit for tracking
    if (aceEnabled && bulletsIncluded.length > 0) {
      const usedBullets = extractUsedBullets(fullAssistantResponse);
      if (usedBullets.length > 0) {
        logError(`[ACE] Bullets used: ${usedBullets.join(', ')}`);
        emit({
          type: 'ace_bullets_used',
          bulletsUsed: usedBullets,
          bulletsIncluded,
          outcome: queryOutcome,
        });
      }
    }
  } catch (error) {
    queryOutcome = 'failure';
    emit({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    currentQuery = null;

    // ACE: Emit task completion for potential reflection
    if (aceEnabled && currentPlaybook && currentSessionId) {
      emit({
        type: 'ace_task_complete',
        sessionId: currentSessionId,
        task: prompt.slice(0, 500), // Truncate for logging
        outcome: queryOutcome,
        duration: Date.now() - taskStartTime,
      });
    }
  }
}

// Load playbook from local JSON file (mirroring Rust ace.rs storage)
// projectId must be provided by Rust since it uses a different hash algorithm
async function loadPlaybookFromStorage(projectId: string): Promise<Playbook | null> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');

  const aceDir = path.join(os.homedir(), '.config/nocur/ace/playbooks');
  const playbookPath = path.join(aceDir, `${projectId}.json`);

  try {
    const content = await fs.readFile(playbookPath, 'utf-8');
    return JSON.parse(content) as Playbook;
  } catch {
    // No playbook exists yet - that's OK
    return null;
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

      // Initialize ACE
      aceManager = createACEManager();
      aceEnabled = true; // Reset to true for new session

      try {
        // ACE: Load playbook - prefer direct playbook, then projectId lookup
        if (command.playbook) {
          currentPlaybook = command.playbook;
          logError(`[ACE] Using provided playbook with ${currentPlaybook.bullets.length} bullets`);
        } else if (command.projectId) {
          currentPlaybook = await loadPlaybookFromStorage(command.projectId);
          if (currentPlaybook) {
            logError(`[ACE] Loaded playbook with ${currentPlaybook.bullets.length} bullets for project ${command.projectId}`);
          } else {
            logError(`[ACE] No playbook found for project ${command.projectId}`);
          }
        } else {
          currentPlaybook = null;
          logError(`[ACE] No projectId provided, ACE disabled`);
        }

        // Check if ACE is enabled for this project
        if (currentPlaybook && !currentPlaybook.aceEnabled) {
          logError(`[ACE] Playbook loaded but ACE disabled for project`);
          aceEnabled = false;
        }
      } catch (e) {
        logError(`[ACE] Failed to load playbook: ${e}`);
        currentPlaybook = null;
      }

      emit({
        type: 'ready',
        workingDir,
        model: currentModel,
        resumeSessionId,
        aceEnabled: aceEnabled && (currentPlaybook?.aceEnabled ?? false),
        acePlaybookBullets: currentPlaybook?.bullets.length || 0,
      });

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
        agentMode: command.agentMode || 'build',
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
      // Clean up LSP manager
      await resetLSPManager();
      emit({ type: 'stopped' });
      process.exit(0);
      break;
  }
}

// Main entry point
async function main() {
  // Handle termination signals immediately
  // When Rust calls child.kill(), we get SIGTERM or SIGKILL
  // Exit immediately without waiting for async operations
  process.on('SIGTERM', () => {
    logError('Received SIGTERM, exiting immediately');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logError('Received SIGINT, exiting immediately');
    process.exit(0);
  });

  // Also handle uncaught exceptions to prevent hanging
  process.on('uncaughtException', (err) => {
    logError(`Uncaught exception: ${err}`);
    process.exit(1);
  });

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

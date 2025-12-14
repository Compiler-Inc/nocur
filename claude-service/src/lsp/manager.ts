/**
 * LSP Manager - Manages the sourcekit-lsp process lifecycle and JSON-RPC communication.
 * 
 * Key responsibilities:
 * - Start/stop sourcekit-lsp process
 * - Send JSON-RPC requests and await responses
 * - Handle server notifications (diagnostics, etc.)
 * - Track open documents
 * - Auto-restart on crash
 */

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  Diagnostic,
  encodeMessage,
  decodeMessages,
  isResponse,
  isNotification,
} from './protocol.js';
import { ensureXcodeProjectSupport, detectProjectType } from './xcode-setup.js';

// =============================================================================
// Types
// =============================================================================

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface LSPManagerOptions {
  /** Timeout for LSP requests in milliseconds (default: 30000) */
  requestTimeout?: number;
  /** Callback for progress messages */
  onProgress?: (message: string) => void;
  /** Callback for errors */
  onError?: (message: string) => void;
}

// =============================================================================
// LSP Manager
// =============================================================================

export class LSPManager {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private diagnosticsCache = new Map<string, Diagnostic[]>();
  private openDocuments = new Set<string>();
  private workspaceRoot: string | null = null;
  private initPromise: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private options: Required<LSPManagerOptions>;
  private isShuttingDown = false;

  constructor(options: LSPManagerOptions = {}) {
    this.options = {
      requestTimeout: options.requestTimeout ?? 30000,
      onProgress: options.onProgress ?? (() => {}),
      onError: options.onError ?? ((msg) => console.error('[LSP]', msg)),
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Ensure the LSP server is started and initialized for the given workspace.
   * This is idempotent - multiple calls will wait for the same initialization.
   */
  async ensureStarted(workspaceRoot: string): Promise<void> {
    // If already initializing for the same workspace, wait for that
    if (this.initPromise && this.workspaceRoot === workspaceRoot) {
      return this.initPromise;
    }

    // If initialized for a different workspace, stop first
    if (this.process && this.workspaceRoot !== workspaceRoot) {
      await this.stop();
    }

    // Start initialization
    this.workspaceRoot = workspaceRoot;
    this.initPromise = this.initialize(workspaceRoot);
    return this.initPromise;
  }

  /**
   * Check if the LSP server is running and initialized.
   */
  isRunning(): boolean {
    return this.process !== null && !this.isShuttingDown;
  }

  /**
   * Stop the LSP server gracefully.
   */
  async stop(): Promise<void> {
    if (!this.process || this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.options.onProgress('Stopping Swift language server...');

    try {
      // Send shutdown request
      await this.request('shutdown', {});
      // Send exit notification
      this.notify('exit', {});
    } catch {
      // Ignore errors during shutdown
    }

    // Give it a moment to exit gracefully
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 2000);

      if (this.process) {
        this.process.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });

    this.cleanup();
  }

  // ===========================================================================
  // Document Management
  // ===========================================================================

  /**
   * Open a document in the LSP server. Required before querying it.
   * Idempotent - won't re-open already open documents.
   */
  async openDocument(filePath: string): Promise<void> {
    const uri = this.pathToUri(filePath);
    
    if (this.openDocuments.has(uri)) {
      return;
    }

    // Read file content
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      throw new Error(`Failed to read file: ${filePath}`);
    }

    // Send didOpen notification
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'swift',
        version: 1,
        text: content,
      },
    });

    this.openDocuments.add(uri);
  }

  /**
   * Close a document in the LSP server.
   */
  closeDocument(filePath: string): void {
    const uri = this.pathToUri(filePath);
    
    if (!this.openDocuments.has(uri)) {
      return;
    }

    this.notify('textDocument/didClose', {
      textDocument: { uri },
    });

    this.openDocuments.delete(uri);
    this.diagnosticsCache.delete(uri);
  }

  /**
   * Notify the LSP server that a document changed (after editing).
   */
  async notifyDocumentChanged(filePath: string): Promise<void> {
    const uri = this.pathToUri(filePath);
    
    // If document was open, close and reopen with new content
    if (this.openDocuments.has(uri)) {
      this.openDocuments.delete(uri);
    }
    
    await this.openDocument(filePath);
  }

  /**
   * Get cached diagnostics for a file.
   */
  getDiagnostics(filePath: string): Diagnostic[] {
    const uri = this.pathToUri(filePath);
    return this.diagnosticsCache.get(uri) || [];
  }

  // ===========================================================================
  // JSON-RPC Communication
  // ===========================================================================

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.process || this.isShuttingDown) {
      throw new Error('LSP server is not running');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.options.requestTimeout}ms`));
      }, this.options.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
        method,
      });

      this.sendMessage(request);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  notify(method: string, params: unknown): void {
    if (!this.process || this.isShuttingDown) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.sendMessage(notification);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async initialize(workspaceRoot: string): Promise<void> {
    this.options.onProgress('Detecting project type...');
    
    // Detect project type and set up if needed
    const projectType = await detectProjectType(workspaceRoot);
    
    if (projectType === 'xcode') {
      await ensureXcodeProjectSupport(workspaceRoot, this.options.onProgress);
    } else if (projectType === 'unknown') {
      this.options.onProgress('No Swift package or Xcode project found. LSP may have limited functionality.');
    }

    // Find sourcekit-lsp
    const sourcekitPath = await this.findSourceKitLSP();
    
    this.options.onProgress('Starting Swift language server...');
    
    // Spawn sourcekit-lsp process
    this.process = spawn(sourcekitPath, [], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up stdout handler
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    // Set up stderr handler (log but don't fail)
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error('[sourcekit-lsp stderr]', msg);
      }
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      if (!this.isShuttingDown) {
        this.options.onError(`sourcekit-lsp exited unexpectedly with code ${code}`);
        this.cleanup();
      }
    });

    this.process.on('error', (err) => {
      this.options.onError(`sourcekit-lsp error: ${err.message}`);
      this.cleanup();
    });

    // Send initialize request
    this.options.onProgress('Initializing language server...');
    
    const initResult = await this.request('initialize', {
      processId: process.pid,
      rootUri: this.pathToUri(workspaceRoot),
      capabilities: {
        textDocument: {
          hover: {},
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: { relatedInformation: true },
          completion: { completionItem: { snippetSupport: false } },
        },
        workspace: {
          workspaceFolders: true,
          symbol: {},
        },
      },
      workspaceFolders: [
        {
          uri: this.pathToUri(workspaceRoot),
          name: path.basename(workspaceRoot),
        },
      ],
    });

    // Send initialized notification
    this.notify('initialized', {});

    this.options.onProgress('Swift language server ready. Indexing project...');
    
    // Prewarm by opening a few Swift files
    await this.prewarm(workspaceRoot);
    
    this.options.onProgress('Swift language server ready.');
    
    return initResult as Promise<void>;
  }

  private async prewarm(workspaceRoot: string): Promise<void> {
    // Find a few Swift files to open (triggers indexing)
    try {
      const swiftFiles = await this.findSwiftFiles(workspaceRoot, 5);

      // Open first 3 files to trigger indexing
      const filesToOpen = swiftFiles.slice(0, 3);
      for (const file of filesToOpen) {
        try {
          await this.openDocument(file);
        } catch {
          // Ignore errors opening individual files
        }
      }
    } catch {
      // Ignore errors during prewarm - it's optional
    }
  }

  /**
   * Simple recursive Swift file finder (no external dependencies)
   */
  private async findSwiftFiles(dir: string, limit: number, found: string[] = []): Promise<string[]> {
    if (found.length >= limit) return found;
    
    const ignoreDirs = ['DerivedData', '.build', 'Pods', 'node_modules', '.git', 'build'];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (found.length >= limit) break;
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await this.findSwiftFiles(fullPath, limit, found);
          }
        } else if (entry.name.endsWith('.swift')) {
          found.push(fullPath);
        }
      }
    } catch {
      // Ignore errors reading directories
    }
    
    return found;
  }

  private async findSourceKitLSP(): Promise<string> {
    // Try common locations
    const candidates = [
      '/usr/bin/sourcekit-lsp',
      '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp',
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Not found, try next
      }
    }

    // Try to find via xcrun
    try {
      const { execSync } = await import('child_process');
      const result = execSync('xcrun --find sourcekit-lsp', { encoding: 'utf-8' });
      const path = result.trim();
      if (path) {
        return path;
      }
    } catch {
      // xcrun failed
    }

    throw new Error(
      'sourcekit-lsp not found. Please ensure Xcode is installed and run: xcode-select --install'
    );
  }

  private sendMessage(message: JsonRpcMessage): void {
    if (!this.process?.stdin?.writable) {
      return;
    }

    const encoded = encodeMessage(message);
    this.process.stdin.write(encoded);
  }

  private handleData(data: Buffer): void {
    // Append to buffer
    this.buffer = Buffer.concat([this.buffer, data]) as Buffer<ArrayBuffer>;

    // Parse complete messages
    const { messages, remaining } = decodeMessages(this.buffer);
    this.buffer = remaining as Buffer<ArrayBuffer>;

    for (const message of messages) {
      this.handleMessage(message);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (isResponse(message)) {
      // Handle response to a pending request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timer);

        if (message.error) {
          pending.reject(new Error(`LSP error: ${message.error.message} (code: ${message.error.code})`));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (isNotification(message)) {
      // Handle server notifications
      this.handleNotification(message);
    }
    // Ignore requests from server (we don't handle them)
  }

  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'textDocument/publishDiagnostics': {
        const params = notification.params as { uri: string; diagnostics: Diagnostic[] };
        if (params?.uri && params?.diagnostics) {
          this.diagnosticsCache.set(params.uri, params.diagnostics);
        }
        break;
      }
      case 'window/logMessage':
      case 'window/showMessage': {
        // Log server messages for debugging
        const params = notification.params as { type: number; message: string };
        if (params?.message) {
          console.log('[sourcekit-lsp]', params.message);
        }
        break;
      }
      // Ignore other notifications
    }
  }

  private cleanup(): void {
    this.isShuttingDown = false;
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('LSP server shut down'));
    }
    this.pendingRequests.clear();

    // Clear state
    this.process = null;
    this.initPromise = null;
    this.openDocuments.clear();
    this.diagnosticsCache.clear();
    this.buffer = Buffer.alloc(0);
  }

  private pathToUri(filePath: string): string {
    // Convert file path to file:// URI
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    return `file://${absolutePath}`;
  }

  /**
   * Convert file:// URI to file path
   */
  uriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
      return uri.slice(7);
    }
    return uri;
  }
}

// =============================================================================
// Factory
// =============================================================================

let sharedManager: LSPManager | null = null;

/**
 * Get or create the shared LSP manager instance.
 */
export function getLSPManager(options?: LSPManagerOptions): LSPManager {
  if (!sharedManager) {
    sharedManager = new LSPManager(options);
  }
  return sharedManager;
}

/**
 * Reset the shared LSP manager (for testing or cleanup).
 */
export async function resetLSPManager(): Promise<void> {
  if (sharedManager) {
    await sharedManager.stop();
    sharedManager = null;
  }
}

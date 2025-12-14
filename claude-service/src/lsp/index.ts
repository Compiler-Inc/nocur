/**
 * LSP Module - Swift Language Server Protocol integration
 * 
 * Provides sourcekit-lsp capabilities as MCP tools for the coding agent.
 */

export { LSPManager, getLSPManager, resetLSPManager } from './manager.js';
export type { LSPManagerOptions } from './manager.js';
export { createLSPTools } from './tools.js';
export { detectProjectType, ensureXcodeProjectSupport } from './xcode-setup.js';
export type { ProjectType } from './xcode-setup.js';

// Re-export useful protocol types
export type {
  Diagnostic,
  DiagnosticSeverity,
  Location,
  Position,
  Range,
  DocumentSymbol,
  SymbolInformation,
  SymbolKind,
  Hover,
} from './protocol.js';

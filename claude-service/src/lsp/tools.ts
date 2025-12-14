/**
 * LSP MCP Tools - Expose sourcekit-lsp capabilities as MCP tools for the coding agent.
 */

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'path';
import { LSPManager } from './manager.js';
import {
  Location,
  DocumentSymbol,
  SymbolInformation,
  Hover,
  Diagnostic,
  MarkupContent,
  symbolKindName,
  severityName,
  DiagnosticSeverity,
} from './protocol.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format hover result for display.
 */
function formatHover(hover: Hover | null): string {
  if (!hover) {
    return 'No information available at this position.';
  }

  let content: string;
  if (typeof hover.contents === 'string') {
    content = hover.contents;
  } else {
    content = (hover.contents as MarkupContent).value;
  }

  // Clean up markdown code blocks for readability
  content = content.trim();
  
  return content;
}

/**
 * Format location result for display.
 */
function formatLocation(loc: Location): string {
  const filePath = loc.uri.replace('file://', '');
  const line = loc.range.start.line + 1; // Convert to 1-indexed
  const char = loc.range.start.character;
  return `${filePath}:${line}:${char}`;
}

/**
 * Format locations list for display.
 */
function formatLocations(locations: Location[] | Location | null): string {
  if (!locations) {
    return 'No results found.';
  }

  const locs = Array.isArray(locations) ? locations : [locations];
  
  if (locs.length === 0) {
    return 'No results found.';
  }

  return locs.map((loc, i) => `${i + 1}. ${formatLocation(loc)}`).join('\n');
}

/**
 * Format document symbols as an outline.
 */
function formatSymbols(symbols: DocumentSymbol[], indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const sym of symbols) {
    const kind = symbolKindName(sym.kind);
    const line = sym.range.start.line + 1;
    const detail = sym.detail ? ` - ${sym.detail}` : '';
    lines.push(`${prefix}${kind}: ${sym.name}${detail} (line ${line})`);
    
    if (sym.children && sym.children.length > 0) {
      lines.push(formatSymbols(sym.children, indent + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Format workspace symbols.
 */
function formatWorkspaceSymbols(symbols: SymbolInformation[]): string {
  if (symbols.length === 0) {
    return 'No symbols found.';
  }

  const lines = symbols.map((sym, i) => {
    const kind = symbolKindName(sym.kind);
    const loc = formatLocation(sym.location);
    const container = sym.containerName ? ` in ${sym.containerName}` : '';
    return `${i + 1}. ${kind}: ${sym.name}${container}\n   ${loc}`;
  });

  return lines.join('\n');
}

/**
 * Format diagnostics.
 */
function formatDiagnostics(diagnostics: Diagnostic[], filePath: string): string {
  if (diagnostics.length === 0) {
    return `No issues found in ${path.basename(filePath)}.`;
  }

  // Sort by severity (errors first) then by line
  const sorted = [...diagnostics].sort((a, b) => {
    const sevA = a.severity ?? DiagnosticSeverity.Information;
    const sevB = b.severity ?? DiagnosticSeverity.Information;
    if (sevA !== sevB) return sevA - sevB;
    return a.range.start.line - b.range.start.line;
  });

  const lines = sorted.map((diag) => {
    const severity = severityName(diag.severity);
    const line = diag.range.start.line + 1;
    const char = diag.range.start.character;
    return `[${severity}] Line ${line}:${char}: ${diag.message}`;
  });

  const errorCount = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
  const warnCount = diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning).length;
  
  const summary = `Found ${errorCount} error(s), ${warnCount} warning(s) in ${path.basename(filePath)}:`;
  
  return `${summary}\n\n${lines.join('\n')}`;
}

// =============================================================================
// Tool Factory
// =============================================================================

/**
 * Create all LSP MCP tools.
 */
export function createLSPTools(lspManager: LSPManager, workingDir: string) {
  return [
    // =========================================================================
    // lsp_hover - Get type information and documentation
    // =========================================================================
    tool(
      'lsp_hover',
      'Get type information and documentation for a Swift symbol at a specific position. Use this to understand what type a variable is, what a function signature is, or read documentation.',
      {
        file: z.string().describe('Absolute path to Swift file'),
        line: z.number().describe('Line number (1-indexed, as shown in editors)'),
        character: z.number().describe('Character position in line (0-indexed)'),
      },
      async (args: { file: string; line: number; character: number }) => {
        try {
          await lspManager.ensureStarted(workingDir);
          await lspManager.openDocument(args.file);

          const result = await lspManager.request<Hover | null>('textDocument/hover', {
            textDocument: { uri: `file://${args.file}` },
            position: { line: args.line - 1, character: args.character },
          });

          return { content: [{ type: 'text' as const, text: formatHover(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    ),

    // =========================================================================
    // lsp_definition - Go to definition
    // =========================================================================
    tool(
      'lsp_definition',
      'Jump to the definition of a Swift symbol. Returns the file path and line where the symbol is defined. Use this to find where a function, type, or variable is declared.',
      {
        file: z.string().describe('Absolute path to Swift file'),
        line: z.number().describe('Line number (1-indexed)'),
        character: z.number().describe('Character position in line (0-indexed)'),
      },
      async (args: { file: string; line: number; character: number }) => {
        try {
          await lspManager.ensureStarted(workingDir);
          await lspManager.openDocument(args.file);

          const result = await lspManager.request<Location[] | Location | null>('textDocument/definition', {
            textDocument: { uri: `file://${args.file}` },
            position: { line: args.line - 1, character: args.character },
          });

          return { content: [{ type: 'text' as const, text: formatLocations(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    ),

    // =========================================================================
    // lsp_references - Find all references
    // =========================================================================
    tool(
      'lsp_references',
      'Find all locations where a Swift symbol is used. Use this to understand the impact of changes, find all usages of a function, or trace how a type is used across the codebase.',
      {
        file: z.string().describe('Absolute path to Swift file'),
        line: z.number().describe('Line number (1-indexed)'),
        character: z.number().describe('Character position in line (0-indexed)'),
        includeDeclaration: z.boolean().optional().describe('Include the declaration in results (default: true)'),
      },
      async (args: { file: string; line: number; character: number; includeDeclaration?: boolean }) => {
        try {
          await lspManager.ensureStarted(workingDir);
          await lspManager.openDocument(args.file);

          const result = await lspManager.request<Location[] | null>('textDocument/references', {
            textDocument: { uri: `file://${args.file}` },
            position: { line: args.line - 1, character: args.character },
            context: { includeDeclaration: args.includeDeclaration ?? true },
          });

          const locations = result || [];
          if (locations.length === 0) {
            return { content: [{ type: 'text' as const, text: 'No references found.' }] };
          }

          const text = `Found ${locations.length} reference(s):\n\n${formatLocations(locations)}`;
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    ),

    // =========================================================================
    // lsp_symbols - Document outline
    // =========================================================================
    tool(
      'lsp_symbols',
      'Get an outline of all symbols (classes, structs, functions, properties) in a Swift file. Use this to understand the structure of a file before diving into details.',
      {
        file: z.string().describe('Absolute path to Swift file'),
      },
      async (args: { file: string }) => {
        try {
          await lspManager.ensureStarted(workingDir);
          await lspManager.openDocument(args.file);

          const result = await lspManager.request<DocumentSymbol[] | null>('textDocument/documentSymbol', {
            textDocument: { uri: `file://${args.file}` },
          });

          const symbols = result || [];
          if (symbols.length === 0) {
            return { content: [{ type: 'text' as const, text: 'No symbols found in file.' }] };
          }

          const text = `Symbols in ${path.basename(args.file)}:\n\n${formatSymbols(symbols)}`;
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    ),

    // =========================================================================
    // lsp_diagnostics - Compiler errors and warnings
    // =========================================================================
    tool(
      'lsp_diagnostics',
      'Get compiler errors and warnings for a Swift file. Use this to check for issues before building, or to understand why code might not compile.',
      {
        file: z.string().describe('Absolute path to Swift file'),
      },
      async (args: { file: string }) => {
        try {
          await lspManager.ensureStarted(workingDir);
          await lspManager.openDocument(args.file);

          // Wait a moment for diagnostics to be published
          await new Promise(resolve => setTimeout(resolve, 500));

          const diagnostics = lspManager.getDiagnostics(args.file);
          const text = formatDiagnostics(diagnostics, args.file);
          
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    ),

    // =========================================================================
    // lsp_workspace_symbol - Search symbols across project
    // =========================================================================
    tool(
      'lsp_workspace_symbol',
      'Search for a symbol by name across the entire Swift project. Use this to find classes, functions, protocols, etc. by name when you don\'t know which file they\'re in.',
      {
        query: z.string().describe('Symbol name to search for (partial match supported)'),
      },
      async (args: { query: string }) => {
        try {
          await lspManager.ensureStarted(workingDir);

          const result = await lspManager.request<SymbolInformation[] | null>('workspace/symbol', {
            query: args.query,
          });

          const symbols = result || [];
          if (symbols.length === 0) {
            return { content: [{ type: 'text' as const, text: `No symbols found matching "${args.query}".` }] };
          }

          // Limit results to prevent overwhelming output
          const limited = symbols.slice(0, 20);
          const text = limited.length < symbols.length
            ? `Found ${symbols.length} symbols (showing first 20):\n\n${formatWorkspaceSymbols(limited)}`
            : `Found ${symbols.length} symbol(s):\n\n${formatWorkspaceSymbols(limited)}`;
          
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `ERROR: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    ),
  ];
}

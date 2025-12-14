/**
 * JSON-RPC protocol types and message framing for LSP communication.
 * 
 * LSP uses JSON-RPC 2.0 over stdin/stdout with Content-Length headers.
 */

// =============================================================================
// JSON-RPC Types
// =============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// =============================================================================
// LSP-Specific Types
// =============================================================================

export interface Position {
  line: number;      // 0-indexed
  character: number; // 0-indexed
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: number | string;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface SymbolInformation {
  name: string;
  kind: SymbolKind;
  location: Location;
  containerName?: string;
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface Hover {
  contents: MarkupContent | string;
  range?: Range;
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown';
  value: string;
}

// =============================================================================
// Message Framing
// =============================================================================

const CONTENT_LENGTH_HEADER = 'Content-Length: ';
const HEADER_DELIMITER = '\r\n\r\n';

/**
 * Encode a JSON-RPC message with Content-Length header for LSP protocol.
 */
export function encodeMessage(message: JsonRpcMessage): Buffer {
  const content = JSON.stringify(message);
  const contentLength = Buffer.byteLength(content, 'utf8');
  const header = `${CONTENT_LENGTH_HEADER}${contentLength}${HEADER_DELIMITER}`;
  return Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(content, 'utf8')]);
}

/**
 * Decode LSP messages from a buffer. Returns parsed messages and remaining buffer.
 * 
 * LSP messages are framed as:
 * Content-Length: <length>\r\n
 * \r\n
 * <json-content>
 */
export function decodeMessages(buffer: Buffer): { messages: JsonRpcMessage[]; remaining: Buffer } {
  const messages: JsonRpcMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Find header delimiter
    const headerEnd = buffer.indexOf(HEADER_DELIMITER, offset);
    if (headerEnd === -1) {
      // Incomplete header, need more data
      break;
    }

    // Parse Content-Length header
    const headerStr = buffer.subarray(offset, headerEnd).toString('utf8');
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Invalid header, skip this byte and try again
      offset++;
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const contentStart = headerEnd + HEADER_DELIMITER.length;
    const contentEnd = contentStart + contentLength;

    if (contentEnd > buffer.length) {
      // Incomplete content, need more data
      break;
    }

    // Parse JSON content
    const content = buffer.subarray(contentStart, contentEnd).toString('utf8');
    try {
      const message = JSON.parse(content) as JsonRpcMessage;
      messages.push(message);
    } catch (e) {
      // Invalid JSON, skip this message
      console.error('[LSP] Failed to parse JSON-RPC message:', e);
    }

    offset = contentEnd;
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
  };
}

/**
 * Check if a message is a response (has id and no method)
 */
export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && !('method' in msg);
}

/**
 * Check if a message is a notification (has method but no id)
 */
export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return 'method' in msg && !('id' in msg);
}

/**
 * Check if a message is a request (has both id and method)
 */
export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg;
}

/**
 * Get human-readable name for a symbol kind
 */
export function symbolKindName(kind: SymbolKind): string {
  const names: Record<SymbolKind, string> = {
    [SymbolKind.File]: 'File',
    [SymbolKind.Module]: 'Module',
    [SymbolKind.Namespace]: 'Namespace',
    [SymbolKind.Package]: 'Package',
    [SymbolKind.Class]: 'Class',
    [SymbolKind.Method]: 'Method',
    [SymbolKind.Property]: 'Property',
    [SymbolKind.Field]: 'Field',
    [SymbolKind.Constructor]: 'Constructor',
    [SymbolKind.Enum]: 'Enum',
    [SymbolKind.Interface]: 'Protocol',
    [SymbolKind.Function]: 'Function',
    [SymbolKind.Variable]: 'Variable',
    [SymbolKind.Constant]: 'Constant',
    [SymbolKind.String]: 'String',
    [SymbolKind.Number]: 'Number',
    [SymbolKind.Boolean]: 'Boolean',
    [SymbolKind.Array]: 'Array',
    [SymbolKind.Object]: 'Object',
    [SymbolKind.Key]: 'Key',
    [SymbolKind.Null]: 'Null',
    [SymbolKind.EnumMember]: 'EnumMember',
    [SymbolKind.Struct]: 'Struct',
    [SymbolKind.Event]: 'Event',
    [SymbolKind.Operator]: 'Operator',
    [SymbolKind.TypeParameter]: 'TypeParameter',
  };
  return names[kind] || 'Unknown';
}

/**
 * Get human-readable name for diagnostic severity
 */
export function severityName(severity: DiagnosticSeverity | undefined): string {
  switch (severity) {
    case DiagnosticSeverity.Error: return 'Error';
    case DiagnosticSeverity.Warning: return 'Warning';
    case DiagnosticSeverity.Information: return 'Info';
    case DiagnosticSeverity.Hint: return 'Hint';
    default: return 'Unknown';
  }
}

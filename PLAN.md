# Nocur Autonomous Agent Implementation Plan

## Executive Summary

Transform Nocur from a tool-assisted development environment into a fully autonomous iOS development agent that can:
1. Control the simulator like a human (computer use)
2. Automatically gather context (logs, crashes, view hierarchy)
3. Verify its own work through visual and structural inspection
4. Look up new APIs (iOS 26+) from documentation

---

## Current State Analysis

### What Works
- **Screenshots**: `sim_screenshot` captures simulator state
- **Basic UI interaction**: `ui_interact` can tap/type/scroll using coordinates
- **View hierarchy + element targeting**: `ui_hierarchy`, `ui_find`, `tapElement*` use idb accessibility data
- **Build/Launch**: `app_build`, `app_launch`, `app_kill` work
- **idb integration**: Already using Facebook's idb for touch input

### What's Broken/Missing

| Component | Current State | Problem |
|-----------|---------------|---------|
| **Logs** | Not implemented | No way to see app logs or errors |
| **Crash Detection** | Not implemented | No crash report capture |
| **New API Docs** | Not implemented | Agent can't look up iOS 26 APIs |
| **Verification loop** | Manual | No automatic action → screenshot → analyze → retry |

### Key Discovery

**idb already has everything we need:**

```bash
# Full accessibility tree with frames, labels, IDs
idb ui describe-all --json --nested

# Crash report list
idb crash list

# Real-time log streaming with filtering
idb log --json -- --style json --predicate 'processImagePath contains "MyApp"'
```

---

## Implementation Plan

### Phase 1: View Hierarchy + Targeting (Done)

**File**: `nocur-swift/Sources/Core/Introspection/ViewInspector.swift`

**Status**: Implemented using `idb ui describe-all --json --nested` (parsed into a structured accessibility tree).

**New Implementation**:
```swift
private func captureAccessibilityElements(udid: String) async throws -> [AccessibilityElement] {
    let output = try await shell("idb", "ui", "describe-all", "--udid", udid, "--json", "--nested")

    guard let data = output.data(using: .utf8),
          let json = try? JSONDecoder().decode([IdbAccessibilityNode].self, from: data) else {
        throw NocurError.parseError("Failed to parse idb accessibility output")
    }

    return flattenAccessibilityTree(json)
}

private func flattenAccessibilityTree(_ nodes: [IdbAccessibilityNode]) -> [AccessibilityElement] {
    var elements: [AccessibilityElement] = []

    for node in nodes {
        let element = AccessibilityElement(
            type: node.type,
            label: node.AXLabel,
            value: node.AXValue,
            identifier: node.AXUniqueId,
            frame: Frame(
                x: node.frame.x,
                y: node.frame.y,
                width: node.frame.width,
                height: node.frame.height
            ),
            isEnabled: node.enabled,
            role: node.role
        )
        elements.append(element)

        // Recursively add children
        if let children = node.children {
            elements.append(contentsOf: flattenAccessibilityTree(children))
        }
    }

    return elements
}
```

**New Data Model**:
```swift
struct IdbAccessibilityNode: Codable {
    let type: String
    let role: String
    let AXLabel: String?
    let AXValue: String?
    let AXUniqueId: String?
    let frame: IdbFrame
    let enabled: Bool
    let children: [IdbAccessibilityNode]?
}

struct IdbFrame: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}
```

**Exposed MCP Tool Output**:
```json
{
  "elements": [
    {
      "type": "Button",
      "label": "Send Message",
      "identifier": "send_button",
      "frame": {"x": 300, "y": 750, "width": 60, "height": 40},
      "enabled": true
    },
    {
      "type": "TextField",
      "label": null,
      "value": "Type your message...",
      "identifier": "message_input",
      "frame": {"x": 20, "y": 750, "width": 270, "height": 40},
      "enabled": true
    }
  ]
}
```

---

### Phase 2: Add Log Streaming

**New File**: `nocur-swift/Sources/Core/Logging/LogCapture.swift`

**Implementation**:
```swift
public final class LogCapture {

    /// Capture recent logs for a specific app
    public func captureLogs(
        bundleId: String?,
        processName: String?,
        simulatorUDID: String?,
        duration: Double = 5.0,
        level: String = "default"
    ) async throws -> LogCaptureResult {
        let udid = try await resolveSimulator(simulatorUDID)

        var predicate = ""
        if let bundleId = bundleId {
            predicate = "processImagePath contains '\(bundleId)'"
        } else if let processName = processName {
            predicate = "processImagePath contains '\(processName)'"
        }

        var args = ["idb", "log", "--udid", udid, "--json", "--", "--style", "json", "--timeout", "\(Int(duration))s"]
        if !predicate.isEmpty {
            args.append(contentsOf: ["--predicate", predicate])
        }

        let output = try await shell(args)
        let logs = parseLogOutput(output)

        return LogCaptureResult(
            logs: logs,
            duration: duration,
            filter: predicate.isEmpty ? nil : predicate
        )
    }

    private func parseLogOutput(_ output: String) -> [LogEntry] {
        // Parse JSON log entries
        var entries: [LogEntry] = []

        for line in output.components(separatedBy: "\n") {
            guard let data = line.data(using: .utf8),
                  let json = try? JSONDecoder().decode(IdbLogEntry.self, from: data) else {
                continue
            }

            entries.append(LogEntry(
                timestamp: json.timestamp,
                level: json.messageType,
                process: json.processImagePath?.components(separatedBy: "/").last ?? "unknown",
                message: json.eventMessage,
                subsystem: json.subsystem,
                category: json.category
            ))
        }

        return entries
    }
}
```

**New CLI Command**: `nocur-swift sim logs`
```bash
nocur-swift sim logs --bundle-id com.nocur.NocurTestApp --duration 5
```

**MCP Tool**:
```typescript
tool(
  'sim_logs',
  'Capture recent logs from the simulator. Filter by bundle ID or process name.',
  {
    bundleId: z.string().optional().describe('Filter logs by bundle ID'),
    processName: z.string().optional().describe('Filter logs by process name'),
    duration: z.number().optional().describe('Capture duration in seconds (default 5, max 30)'),
  },
  async (args) => {
    const result = await runNocurSwift(['sim', 'logs',
      ...(args.bundleId ? ['--bundle-id', args.bundleId] : []),
      ...(args.processName ? ['--process', args.processName] : []),
      '--duration', String(args.duration || 5),
    ]);
    return toolResponse(result);
  }
)
```

---

### Phase 3: Add Crash Detection

**New File**: `nocur-swift/Sources/Core/Crash/CrashReporter.swift`

**Implementation**:
```swift
public final class CrashReporter {

    /// List available crash reports
    public func listCrashes(simulatorUDID: String?) async throws -> CrashListResult {
        let udid = try await resolveSimulator(simulatorUDID)

        let output = try await shell("idb", "crash", "list", "--udid", udid)
        let crashes = parseCrashList(output)

        return CrashListResult(crashes: crashes)
    }

    /// Get details of a specific crash
    public func getCrashDetails(name: String, simulatorUDID: String?) async throws -> CrashDetails {
        let udid = try await resolveSimulator(simulatorUDID)

        let output = try await shell("idb", "crash", "show", "--udid", udid, name)

        return CrashDetails(
            name: name,
            content: output,
            // Parse stack trace, exception type, etc. from content
        )
    }

    /// Get recent crashes for a specific app
    public func getAppCrashes(
        bundleId: String?,
        processName: String?,
        simulatorUDID: String?,
        limit: Int = 5
    ) async throws -> [CrashInfo] {
        let list = try await listCrashes(simulatorUDID: simulatorUDID)

        var filtered = list.crashes

        if let bundleId = bundleId {
            filtered = filtered.filter { $0.bundleId == bundleId }
        }
        if let processName = processName {
            filtered = filtered.filter { $0.processName.contains(processName) }
        }

        // Sort by timestamp descending, take limit
        return Array(filtered.sorted { $0.timestamp > $1.timestamp }.prefix(limit))
    }
}
```

**New CLI Command**: `nocur-swift app crashes`
```bash
nocur-swift app crashes --bundle-id com.nocur.NocurTestApp
nocur-swift app crash-details --name "NocurTestApp-2025-12-06-070100.ips"
```

**MCP Tools**:
```typescript
tool(
  'app_crashes',
  'List recent crash reports for an app. Essential for debugging.',
  {
    bundleId: z.string().optional().describe('Filter by bundle ID'),
    processName: z.string().optional().describe('Filter by process name'),
    limit: z.number().optional().describe('Max crashes to return (default 5)'),
  },
  async (args) => { /* ... */ }
),

tool(
  'app_crash_details',
  'Get full details of a crash including stack trace.',
  {
    name: z.string().describe('Crash report name from app_crashes'),
  },
  async (args) => { /* ... */ }
)
```

---

### Phase 4: Update UIInteractor for Accessibility-Based Targeting

**File**: `nocur-swift/Sources/Core/Interaction/UIInteractor.swift`

**Current Problem**: `tapElement` and `tapElementByLabel` call `ViewInspector.findElements()` which returns empty array.

**Fix**: Use the new working `ViewInspector`:

```swift
public func tapElementByLabel(
    label: String,
    simulatorUDID: String?,
    tapCount: Int
) async throws -> TapResult {
    let udid = try await resolveSimulator(simulatorUDID)

    // Find element using WORKING view inspector
    let inspector = ViewInspector()
    let result = try await inspector.findElements(
        text: label,
        type: nil,
        identifier: nil,
        simulatorUDID: udid
    )

    guard let element = result.matches.first else {
        // Provide helpful error with available elements
        let allElements = try await inspector.findElements(
            text: nil, type: nil, identifier: nil, simulatorUDID: udid
        )
        let available = allElements.matches
            .compactMap { $0.label }
            .prefix(10)
            .joined(separator: ", ")

        throw NocurError.notFound(
            "Element '\(label)' not found. Available labels: \(available)"
        )
    }

    // Calculate center and tap
    let x = element.frame.x + element.frame.width / 2
    let y = element.frame.y + element.frame.height / 2

    return try await tap(x: x, y: y, simulatorUDID: udid, tapCount: tapCount)
}
```

---

### Phase 5: Enhanced ui_interact Tool

**Update MCP tool to support label/identifier targeting**:

```typescript
tool(
  'ui_interact',
  'Perform a UI action. Can target by coordinates, accessibility label, or identifier. Returns screenshot after action.',
  {
    action: z.enum(['tap', 'type', 'scroll']).describe('Action type'),
    // Targeting options (one required)
    x: z.number().optional().describe('X coordinate (device pixels)'),
    y: z.number().optional().describe('Y coordinate (device pixels)'),
    label: z.string().optional().describe('Accessibility label to tap'),
    identifier: z.string().optional().describe('Accessibility identifier to tap'),
    // Action parameters
    text: z.string().optional().describe('Text to type (for type action)'),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    clearFirst: z.boolean().optional().describe('Clear field before typing'),
  },
  async (args) => {
    const cmdArgs = ['ui', 'interact'];

    if (args.label) {
      cmdArgs.push('--tap-label', args.label);
    } else if (args.identifier) {
      cmdArgs.push('--tap-id', args.identifier);
    } else if (args.action === 'tap' && args.x !== undefined && args.y !== undefined) {
      cmdArgs.push('--tap', String(args.x), String(args.y));
    } else if (args.action === 'type' && args.text) {
      cmdArgs.push('--type', args.text);
      if (args.clearFirst) cmdArgs.push('--clear');
    } else if (args.action === 'scroll' && args.direction) {
      cmdArgs.push('--scroll', args.direction);
    }

    const result = await runNocurSwift(cmdArgs);
    // Save screenshot to file, return path
    if (result.success) {
      const parsed = JSON.parse(result.output);
      if (parsed.screenshot) {
        const filepath = await saveImageToTemp(parsed.screenshot);
        return { content: [{ type: 'text', text: `Action completed. Screenshot: ${filepath}` }] };
      }
    }
    return toolResponse(result);
  }
)
```

---

### Phase 6: Context Aggregation Tool

**New tool that combines multiple context sources**:

```typescript
tool(
  'app_context',
  'Get comprehensive app context: screenshot, view hierarchy, recent logs, and crashes. Use this to understand current app state.',
  {
    bundleId: z.string().optional().describe('App bundle ID'),
    includeLogs: z.boolean().optional().describe('Include recent logs (default true)'),
    includeCrashes: z.boolean().optional().describe('Include recent crashes (default true)'),
    includeHierarchy: z.boolean().optional().describe('Include view hierarchy (default true)'),
  },
  async (args) => {
    const results: string[] = [];

    // Screenshot
    const screenshot = await runNocurSwift(['sim', 'screenshot', '--base64']);
    if (screenshot.success) {
      const filepath = await saveImageToTemp(screenshot.output);
      results.push(`Screenshot: ${filepath}`);
    }

    // View Hierarchy
    if (args.includeHierarchy !== false) {
      const hierarchy = await runNocurSwift(['ui', 'find']);
      if (hierarchy.success) {
        results.push(`\nView Hierarchy:\n${truncateOutput(hierarchy.output)}`);
      }
    }

    // Logs
    if (args.includeLogs !== false) {
      const logs = await runNocurSwift(['sim', 'logs',
        ...(args.bundleId ? ['--bundle-id', args.bundleId] : []),
        '--duration', '3'
      ]);
      if (logs.success) {
        results.push(`\nRecent Logs:\n${truncateOutput(logs.output)}`);
      }
    }

    // Crashes
    if (args.includeCrashes !== false) {
      const crashes = await runNocurSwift(['app', 'crashes',
        ...(args.bundleId ? ['--bundle-id', args.bundleId] : []),
        '--limit', '3'
      ]);
      if (crashes.success) {
        results.push(`\nRecent Crashes:\n${truncateOutput(crashes.output)}`);
      }
    }

    return { content: [{ type: 'text', text: results.join('\n') }] };
  }
)
```

---

## File Changes Summary

### New Files
1. `nocur-swift/Sources/Core/Logging/LogCapture.swift` - Log streaming
2. `nocur-swift/Sources/Core/Crash/CrashReporter.swift` - Crash detection
3. `nocur-swift/Sources/CLI/Commands/LogCommands.swift` - CLI for logs
4. `nocur-swift/Sources/CLI/Commands/CrashCommands.swift` - CLI for crashes

### Modified Files
1. `nocur-swift/Sources/Core/Introspection/ViewInspector.swift` - Fix with idb
2. `nocur-swift/Sources/Core/Interaction/UIInteractor.swift` - Better error messages
3. `nocur-swift/Sources/CLI/NocurCLI.swift` - Register new commands
4. `nocur-swift/Sources/Core/Output.swift` - New result types
5. `claude-service/src/index.ts` - New MCP tools

### New MCP Tools
1. `sim_logs` - Capture simulator logs
2. `app_crashes` - List crash reports
3. `app_crash_details` - Get crash details
4. `app_context` - Combined context (screenshot + hierarchy + logs + crashes)

### Updated MCP Tools
1. `ui_interact` - Add label/identifier targeting
2. `ui_hierarchy` - Return real data instead of placeholder
3. `ui_find` - Return real data instead of empty array

---

## Testing Plan

### Phase 1 Tests
```bash
# Test view hierarchy
./nocur-swift ui hierarchy
# Should return actual elements, not empty

# Test find
./nocur-swift ui find --text "Send"
# Should find the send button

# Test tap by label
./nocur-swift ui interact --tap-label "Send Message"
# Should tap the element
```

### Phase 2 Tests
```bash
# Test log capture
./nocur-swift sim logs --bundle-id com.nocur.NocurTestApp --duration 3
# Should return filtered logs

# Test crash list
./nocur-swift app crashes --bundle-id com.nocur.NocurTestApp
# Should list crashes
```

### Integration Test
```
User: "Tap the send button and check if the message was sent"

Agent:
1. Uses ui_find to locate "Send" button
2. Uses ui_interact --tap-label "Send Message"
3. Takes screenshot to verify
4. Uses sim_logs to check for errors
5. Reports success/failure with evidence
```

---

## Success Criteria

1. **View hierarchy returns real data** - Not empty placeholder
2. **Agent can tap by label** - `ui_interact --tap-label "Button Text"` works
3. **Logs are capturable** - `sim_logs` returns filtered log entries
4. **Crashes are detectable** - `app_crashes` lists crash reports
5. **Agent is more autonomous** - Can gather context without user help

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Fix View Hierarchy | ~2 hours | None |
| Phase 2: Add Logs | ~2 hours | Phase 1 |
| Phase 3: Add Crashes | ~1 hour | None |
| Phase 4: Update UIInteractor | ~1 hour | Phase 1 |
| Phase 5: Enhanced ui_interact | ~1 hour | Phase 4 |
| Phase 6: Context Aggregation | ~1 hour | Phases 1-3 |

**Total: ~8 hours of focused work**

---

## Open Questions

1. **Log volume** - Should we limit log entries? Summarize them?
2. **Crash details** - Full stack trace vs summarized?
3. **Context size** - How much context is too much for the agent?
4. **UI simplification** - Remove live preview pane now or later?

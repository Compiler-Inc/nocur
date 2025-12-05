# Nocur

> AI-powered iOS development verification. Give coding agents eyes.

## What This Is

Nocur is a macOS application that enables AI coding agents (like Claude Code) to autonomously verify iOS development work. Instead of blindly writing code and hoping it works, agents can:

- See the iOS simulator (screenshots)
- Understand view hierarchy (structured data)
- Interact with the UI (tap, scroll, type)
- Build, run, and kill apps
- Verify their changes actually work

Think "Cursor for iOS" but with the agent being truly self-reliant.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop App | Tauri (Rust backend) |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| iOS Bridge | Swift CLI (nocur-swift) |
| Agent | Claude Agent SDK (Node.js service) |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Nocur (Tauri App)                     │
├─────────────────────────────────────────────────────────┤
│  Frontend: React + shadcn/ui + Tailwind                 │
│  Backend:  Rust (Tauri commands)                        │
├─────────────────────────────────────────────────────────┤
│                         │                               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │            claude-service (Node.js)              │  │
│  │  ┌─────────────────┐  ┌───────────────────────┐  │  │
│  │  │ Claude Agent SDK│  │ MCP Server            │  │  │
│  │  │ @anthropic-ai/  │  │ (nocur-swift tools)   │  │  │
│  │  │ claude-agent-sdk│  │ - sim_screenshot      │  │  │
│  │  └────────┬────────┘  │ - ui_interact         │  │  │
│  │           │           │ - app_build           │  │  │
│  │           ▼           │ - ...                 │  │  │
│  │     Anthropic API     └───────────┬───────────┘  │  │
│  └───────────────────────────────────┼──────────────┘  │
│                                      │                  │
│                                      ▼                  │
│                          ┌──────────────────┐          │
│                          │ nocur-swift CLI  │          │
│                          └────────┬─────────┘          │
│                                   │                     │
│                                   ▼                     │
│                          ┌──────────────────┐          │
│                          │ iOS Simulator    │          │
│                          │ + Xcode          │          │
│                          └──────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### Communication Flow

1. **Tauri → claude-service**: JSON commands over stdin
   - `{"type": "start", "workingDir": "...", "model": "sonnet"}`
   - `{"type": "message", "content": "..."}`
   - `{"type": "interrupt"}`, `{"type": "changeModel", "model": "opus"}`, `{"type": "stop"}`

2. **claude-service → Tauri**: JSON events over stdout
   - `{"type": "service_ready"}` - Service initialized
   - `{"type": "ready", "model": "sonnet"}` - Ready for messages
   - `{"type": "assistant", "content": "..."}` - Text response
   - `{"type": "tool_use", "toolName": "...", "toolInput": "..."}` - Tool invocation
   - `{"type": "result", "content": "...", "usage": {...}}` - Query complete

3. **claude-service → nocur-swift**: MCP tool calls
   - Tools like `sim_screenshot`, `ui_interact`, `app_build` are exposed as MCP tools
   - The SDK calls these tools automatically when Claude requests them

## Project Structure

```
nocur/
├── CLAUDE.md                 # You are here
├── src-tauri/                # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs            # Tauri commands
│   │   ├── claude.rs         # Claude SDK service management
│   │   ├── permissions.rs    # Permission handling
│   │   └── window_capture.rs # Simulator window capture
│   └── Cargo.toml
│
├── claude-service/           # Node.js Claude Agent SDK service
│   ├── package.json          # @anthropic-ai/claude-agent-sdk
│   ├── tsconfig.json
│   └── src/
│       └── index.ts          # SDK service with MCP tools
│
├── src/                      # React frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── ui/               # shadcn components
│   │   ├── panes/
│   │   │   ├── SimulatorPane.tsx
│   │   │   ├── AgentPane.tsx
│   │   │   └── ProjectPane.tsx
│   │   └── SkillsModal.tsx
│   ├── hooks/
│   ├── lib/
│   │   └── utils.ts
│   └── styles/
│
├── nocur-swift/              # Swift CLI for iOS tooling
│   ├── Package.swift
│   └── Sources/
│       ├── CLI/              # Command-line interface
│       └── Core/             # Shared iOS tooling logic
│
└── sample-app/               # Test iOS app for development
    └── NocurTestApp/
```

## Coding Guidelines

### General

- **No over-engineering.** Build what's needed now, not what might be needed later.
- **Explicit over implicit.** Clear, readable code beats clever code.
- **Fail fast and loud.** Errors should be obvious and actionable.
- **JSON everything.** All tool outputs should be structured JSON for agent parsing.

### TypeScript/React

- Use functional components with hooks
- Prefer `const` arrow functions for components
- Use TypeScript strict mode
- Colocate related code (component + hook + types in same file if small)
- Use `@/` path alias for imports from `src/`
- Name files in PascalCase for components, camelCase for utilities

```typescript
// Good
const SimulatorPane = () => {
  const { screenshot, refresh } = useSimulator();
  return <div>...</div>;
};

// Avoid
class SimulatorPane extends React.Component { ... }
```

### Rust (Tauri)

- Use `thiserror` for error types
- Use `serde` for all serialization
- Commands should return `Result<T, String>` for Tauri
- Keep Tauri commands thin - business logic in separate modules
- Use `tokio` for async operations

```rust
// Good - thin command, logic elsewhere
#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    simulator::screenshot().await.map_err(|e| e.to_string())
}

// Avoid - business logic in command
#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    // 50 lines of logic here
}
```

### Swift

- Swift 5.9+ with strict concurrency
- Use Swift Package Manager
- Use `ArgumentParser` for CLI commands
- Prefer `async/await` over completion handlers
- Output JSON to stdout, errors to stderr

```swift
// Good
@main
struct NocurCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "nocur-swift",
        subcommands: [Sim.self, App.self, UI.self]
    )
}

// Output format
struct Output<T: Encodable>: Encodable {
    let success: Bool
    let data: T?
    let error: String?
}
```

## Design Guidelines

### UI Principles

- **Dark mode first.** iOS dev happens at night.
- **Dense but not cramped.** Maximize information density while maintaining clarity.
- **Real-time feedback.** Show what's happening as it happens.
- **Agent transparency.** Users should always see what the agent sees.

### Layout

Three-pane resizable layout:
1. **Left: Project** - File tree, build status, errors (resizable, 180-400px)
2. **Center: Agent** - Claude chat interface, main focus area (flex, min 400px)
3. **Right: Simulator** - Live iOS mirror, screenshot, hierarchy (resizable, 280-500px)

All panes are horizontally resizable via drag handles.

### Color System

**IMPORTANT: Always use semantic color classes. Never use raw hex colors or zinc-* classes directly.**

All colors are defined in `src/styles/globals.css` using the `@theme` directive. Use these Tailwind classes everywhere:

#### Surface Colors (Backgrounds)
| Class | Use For |
|-------|---------|
| `bg-surface-base` | Main app background |
| `bg-surface-raised` | Cards, panels, sidebars |
| `bg-surface-overlay` | Dropdowns, modals, buttons |
| `bg-surface-sunken` | Inset areas |

#### Text Colors
| Class | Use For |
|-------|---------|
| `text-text-primary` | Primary text, headings |
| `text-text-secondary` | Secondary/muted text |
| `text-text-tertiary` | Placeholders, hints, labels |

#### Border Colors
| Class | Use For |
|-------|---------|
| `border-border` | Default borders |
| `border-border-subtle` | Subtle dividers |
| `border-border-strong` | Emphasized borders |

#### Accent Colors (Amber - Claude's brand)
| Class | Use For |
|-------|---------|
| `text-accent` / `bg-accent` | Primary accent, highlights |
| `text-accent-muted` / `bg-accent-muted` | Muted accent |
| `bg-accent-subtle` | Subtle accent backgrounds |

#### Status Colors
| Class | Use For |
|-------|---------|
| `text-success` / `bg-success` | Success states (build passed) |
| `text-warning` / `bg-warning` | Warnings (building, slow) |
| `text-error` / `bg-error` | Errors (build failed, crash) |
| `bg-success-muted` / `bg-warning-muted` / `bg-error-muted` | Muted status backgrounds |

#### Interactive States
| Class | Use For |
|-------|---------|
| `hover:bg-hover` | Hover state on buttons/items |
| `active:bg-active` | Active/pressed state |
| `ring-focus-ring` | Focus ring |

#### Example Usage
```tsx
// Good - semantic colors
<div className="bg-surface-base text-text-primary">
  <button className="bg-surface-overlay hover:bg-hover text-text-secondary">
    Click me
  </button>
  <span className="text-accent">Highlighted</span>
  <div className="border border-border bg-surface-raised">Card</div>
</div>

// Bad - raw colors (NEVER DO THIS)
<div className="bg-zinc-950 text-zinc-100">
  <button className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400">
    Click me
  </button>
</div>
```

### Typography

- Monospace for: code, file paths, terminal output, JSON
- Sans-serif for: labels, descriptions, UI text
- Use shadcn/ui defaults

## Key Commands

### Development

```bash
# Install dependencies (frontend + claude-service)
pnpm install
cd claude-service && pnpm install && pnpm build && cd ..

# Run in development
pnpm tauri dev

# Build for production
pnpm tauri build

# Build claude-service separately
cd claude-service && pnpm build

# Run Swift CLI separately
cd nocur-swift && swift run nocur-swift --help
```

### Claude Service

The claude-service is a Node.js process that wraps the Claude Agent SDK. It must be built before running the app:

```bash
cd claude-service
pnpm install    # Install @anthropic-ai/claude-agent-sdk
pnpm build      # Compile TypeScript to dist/
```

The service exposes these MCP tools to Claude:
- `sim_screenshot` - Take iOS simulator screenshot
- `sim_list`, `sim_boot` - Manage simulators
- `ui_interact` - Tap, type, scroll with screenshot
- `ui_hierarchy`, `ui_find` - View hierarchy inspection
- `app_build`, `app_launch`, `app_kill` - Xcode project lifecycle

### Swift CLI (nocur-swift)

```bash
nocur-swift sim list              # List simulators
nocur-swift sim boot <udid>       # Boot simulator
nocur-swift sim screenshot        # Take screenshot
nocur-swift app build             # Build Xcode project
nocur-swift app launch <bundle>   # Launch app
nocur-swift ui hierarchy          # Dump view hierarchy
nocur-swift ui tap <x> <y>        # Tap at coordinates
```

## Implementation Phases

### Phase 1: Scaffold ✅
- [x] Tauri + React + shadcn/ui setup
- [x] Three-pane layout shell
- [x] Basic routing/state

### Phase 2: Simulator Integration ✅
- [x] Swift CLI: sim list/boot/screenshot
- [x] Display screenshots in Simulator pane
- [x] Live simulator mirroring (window capture)

### Phase 3: App Lifecycle ✅
- [x] Project auto-detection
- [x] Build/install/launch/kill
- [x] Build output streaming

### Phase 4: View Introspection ✅
- [x] UI hierarchy via accessibility APIs
- [x] Find elements by text/type/ID
- [x] Compound ui_interact command

### Phase 5: Agent Integration ✅
- [x] Claude Agent SDK integration (replaces CLI subprocess)
- [x] MCP tools for nocur-swift commands
- [x] Model selection (sonnet/opus/haiku)
- [x] Session resume capability
- [x] Agent output streaming and display

### Phase 6: Interaction ✅
- [x] Tap/scroll/type via CLI
- [x] Agent-driven UI testing
- [x] Verification workflows (screenshot after action)

## Notes for AI Agents

When working on this codebase:

1. **Test visually when possible.** Run `pnpm tauri dev` to see changes.
2. **Check compilation first.** Rust and TypeScript should both compile clean.
3. **JSON outputs are contracts.** Don't change output formats without updating consumers.
4. **The Swift CLI is the source of truth** for iOS capabilities. Tauri just wraps it.
5. **User sees what agent sees.** Any data you consume should be displayable in the UI.

## Resources

- [Tauri Docs](https://tauri.app/v1/guides/)
- [shadcn/ui](https://ui.shadcn.com/)
- [simctl docs](https://nshipster.com/simctl/)
- [Swift ArgumentParser](https://github.com/apple/swift-argument-parser)
- [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Claude Agent SDK Docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk)

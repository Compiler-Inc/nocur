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
| iOS Bridge | Swift CLI + dylib |
| Agent | Claude Code (subprocess) |

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Nocur (Tauri App)                  │
├─────────────────────────────────────────────────┤
│  Frontend: React + shadcn/ui + Tailwind        │
│  Backend:  Rust (Tauri commands)               │
├─────────────────────────────────────────────────┤
│          │              │                       │
│          ▼              ▼                       │
│  ┌──────────────┐  ┌──────────────────┐        │
│  │ Claude Code  │  │ Swift CLI        │        │
│  │ (subprocess) │  │ (nocur-swift)    │        │
│  └──────────────┘  └──────────────────┘        │
│                          │                      │
│                          ▼                      │
│                    ┌───────────┐               │
│                    │ iOS Sim   │               │
│                    │ + Xcode   │               │
│                    └───────────┘               │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
nocur/
├── CLAUDE.md                 # You are here
├── src-tauri/                # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── claude/           # Claude Code subprocess management
│   │   ├── simulator/        # iOS Simulator control
│   │   └── project/          # Xcode project detection
│   └── Cargo.toml
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
│   │   └── layout/
│   ├── hooks/
│   ├── lib/
│   │   ├── tauri.ts          # Tauri command bindings
│   │   └── utils.ts
│   └── styles/
│
├── nocur-swift/              # Swift CLI for iOS tooling
│   ├── Package.swift
│   └── Sources/
│       ├── CLI/              # Command-line interface
│       └── Core/             # Shared iOS tooling logic
│
├── nocur-dylib/              # Debug dylib injected into iOS apps
│   ├── Package.swift
│   └── Sources/
│
└── docs/
    ├── ARCHITECTURE.md
    ├── AGENT_GUIDE.md        # How AI agents should use nocur
    └── COMMANDS.md           # CLI reference
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

Three-pane layout:
1. **Left: Project** - File tree, build status, errors
2. **Center: Simulator** - Live mirror, screenshot history, hierarchy overlay
3. **Right: Agent** - Claude terminal, task progress, what agent "sees"

Panes should be resizable. Collapse to focus.

### Colors

Use shadcn/ui default dark theme as base. Key semantic colors:
- Success: Green (build passed, task complete)
- Error: Red (build failed, crash)
- Warning: Yellow (deprecation, slow operation)
- Agent action: Blue/Purple (agent is doing something)

### Typography

- Monospace for: code, file paths, terminal output, JSON
- Sans-serif for: labels, descriptions, UI text
- Use shadcn/ui defaults

## Key Commands

### Development

```bash
# Install dependencies
pnpm install

# Run in development
pnpm tauri dev

# Build for production
pnpm tauri build

# Run Swift CLI separately
cd nocur-swift && swift run nocur-swift --help
```

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

### Phase 1: Scaffold (Current)
- [ ] Tauri + React + shadcn/ui setup
- [ ] Three-pane layout shell
- [ ] Basic routing/state

### Phase 2: Simulator Integration
- [ ] Swift CLI: sim list/boot/screenshot
- [ ] Display screenshots in Simulator pane
- [ ] Live simulator mirroring

### Phase 3: App Lifecycle
- [ ] Project auto-detection
- [ ] Build/install/launch/kill
- [ ] Build output streaming

### Phase 4: View Introspection
- [ ] Debug dylib for hierarchy capture
- [ ] Hierarchy visualization in UI
- [ ] Overlay on simulator view

### Phase 5: Agent Integration
- [ ] Claude Code subprocess management
- [ ] Tool injection
- [ ] Agent output parsing and display

### Phase 6: Interaction
- [ ] Tap/scroll/type via CLI
- [ ] Agent-driven UI testing
- [ ] Verification workflows

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

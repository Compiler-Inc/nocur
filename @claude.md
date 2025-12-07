# @claude.md - Quick Reference for AI Agents

> AI-powered iOS development verification. Give coding agents eyes.

## What This Is

Nocur enables AI agents to autonomously verify iOS development work by providing:
- iOS simulator screenshots and interaction
- View hierarchy inspection
- App building, launching, and lifecycle control
- Real-time visual feedback

## Architecture Quick View

```
Tauri (Rust) ← JSON → claude-service (Node.js) ← MCP → nocur-swift (Swift CLI) → iOS Simulator
     ↑
React Frontend (TypeScript + Tailwind)
```

## Key Technologies

| Layer | Tech | Purpose |
|-------|------|---------|
| Desktop | Tauri (Rust) | Native app shell, Tauri commands |
| Frontend | React + TypeScript | 3-pane UI, real-time updates |
| Styling | Tailwind CSS | Semantic color system in globals.css |
| AI Agent | Claude Agent SDK | Node.js service with MCP tools |
| iOS Bridge | Swift CLI | Simulator control, app lifecycle |

## Project Structure

```
nocur/
├── src/                     # React frontend (TypeScript)
├── src-tauri/              # Rust backend (Tauri commands)
├── claude-service/         # Node.js Claude Agent SDK service
├── nocur-swift/           # Swift CLI for iOS tooling
└── sample-app/            # Test iOS app
```

## Development Commands

```bash
# Setup
pnpm install
cd claude-service && pnpm install && pnpm build && cd ..

# Development
pnpm tauri dev              # Full app with hot reload

# Production
pnpm tauri build           # Native binary

# Swift CLI (separate testing)
cd nocur-swift && swift run nocur-swift --help
```

## MCP Tools Available to Agents

When working as an agent in Nocur, you have these specialized tools:

| Tool | Purpose |
|------|---------|
| `sim_screenshot` | Take iOS simulator screenshot |
| `sim_list`, `sim_boot` | Manage simulators |
| `ui_interact` | Tap, type, scroll + screenshot |
| `ui_hierarchy`, `ui_find` | Inspect view hierarchy |
| `app_build`, `app_launch`, `app_kill` | Xcode project lifecycle |

## Coding Standards

### TypeScript/React
- Functional components with hooks
- Use `@/` imports from `src/`
- Strict TypeScript mode
- Components in PascalCase, utils in camelCase

### Semantic Colors (CRITICAL)
**Never use raw hex or zinc-* classes. Always use semantic classes from globals.css:**

```tsx
// ✅ Good - semantic colors
<div className="bg-surface-base text-text-primary">
  <button className="bg-surface-overlay hover:bg-hover">
    <span className="text-accent">Highlighted</span>
  </button>
</div>

// ❌ Bad - raw colors
<div className="bg-zinc-950 text-zinc-100">
```

**Color Classes:**
- **Surfaces**: `bg-surface-base`, `bg-surface-raised`, `bg-surface-overlay`, `bg-surface-sunken`
- **Text**: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`
- **Borders**: `border-border`, `border-border-subtle`, `border-border-strong`
- **Accent**: `text-accent`, `bg-accent`, `bg-accent-muted`
- **Status**: `text-success/warning/error`, `bg-success/warning/error-muted`
- **Interactive**: `hover:bg-hover`, `active:bg-active`, `ring-focus-ring`

### Rust (Tauri)
- Thin Tauri commands, logic in separate modules
- Return `Result<T, String>` for commands
- Use `serde` for all JSON serialization

```rust
#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    simulator::screenshot().await.map_err(|e| e.to_string())
}
```

### Swift CLI
- Swift 5.9+ with strict concurrency
- `ArgumentParser` for CLI commands
- JSON to stdout, errors to stderr

## UI Layout

**3-pane resizable layout:**
1. **Left (180-400px)**: Project pane - file tree, build status, errors
2. **Center (flex, min 400px)**: Agent pane - Claude chat interface
3. **Right (280-500px)**: Simulator pane - iOS mirror, screenshots, hierarchy

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main 3-pane layout (699 lines) |
| `src/components/panes/AgentPane.tsx` | Claude chat interface |
| `src/components/panes/SimulatorPane.tsx` | iOS simulator display |
| `src/components/panes/ProjectPane.tsx` | Build controls |
| `src-tauri/src/lib.rs` | 20+ Tauri commands (2,714 lines) |
| `src-tauri/src/claude.rs` | Claude SDK integration |
| `claude-service/src/index.ts` | MCP tools for agents |
| `src/styles/globals.css` | Semantic color system |

## Agent Best Practices

1. **Test visually** - Always take screenshots after making changes
2. **Use JSON outputs** - All tool outputs are structured for agent parsing
3. **Check compilation** - Both Rust and TypeScript should compile clean
4. **Agent transparency** - Users see what you see, show your work
5. **Semantic colors only** - Never use raw hex colors in CSS

## Communication Flow

```
User → Tauri Frontend → Rust Backend → claude-service → MCP Tools → nocur-swift → iOS Simulator
                                          ↑
                                    Claude Agent (You!)
```

## Quick Debugging

```bash
# Check if everything compiles
pnpm tauri dev

# Test Swift CLI separately
cd nocur-swift && swift run nocur-swift sim list

# Rebuild claude-service
cd claude-service && pnpm build

# Check Tauri logs
tail -f ~/.local/share/nocur/logs/nocur.log
```

## When Working on This Codebase

- **Real-time feedback**: Run `pnpm tauri dev` to see changes live
- **JSON contracts**: Don't change tool output formats without updating consumers
- **Swift CLI is source of truth**: Tauri just wraps the Swift commands
- **Visual verification**: Use screenshots to verify iOS changes work

---

*This is a living document. Update it as the codebase evolves.*
# Nocur

> Give coding agents eyes. AI-powered iOS development verification.

Nocur enables AI coding agents to autonomously verify their iOS development work. Instead of blindly writing code and hoping it works, agents can see the simulator, interact with the UI, and confirm their changes actually work.

## The Problem

AI coding agents are powerful at writing code, but they're blind when it comes to iOS development:
- They can't see if the UI looks right
- They can't test user interactions
- They can't verify their code actually works
- They can't debug visual issues

**Nocur gives them eyes.**

## What It Does

Nocur is a macOS app that bridges AI agents and iOS development:

- **See the Simulator** - Take screenshots, observe app behavior
- **Interact with UI** - Tap, scroll, type like a human would
- **Build & Run** - Compile Xcode projects, launch apps, capture logs
- **Verify Changes** - Agents can test their own work and iterate

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Nocur (Tauri App)                    │
├─────────────────────────────────────────────────────────┤
│  Frontend: React + TypeScript + Tailwind + shadcn/ui   │
│  Backend:  Rust (Tauri)                                 │
├─────────────────────────────────────────────────────────┤
│                         │                               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │            claude-service (Node.js)              │  │
│  │  ┌─────────────────┐  ┌───────────────────────┐  │  │
│  │  │ Claude Agent SDK│  │ MCP Tools             │  │  │
│  │  │                 │  │ - sim_screenshot      │  │  │
│  │  │                 │  │ - ui_interact         │  │  │
│  │  │                 │  │ - app_build           │  │  │
│  │  └────────┬────────┘  │ - ui_hierarchy        │  │  │
│  │           │           │ - ...                 │  │  │
│  │           ▼           └───────────┬───────────┘  │  │
│  │     Anthropic API                 │              │  │
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

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop App | Tauri (Rust backend) |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| iOS Bridge | Swift CLI (`nocur-swift`) |
| Agent | Claude Agent SDK (Node.js) |

## Requirements

- **macOS** (Apple Silicon or Intel)
- **Xcode** 15+ with iOS Simulator
- **idb** (required for reliable UI interactions)
- **Node.js** 20+
- **Rust** (for Tauri)
- **pnpm** (package manager)
- **Anthropic API Key** (for Claude integration)

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Compiler-Inc/nocur.git
cd nocur

# Install frontend dependencies
pnpm install

# Build the claude-service
cd claude-service && pnpm install && pnpm build && cd ..

# Build the Swift CLI
cd nocur-swift && swift build -c release && cd ..
```

### 2. Set up API Key

Copy `.env.example` to `.env` and set your key:
```bash
cp .env.example .env
# edit .env
```

### 3. Run

```bash
pnpm tauri dev
```

## Claude Code / MCP (Optional)

- MCP server config template: `mcp-server/claude-code-config.example.json` (replace `<REPO_ROOT>`).
- Claude Code hook + skill templates: `templates/claude-code/.claude/` (copy to `./.claude/` if you use Claude Code in this repo).

## Project Structure

```
nocur/
├── src/                      # React frontend
│   ├── components/
│   │   ├── ui/               # shadcn components
│   │   └── panes/            # Main UI panes
│   └── hooks/
│
├── src-tauri/                # Rust backend (Tauri)
│   └── src/
│       ├── lib.rs            # Tauri commands
│       ├── claude.rs         # Claude service management
│       └── window_capture.rs # Simulator capture
│
├── claude-service/           # Node.js Claude Agent SDK service
│   └── src/
│       └── index.ts          # SDK + MCP tools
│
├── nocur-swift/              # Swift CLI for iOS tooling
│   └── Sources/
│       ├── CLI/              # Command-line interface
│       └── Core/             # iOS tooling logic
│
└── sample-app/               # Test iOS app
```

## Available MCP Tools

These tools are exposed to the Claude agent:

| Tool | Description |
|------|-------------|
| `sim_screenshot` | Capture simulator screenshot |
| `sim_list` | List available simulators |
| `sim_boot` | Boot a simulator |
| `ui_interact` | Tap, type, scroll with screenshot |
| `ui_hierarchy` | Get view hierarchy |
| `ui_find` | Find elements by text/type/ID |
| `app_build` | Build Xcode project |
| `app_launch` | Launch app on simulator |
| `app_kill` | Kill running app |

## Swift CLI

The `nocur-swift` CLI can also be used standalone:

```bash
# List simulators
nocur-swift sim list

# Take screenshot
nocur-swift sim screenshot

# Boot simulator
nocur-swift sim boot <udid>

# Build project
nocur-swift app build --project /path/to/Project.xcodeproj

# UI interactions
nocur-swift ui tap 200 400
nocur-swift ui type "Hello World"
nocur-swift ui hierarchy
```

## Development

### Build Commands

```bash
# Development mode
pnpm tauri dev

# Production build
pnpm tauri build

# Build claude-service only
cd claude-service && pnpm build

# Build Swift CLI only
cd nocur-swift && swift build -c release
```

### Running Tests

```bash
# Frontend typecheck
pnpm lint

# Swift CLI tests
cd nocur-swift && swift test
```

## Vision

The goal is an agent that can take a task like:

> "Add a settings screen with a dark mode toggle"

And then:
1. Understand the requirement
2. Write the code
3. Build and run the app
4. **Use the app like a human** (tap, scroll, navigate)
5. **Verify** the feature works by actually testing it
6. Iterate until done

**Completely autonomous. No hand-holding.**

## Roadmap

- [x] Simulator screenshots
- [x] UI interactions (tap, scroll, type)
- [x] Build/launch/kill app lifecycle
- [x] Claude Agent SDK integration
- [x] View hierarchy + element targeting (idb accessibility)
- [ ] Log streaming and crash detection
- [ ] Computer use integration
- [ ] Multi-simulator support

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop app framework
- [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk) - AI agent integration
- [idb](https://fbidb.io/) - Facebook's iOS development tools
- [shadcn/ui](https://ui.shadcn.com/) - UI components

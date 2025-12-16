# Contributing to Nocur

Thank you for your interest in contributing to Nocur! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- macOS (required for iOS development)
- Xcode 15+ with iOS Simulator
- Node.js 20+
- Rust (install via [rustup](https://rustup.rs/))
- pnpm (`npm install -g pnpm`)
- Swift 5.9+

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/nocur.git
   cd nocur
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   cd claude-service && pnpm install && pnpm build && cd ..
   cd nocur-swift && swift build && cd ..
   ```

3. **Run in development mode**
   ```bash
   pnpm tauri dev
   ```

## Project Structure

Understanding the codebase:

| Directory | Description |
|-----------|-------------|
| `src/` | React frontend (TypeScript) |
| `src-tauri/` | Rust backend (Tauri commands) |
| `claude-service/` | Node.js Claude Agent SDK service |
| `nocur-swift/` | Swift CLI for iOS tooling |
| `sample-app/` | Test iOS app for development |

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/Compiler-Inc/nocur/issues) first
2. Create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - macOS version, Xcode version
   - Relevant logs or screenshots

### Suggesting Features

1. Open an issue with the `enhancement` label
2. Describe the use case and proposed solution
3. Be open to discussion and alternatives

### Pull Requests

1. **Create an issue first** for significant changes
2. **Fork the repository** and create a branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following our coding guidelines
4. **Test your changes** thoroughly
5. **Commit with clear messages**:
   ```bash
   git commit -m "Add feature: description of what it does"
   ```
6. **Push and create a PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Guidelines

### General Principles

- **No over-engineering.** Build what's needed now, not what might be needed later.
- **Explicit over implicit.** Clear, readable code beats clever code.
- **Fail fast and loud.** Errors should be obvious and actionable.
- **JSON everything.** All tool outputs should be structured JSON for agent parsing.

### TypeScript/React

```typescript
// Use functional components with hooks
const SimulatorPane = () => {
  const { screenshot, refresh } = useSimulator();
  return <div>...</div>;
};

// Use @/ path alias for imports
import { Button } from '@/components/ui/button';

// TypeScript strict mode - no `any` types
```

- Use `const` arrow functions for components
- Colocate related code (component + hook + types)
- Name files in PascalCase for components, camelCase for utilities

### Rust (Tauri)

```rust
// Keep Tauri commands thin - business logic in separate modules
#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    simulator::screenshot().await.map_err(|e| e.to_string())
}
```

- Use `thiserror` for error types
- Use `serde` for all serialization
- Commands return `Result<T, String>`

### Swift

```swift
// Use async/await over completion handlers
func captureScreenshot() async throws -> Data {
    // ...
}

// Output JSON to stdout, errors to stderr
let output = Output(success: true, data: result)
print(try JSONEncoder().encode(output))
```

- Swift 5.9+ with strict concurrency
- Use `ArgumentParser` for CLI commands
- All CLI output is JSON

### CSS/Styling

Use semantic color classes from `globals.css`:

```tsx
// Good - semantic colors
<div className="bg-surface-base text-text-primary">
  <button className="bg-surface-overlay hover:bg-hover">
    Click me
  </button>
</div>

// Bad - raw colors
<div className="bg-zinc-950 text-zinc-100">
```

## Testing

### Running Tests

```bash
# Frontend typecheck
pnpm lint

# Swift CLI
cd nocur-swift && swift test

# Rust (if applicable)
cd src-tauri && cargo test
```

### Manual Testing

1. Run `pnpm tauri dev`
2. Open an iOS project or use `sample-app/`
3. Test the feature you're working on
4. Verify Claude can use any new/modified tools

## Commit Messages

Use clear, descriptive commit messages:

```
Add feature: brief description

- Detail about what was added
- Why it was needed
- Any caveats or notes
```

Prefixes:
- `Add:` New feature
- `Fix:` Bug fix
- `Update:` Enhancement to existing feature
- `Remove:` Removing code/features
- `Refactor:` Code restructuring
- `Docs:` Documentation only

## Code Review Process

1. All PRs require at least one review
2. Address all review comments
3. Keep PRs focused and reasonably sized
4. Update documentation if needed

## Questions?

- Open an issue for questions about the codebase
- Check existing issues and discussions first

Thank you for contributing!

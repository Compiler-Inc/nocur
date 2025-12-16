---
name: ios-verification
description: iOS simulator control and app verification using nocur-swift CLI
---

# iOS Verification with nocur-swift

Use `nocur-swift` to interact with the iOS simulator, take screenshots, inspect UI hierarchy, and verify your iOS development work.

## Setup

- Ensure `nocur-swift` is available on your `PATH`, or build it from this repo:
  - `cd nocur-swift && swift build -c release`
  - Then run `./nocur-swift/.build/release/nocur-swift ...` (or add it to `PATH`)

## Speed Optimizations (Use These)

### Fast Screenshots (`--base64`)

**Instead of this (slow):**
```bash
nocur-swift sim screenshot           # Returns file path
Read screenshot.png                  # View the image
```

**Do this (fast):**
```bash
nocur-swift sim screenshot --base64
```

This returns the image as base64 JPEG directly in JSON (no file operations needed).

### Compound `ui interact` (Fastest)

**Instead of this (multiple tool calls):**
```bash
nocur-swift ui tap 200 500
nocur-swift sim screenshot --base64
```

**Do this (one tool call):**
```bash
nocur-swift ui interact --tap 200 500
```

The `interact` command performs the action and returns a screenshot in one call.

## Sample App (This Repo)

- **Project**: `sample-app/NocurTestApp.xcodeproj`
- **Bundle ID**: `com.nocur.testapp`
- **Main file**: `sample-app/NocurTestApp/ContentView.swift`

## Command Reference

### Screenshots

```bash
# Preferred: base64 output
nocur-swift sim screenshot --base64

# Legacy: file output
nocur-swift sim screenshot
```

### UI Interaction

```bash
# Interact + screenshot in one call
nocur-swift ui interact --tap 200 500
nocur-swift ui interact --tap-id "loginButton"
nocur-swift ui interact --tap-label "Sign In"
nocur-swift ui interact --type "hello" --into emailField
nocur-swift ui interact --scroll down

# Legacy commands
nocur-swift ui tap <x> <y>
nocur-swift ui type "text here"
nocur-swift ui scroll down
```

### View Hierarchy

```bash
nocur-swift ui hierarchy
nocur-swift ui find --text "Submit"
nocur-swift ui find --id "loginButton"
```

### App Lifecycle

```bash
nocur-swift app build --project sample-app/NocurTestApp.xcodeproj
nocur-swift app launch com.nocur.testapp
nocur-swift app kill com.nocur.testapp
```

### Simulator Management

```bash
nocur-swift sim list
nocur-swift sim boot "iPhone 16 Pro"
```

## Requirements

- **idb (Facebook's iOS Development Bridge)** must be installed and connected for tap/type/scroll.

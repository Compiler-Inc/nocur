# Agent Guide: Using Nocur for iOS Development Verification

This guide is written for AI coding agents (like Claude Code) to effectively use
Nocur for autonomous iOS development verification.

---

## Philosophy

Traditional AI coding assistants are **blind** - they can write code but cannot
verify the visual result. Nocur gives you **eyes** into iOS development:

1. **See** the simulator (screenshots)
2. **Understand** UI structure (view hierarchy)
3. **Interact** with the UI (tap, scroll, type)
4. **Verify** your changes actually work

Your goal: Be **self-reliant**. Don't trust code compiles = works. Verify visually.

---

## Quick Start Workflow

```bash
# 1. Detect project
nocur-swift project detect

# 2. Build
nocur-swift app build

# 3. Boot simulator (if not running)
nocur-swift sim boot --wait

# 4. Install and launch
nocur-swift app install
nocur-swift app launch <bundle-id>

# 5. Verify UI
nocur-swift sim screenshot
nocur-swift ui hierarchy

# 6. Interact if needed
nocur-swift ui tap --id "loginButton"
nocur-swift ui type "hello" --id "textField"
```

---

## Decision Tree: Which Tool to Use

```
Need to verify UI looks correct?
├── YES → nocur-swift sim screenshot
│         (Analyze the image to verify layout, colors, content)
│
Need to understand UI structure?
├── YES → nocur-swift ui hierarchy
│         (Get structured data about views, their types, positions)
│
Need to find a specific element?
├── YES → nocur-swift ui find --text "..." or --id "..."
│         (Search for elements by text or identifier)
│
Need to interact with UI?
├── Know coordinates? → nocur-swift ui tap <x> <y>
├── Know element ID?  → nocur-swift ui tap --id "..."
├── Know element text? → nocur-swift ui tap --label "..."
├── Need to scroll?   → nocur-swift ui scroll <direction>
└── Need to type?     → nocur-swift ui type "text" --id "..."

Need to check app state?
├── Is it running?    → nocur-swift sim status
├── What's installed? → nocur-swift app list
└── Build errors?     → nocur-swift app build (check errors array)
```

---

## Common Patterns

### Pattern 1: Verify UI After Code Changes

```bash
# After modifying SwiftUI/UIKit code:

# 1. Rebuild
nocur-swift app build

# 2. If build succeeded, reinstall and relaunch
nocur-swift app kill <bundle-id>
nocur-swift app install
nocur-swift app launch <bundle-id>

# 3. Wait a moment for UI to render
sleep 1

# 4. Screenshot and analyze
nocur-swift sim screenshot
# → Analyze the returned image to verify your changes
```

### Pattern 2: Navigate Through App

```bash
# Goal: Navigate to Settings screen

# 1. Find the Settings button/tab
nocur-swift ui find --text "Settings"
# Returns element with frame coordinates

# 2. Tap it
nocur-swift ui tap --label "Settings"

# 3. Verify we're on Settings screen
nocur-swift sim screenshot
# → Verify Settings screen is showing
```

### Pattern 3: Fill Form and Submit

```bash
# Goal: Fill login form

# 1. Find and tap email field
nocur-swift ui tap --id "emailTextField"

# 2. Type email
nocur-swift ui type "user@example.com"

# 3. Find and tap password field
nocur-swift ui tap --id "passwordTextField"

# 4. Type password
nocur-swift ui type "password123"

# 5. Submit
nocur-swift ui tap --id "loginButton"

# 6. Verify result
sleep 2  # Wait for network/animation
nocur-swift sim screenshot
# → Check if login succeeded or error shown
```

### Pattern 4: Verify List Content

```bash
# Goal: Verify a list shows expected items

# 1. Get hierarchy
nocur-swift ui hierarchy --depth 10
# → Parse the JSON to find list items

# 2. If items not visible, scroll
nocur-swift ui scroll down --amount 500

# 3. Screenshot to visually verify
nocur-swift sim screenshot
```

### Pattern 5: Debug Build Failure

```bash
# Build failed - understand why

# 1. Run build, capture errors
nocur-swift app build
# If success: false, check the error message

# 2. Parse error locations
# Errors include file path, line number, message
# Use this to navigate to and fix the issue

# 3. After fixing, rebuild
nocur-swift app build
# Repeat until success: true
```

---

## Parsing Nocur Output

All output is JSON. Key fields:

```json
{
  "success": true/false,      // Did the operation succeed?
  "timestamp": "...",         // When it ran
  "data": { ... },            // The actual result (if success)
  "error": "..."              // Error message (if failure)
}
```

### Checking Success

```python
# Python example
import json
result = json.loads(output)
if result["success"]:
    # Use result["data"]
else:
    # Handle result["error"]
```

### Extracting Screenshot Path

```json
{
  "success": true,
  "data": {
    "path": "/var/folders/.../screenshot_123.png"  // ← Use this path
  }
}
```

### Finding Elements

```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "identifier": "submitButton",
        "label": "Submit",
        "frame": {"x": 100, "y": 500, "width": 200, "height": 44}
      }
    ]
  }
}
```

---

## Best Practices

### 1. Always Wait for UI

```bash
# BAD: Screenshot immediately after launch
nocur-swift app launch com.example.app
nocur-swift sim screenshot  # UI not ready!

# GOOD: Wait for UI to render
nocur-swift app launch com.example.app
sleep 2  # Give UI time to render
nocur-swift sim screenshot
```

### 2. Use Accessibility IDs

When writing iOS code, add accessibility identifiers:

```swift
// SwiftUI
Button("Submit") { ... }
    .accessibilityIdentifier("submitButton")

// UIKit
button.accessibilityIdentifier = "submitButton"
```

Then use them:
```bash
nocur-swift ui tap --id "submitButton"  # Reliable!
```

### 3. Screenshot Before and After

```bash
# Verify a change
nocur-swift sim screenshot -o before.png
# ... make changes, rebuild, relaunch ...
nocur-swift sim screenshot -o after.png
# Compare the two images
```

### 4. Hierarchy for Structure, Screenshot for Appearance

- **Hierarchy**: "Is the button there? What's its type?"
- **Screenshot**: "Does it look right? Colors correct?"

Use both:
```bash
nocur-swift ui hierarchy  # Structural verification
nocur-swift sim screenshot  # Visual verification
```

### 5. Handle Errors Gracefully

```bash
# Check if simulator is running before operations
status=$(nocur-swift sim status)
if [[ $(echo "$status" | jq -r '.data.booted | length') -eq 0 ]]; then
    nocur-swift sim boot --wait
fi
```

---

## Troubleshooting

### "No booted simulator found"

```bash
nocur-swift sim boot --wait
```

### "Bundle ID required"

```bash
# Detect project to find bundle ID
nocur-swift project detect
# Use the bundleId from output
```

### "Element not found"

1. Check accessibility ID is correct
2. Check element is on screen (may need to scroll)
3. Try finding by label instead: `--label "Button Text"`

### Build fails

1. Check error output for file/line
2. Fix the code
3. Rebuild with `--clean` if needed

### Tap doesn't work

1. Element might be obscured
2. Animation might be in progress - add delay
3. Check coordinates are within screen bounds

---

## Output Format Reference

### Simulator Info
```json
{
  "udid": "UUID",
  "name": "iPhone 15 Pro",
  "runtime": "iOS 17.2",
  "state": "Booted"
}
```

### Screenshot Result
```json
{
  "path": "/path/to/screenshot.png",
  "width": 1179,
  "height": 2556,
  "simulator": "iPhone 15 Pro"
}
```

### View Node (Hierarchy)
```json
{
  "className": "UIButton",
  "frame": {"x": 0, "y": 0, "width": 100, "height": 44},
  "accessibilityIdentifier": "myButton",
  "accessibilityLabel": "Tap me",
  "isEnabled": true,
  "isHidden": false,
  "children": [...]
}
```

### Accessibility Element
```json
{
  "identifier": "myButton",
  "label": "Tap me",
  "value": null,
  "type": "button",
  "frame": {"x": 100, "y": 500, "width": 200, "height": 44},
  "isEnabled": true,
  "traits": ["button"]
}
```

---

## Example: Full Verification Flow

```bash
#!/bin/bash
# Complete example: Build, deploy, verify

# 1. Detect project
PROJECT=$(nocur-swift project detect)
BUNDLE_ID=$(echo "$PROJECT" | jq -r '.data.bundleId')
echo "Building: $BUNDLE_ID"

# 2. Build
BUILD=$(nocur-swift app build)
if [ "$(echo "$BUILD" | jq -r '.success')" != "true" ]; then
    echo "Build failed!"
    echo "$BUILD" | jq -r '.error'
    exit 1
fi
APP_PATH=$(echo "$BUILD" | jq -r '.data.appPath')

# 3. Ensure simulator running
STATUS=$(nocur-swift sim status)
if [ "$(echo "$STATUS" | jq -r '.data.booted | length')" -eq 0 ]; then
    nocur-swift sim boot --wait
fi

# 4. Install and launch
nocur-swift app install "$APP_PATH"
nocur-swift app launch "$BUNDLE_ID"
sleep 2

# 5. Take screenshot
SCREENSHOT=$(nocur-swift sim screenshot)
SCREENSHOT_PATH=$(echo "$SCREENSHOT" | jq -r '.data.path')
echo "Screenshot saved: $SCREENSHOT_PATH"

# 6. Get hierarchy
HIERARCHY=$(nocur-swift ui hierarchy)
echo "View hierarchy captured"

# 7. Verify specific element exists
BUTTON=$(nocur-swift ui find --id "mainButton")
if [ "$(echo "$BUTTON" | jq -r '.data.count')" -gt 0 ]; then
    echo "✓ Main button found!"
else
    echo "✗ Main button NOT found!"
    exit 1
fi

echo "Verification complete!"
```

---

## Remember

1. **Verify, don't assume** - Code compiling doesn't mean UI is correct
2. **Use structured data** - Hierarchy for programmatic checks
3. **Use screenshots** - For visual verification
4. **Add accessibility IDs** - Makes automation reliable
5. **Handle timing** - UI needs time to render

Happy verifying! 🎯

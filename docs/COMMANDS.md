# Nocur CLI Command Reference

Complete reference for the `nocur-swift` CLI tool.

## Overview

```bash
nocur-swift <command> <subcommand> [options]
```

All commands output JSON to stdout for easy parsing by AI agents.
Errors are written to stderr.

---

## Simulator Commands (`sim`)

### `sim list`

List available iOS simulators.

```bash
nocur-swift sim list [--booted] [--filter <name>]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--booted, -b` | Only show booted simulators |
| `--filter, -f <name>` | Filter by device name (partial match) |

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "simulators": [
      {
        "udid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        "name": "iPhone 15 Pro",
        "runtime": "iOS 17.2",
        "state": "Shutdown",
        "deviceType": "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro",
        "isAvailable": true
      }
    ],
    "count": 1
  }
}
```

---

### `sim boot`

Boot a simulator.

```bash
nocur-swift sim boot [identifier] [--wait]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `identifier` | Simulator UDID or name (optional - boots first available iPhone if omitted) |

**Options:**
| Option | Description |
|--------|-------------|
| `--wait` | Wait for boot to complete before returning |

**Example:**
```bash
# Boot first available iPhone
nocur-swift sim boot

# Boot specific simulator by name
nocur-swift sim boot "iPhone 15 Pro"

# Boot by UDID and wait
nocur-swift sim boot XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX --wait
```

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "udid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
    "name": "iPhone 15 Pro",
    "state": "Booted",
    "bootTime": 3.45
  }
}
```

---

### `sim shutdown`

Shutdown simulator(s).

```bash
nocur-swift sim shutdown [identifier]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `identifier` | Simulator UDID or name (optional - shuts down all if omitted) |

---

### `sim screenshot`

Capture a screenshot of the simulator.

```bash
nocur-swift sim screenshot [udid] [--output <path>]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `udid` | Simulator UDID (uses booted simulator if omitted) |

**Options:**
| Option | Description |
|--------|-------------|
| `--output, -o <path>` | Output path for screenshot (auto-generated if omitted) |

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "path": "/var/folders/.../screenshot_1705312200.png",
    "width": 1179,
    "height": 2556,
    "simulator": "iPhone 15 Pro",
    "format": "png"
  }
}
```

---

### `sim status`

Get current simulator status.

```bash
nocur-swift sim status
```

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "booted": [
      {
        "udid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
        "name": "iPhone 15 Pro",
        "runtime": "iOS 17.2",
        "state": "Booted"
      }
    ],
    "runningApps": [
      {
        "bundleId": "com.example.myapp",
        "name": "My App",
        "pid": 12345
      }
    ]
  }
}
```

---

## App Commands (`app`)

### `app build`

Build Xcode project for simulator.

```bash
nocur-swift app build [--project <path>] [--scheme <name>] [--configuration <config>] [--clean]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--project, -p <path>` | Path to .xcodeproj or .xcworkspace (auto-detects if omitted) |
| `--scheme, -s <name>` | Scheme to build |
| `--configuration <config>` | Build configuration: Debug or Release (default: Debug) |
| `--destination <udid>` | Target simulator UDID |
| `--clean` | Clean before building |

**Example Output (Success):**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "appPath": "/path/to/DerivedData/Build/Products/Debug-iphonesimulator/MyApp.app",
    "bundleId": "com.example.myapp",
    "buildTime": 12.34,
    "warnings": 2,
    "errors": 0
  }
}
```

**Example Output (Failure):**
```json
{
  "success": false,
  "timestamp": "2024-01-15T10:30:00Z",
  "error": "Build failed",
  "data": null
}
```

---

### `app install`

Install app to simulator.

```bash
nocur-swift app install [app-path] [--simulator <udid>]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `app-path` | Path to .app bundle (uses last build if omitted) |

**Options:**
| Option | Description |
|--------|-------------|
| `--simulator <udid>` | Target simulator UDID |

---

### `app launch`

Launch installed app.

```bash
nocur-swift app launch [bundle-id] [--simulator <udid>] [--wait-for-debugger] [-- args...]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `bundle-id` | Bundle identifier (e.g., com.example.app) |

**Options:**
| Option | Description |
|--------|-------------|
| `--simulator <udid>` | Target simulator UDID |
| `--wait-for-debugger` | Wait for debugger to attach |

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "bundleId": "com.example.myapp",
    "pid": 12345,
    "simulator": "iPhone 15 Pro"
  }
}
```

---

### `app kill`

Terminate running app.

```bash
nocur-swift app kill [bundle-id] [--simulator <udid>]
```

---

### `app uninstall`

Uninstall app from simulator.

```bash
nocur-swift app uninstall <bundle-id> [--simulator <udid>]
```

---

### `app list`

List installed apps.

```bash
nocur-swift app list [--simulator <udid>]
```

---

## UI Commands (`ui`)

### `ui hierarchy`

Dump view hierarchy.

```bash
nocur-swift ui hierarchy [--simulator <udid>] [--bundle-id <id>] [--depth <n>] [--include-hidden]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--simulator <udid>` | Target simulator UDID |
| `--bundle-id <id>` | Bundle ID of app to inspect |
| `--depth <n>` | Max depth to traverse |
| `--include-hidden` | Include hidden views |
| `--include-frames` | Include frame coordinates (default: true) |

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "captureMethod": "accessibility",
    "bundleId": "com.example.myapp",
    "root": {
      "className": "UIWindow",
      "frame": {"x": 0, "y": 0, "width": 393, "height": 852},
      "accessibilityIdentifier": null,
      "accessibilityLabel": null,
      "isEnabled": true,
      "isHidden": false,
      "children": [...]
    }
  }
}
```

---

### `ui accessibility`

Dump accessibility tree.

```bash
nocur-swift ui accessibility [--simulator <udid>] [--all]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--simulator <udid>` | Target simulator UDID |
| `--all` | Include non-accessible elements |

---

### `ui tap`

Tap at coordinates or element.

```bash
# Tap by coordinates
nocur-swift ui tap <x> <y> [--simulator <udid>] [--count <n>]

# Tap by accessibility ID
nocur-swift ui tap --id <identifier> [--simulator <udid>] [--count <n>]

# Tap by label
nocur-swift ui tap --label <text> [--simulator <udid>] [--count <n>]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `x` | X coordinate |
| `y` | Y coordinate |

**Options:**
| Option | Description |
|--------|-------------|
| `--id <identifier>` | Tap element by accessibility identifier |
| `--label <text>` | Tap element by accessibility label |
| `--simulator <udid>` | Target simulator UDID |
| `--count <n>` | Number of taps (default: 1) |

**Example:**
```bash
# Single tap at coordinates
nocur-swift ui tap 200 500

# Double tap a button by ID
nocur-swift ui tap --id submitButton --count 2

# Tap button by label
nocur-swift ui tap --label "Sign In"
```

---

### `ui scroll`

Scroll in a direction.

```bash
nocur-swift ui scroll <direction> [--amount <points>] [--id <element>] [--simulator <udid>]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `direction` | Direction: `up`, `down`, `left`, `right` |

**Options:**
| Option | Description |
|--------|-------------|
| `--amount <points>` | Scroll distance in points (default: 300) |
| `--id <element>` | Element identifier to scroll within |
| `--simulator <udid>` | Target simulator UDID |

---

### `ui type`

Type text.

```bash
nocur-swift ui type <text> [--id <element>] [--simulator <udid>] [--clear]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `text` | Text to type |

**Options:**
| Option | Description |
|--------|-------------|
| `--id <element>` | Element identifier to type into (taps to focus first) |
| `--simulator <udid>` | Target simulator UDID |
| `--clear` | Clear existing text before typing |

---

### `ui find`

Find UI elements.

```bash
nocur-swift ui find [--text <text>] [--type <type>] [--id <identifier>] [--simulator <udid>]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--text <text>` | Find by text content or label |
| `--type <type>` | Find by element type (button, textField, etc.) |
| `--id <identifier>` | Find by accessibility identifier |
| `--simulator <udid>` | Target simulator UDID |

---

## Project Commands (`project`)

### `project detect`

Auto-detect Xcode project.

```bash
nocur-swift project detect [--path <directory>]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--path, -p <directory>` | Directory to search (default: current) |

**Example Output:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "type": "workspace",
    "path": "/path/to/MyApp.xcworkspace",
    "name": "MyApp",
    "bundleId": "com.example.myapp",
    "schemes": ["MyApp", "MyAppTests"],
    "targets": [
      {"name": "MyApp", "type": "application"},
      {"name": "MyAppTests", "type": "test"}
    ]
  }
}
```

---

### `project info`

Get detailed project information.

```bash
nocur-swift project info [--project <path>]
```

---

### `project schemes`

List available schemes.

```bash
nocur-swift project schemes [--project <path>]
```

---

## Error Handling

All errors return JSON with `success: false`:

```json
{
  "success": false,
  "timestamp": "2024-01-15T10:30:00Z",
  "error": "Description of what went wrong",
  "data": null
}
```

Common error types:
- **Not found**: Simulator, app, or file not found
- **Invalid argument**: Missing or invalid parameter
- **Parse error**: Failed to parse command output
- **Timeout**: Operation timed out
- **Build failed**: Xcode build failed (includes error details)

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Not found |
| 4 | Timeout |
| 5 | Build failed |

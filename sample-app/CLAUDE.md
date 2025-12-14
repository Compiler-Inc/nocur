# NocurTestApp - iOS Test Application

## Project Overview
SwiftUI app for testing iOS 26 Foundation Models API integration.

## Project Structure (Tuist)
This project uses **Tuist** for Xcode project generation. The xcodeproj is generated from `Project.swift`, which means:
- **New Swift files are automatically included** - just create files in the appropriate directory
- **No need to manually edit the xcodeproj** - Tuist regenerates it on build
- Run `tuist generate` manually if you need to open in Xcode

### Key Files
- `Project.swift` - Tuist manifest defining the project structure
- `Tuist.swift` - Tuist configuration
- `NocurTestApp/` - All source files (auto-discovered by Tuist)

## Build Commands
Nocur automatically runs `tuist generate` before building when it detects a `Project.swift` file.

```bash
# Build (Tuist generate happens automatically)
nocur-swift app build

# Launch
nocur-swift app launch --bundle-id com.nocur.testapp

# Kill
nocur-swift app kill --bundle-id com.nocur.testapp

# Manual Tuist commands (if needed)
cd sample-app && tuist generate
cd sample-app && tuist edit  # Edit Project.swift in Xcode
```

## Verification Commands
```bash
# Take screenshot
nocur-swift sim screenshot

# Find UI element
nocur-swift ui find --text "Hello"

# Tap element
nocur-swift ui interact --tap 200 400
```

## Code Organization
- **Views/** - SwiftUI views (one per file)
- **ViewModels/** - MVVM view models
- **Models/** - Data models
- **Services/** - Business logic

## Rules
- After ANY code change: build and verify with screenshot
- After ANY UI interaction: take screenshot to confirm
- If something fails: acknowledge it, try different approach
- Be concise - fix problems, don't explain them

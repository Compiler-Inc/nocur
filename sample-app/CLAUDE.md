# NocurTestApp - iOS Test Application

## Project Overview
SwiftUI app for testing iOS 26 Foundation Models API integration.

## Build Commands
```bash
# Build
nocur-swift app build

# Launch
nocur-swift app launch --bundle-id com.nocur.NocurTestApp

# Kill
nocur-swift app kill --bundle-id com.nocur.NocurTestApp
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

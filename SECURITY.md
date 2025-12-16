# Security Policy

## Reporting a Vulnerability

Please do not open public GitHub issues for security reports.

- Preferred: open a GitHub Security Advisory for this repository.

## Security Model

Nocur is a local developer tool that can:

- Execute local processes (e.g. `xcodebuild`, `xcrun`, `git`)
- Spawn a local PTY (embedded terminal)
- Capture simulator/app state for debugging and verification

Treat Nocur like you would treat running scripts in a repo: only use it with projects you trust.

## Unsafe Modes

- Permission bypass / auto-approve modes are intended for trusted, local development only.


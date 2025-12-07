import ArgumentParser
import Core
import Foundation

struct App: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "app",
        abstract: "App lifecycle management",
        discussion: """
            Commands for building, installing, launching, and terminating
            iOS applications in the simulator.
            """,
        subcommands: [
            Build.self,
            Run.self,
            Install.self,
            Launch.self,
            Kill.self,
            Uninstall.self,
            ListApps.self,
            Crashes.self
        ]
    )
}

// MARK: - Build

extension App {
    struct Build: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Build Xcode project for simulator",
            discussion: """
                Builds the Xcode project or workspace for the iOS Simulator.
                Auto-detects project in current directory if not specified.

                Example output:
                {
                  "success": true,
                  "appPath": "/path/to/DerivedData/.../MyApp.app",
                  "bundleId": "com.example.myapp",
                  "buildTime": 12.34,
                  "warnings": 2,
                  "errors": 0
                }

                On failure:
                {
                  "success": false,
                  "error": "Build failed",
                  "errors": [
                    {
                      "file": "/path/to/File.swift",
                      "line": 42,
                      "message": "Cannot convert..."
                    }
                  ]
                }
                """
        )

        @Option(name: .shortAndLong, help: "Path to .xcodeproj or .xcworkspace")
        var project: String?

        @Option(name: .shortAndLong, help: "Scheme to build")
        var scheme: String?

        @Option(name: .long, help: "Build configuration (Debug/Release)")
        var configuration: String = "Debug"

        @Option(name: .long, help: "Destination simulator UDID")
        var destination: String?

        @Flag(name: .long, help: "Clean before building")
        var clean: Bool = false

        func run() async throws {
            let builder = XcodeBuildRunner()
            do {
                let result = try await builder.build(
                    projectPath: project,
                    scheme: scheme,
                    configuration: configuration,
                    destinationUDID: destination,
                    clean: clean
                )
                print(Output.success(result).json)
            } catch let error as NocurError {
                // Handle build failures with structured error output
                if case .buildFailed(let errors) = error {
                    let failureResult = BuildFailureResult(errors: errors)
                    print(Output.success(failureResult).json)
                } else {
                    print(Output<BuildResult>.failure(error.localizedDescription).json)
                }
            } catch {
                print(Output<BuildResult>.failure(error.localizedDescription).json)
            }
        }
    }
}

// MARK: - Run (Build + Install + Launch)

extension App {
    struct Run: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Build and run app in simulator",
            discussion: """
                Builds the project, installs, and launches in one command.
                This is equivalent to Xcode's Run button - ensures the app
                has the latest code changes.

                Example:
                  nocur-swift app run                    # Build and run current project
                  nocur-swift app run --scheme MyApp    # Use specific scheme
                  nocur-swift app run --clean           # Clean build first

                Example output:
                {
                  "success": true,
                  "data": {
                    "bundleId": "com.example.myapp",
                    "pid": 12345,
                    "simulator": "iPhone 15 Pro",
                    "buildTime": 5.2,
                    "rebuilt": true
                  }
                }
                """
        )

        @Option(name: .shortAndLong, help: "Path to .xcodeproj or .xcworkspace")
        var project: String?

        @Option(name: .shortAndLong, help: "Scheme to build and run")
        var scheme: String?

        @Option(name: .long, help: "Build configuration (Debug/Release)")
        var configuration: String = "Debug"

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Flag(name: .long, help: "Clean before building")
        var clean: Bool = false

        func run() async throws {
            let startTime = Date()

            // 1. Build the project
            let builder = XcodeBuildRunner()
            let buildResult: BuildResult
            do {
                buildResult = try await builder.build(
                    projectPath: project,
                    scheme: scheme,
                    configuration: configuration,
                    destinationUDID: simulator,
                    clean: clean
                )
            } catch let error as NocurError {
                if case .buildFailed(let errors) = error {
                    let failureResult = BuildFailureResult(errors: errors)
                    print(Output.success(failureResult).json)
                    return
                }
                throw error
            }

            // 2. Install the app
            let controller = SimulatorController()
            _ = try await controller.installApp(
                appPath: buildResult.appPath,
                simulatorUDID: simulator
            )

            // 3. Launch the app
            let launchResult = try await controller.launchApp(
                bundleId: buildResult.bundleId,
                simulatorUDID: simulator,
                waitForDebugger: false,
                arguments: []
            )

            let buildTime = Date().timeIntervalSince(startTime)

            let result = RunResult(
                bundleId: launchResult.bundleId,
                pid: launchResult.pid,
                simulator: launchResult.simulator,
                buildTime: buildTime,
                rebuilt: true
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Install

extension App {
    struct Install: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Install app to simulator",
            discussion: """
                Installs a built .app bundle to the simulator.
                If no path provided, uses the most recent build output.

                Example:
                  nocur-swift app install                     # Install last build
                  nocur-swift app install /path/to/App.app    # Install specific app
                """
        )

        @Argument(help: "Path to .app bundle (optional)")
        var appPath: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.installApp(
                appPath: appPath,
                simulatorUDID: simulator
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Launch

extension App {
    struct Launch: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Launch app in simulator",
            discussion: """
                Launches an installed app by bundle identifier.
                Auto-detects bundle ID from recent build if not specified.

                Example output:
                {
                  "success": true,
                  "bundleId": "com.example.myapp",
                  "pid": 12345,
                  "simulator": "iPhone 15 Pro"
                }
                """
        )

        @Argument(help: "Bundle identifier (e.g., com.example.app)")
        var bundleId: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Flag(name: .long, help: "Wait for debugger to attach")
        var waitForDebugger: Bool = false

        @Argument(help: "Arguments to pass to the app")
        var args: [String] = []

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.launchApp(
                bundleId: bundleId,
                simulatorUDID: simulator,
                waitForDebugger: waitForDebugger,
                arguments: args
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Kill

extension App {
    struct Kill: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Terminate running app",
            discussion: """
                Terminates a running app by bundle identifier.

                Example:
                  nocur-swift app kill com.example.myapp
                """
        )

        @Argument(help: "Bundle identifier")
        var bundleId: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.terminateApp(
                bundleId: bundleId,
                simulatorUDID: simulator
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Uninstall

extension App {
    struct Uninstall: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Uninstall app from simulator",
            discussion: """
                Removes an installed app from the simulator.
                """
        )

        @Argument(help: "Bundle identifier")
        var bundleId: String

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.uninstallApp(
                bundleId: bundleId,
                simulatorUDID: simulator
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - List Apps

extension App {
    struct ListApps: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "list",
            abstract: "List installed apps",
            discussion: """
                Lists all apps installed on the simulator.

                Example output:
                {
                  "success": true,
                  "apps": [
                    {
                      "bundleId": "com.example.myapp",
                      "name": "My App",
                      "version": "1.0.0",
                      "path": "/path/to/app"
                    }
                  ]
                }
                """
        )

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.listInstalledApps(simulatorUDID: simulator)
            print(Output.success(result).json)
        }
    }
}

// MARK: - Crashes

extension App {
    struct Crashes: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "List and view crash reports",
            discussion: """
                Lists crash reports from the simulator using idb.
                Filter by bundle ID to see only crashes for a specific app.

                Example:
                  nocur-swift app crashes                              # List all crashes
                  nocur-swift app crashes --bundle-id com.example.app  # Filter by app
                  nocur-swift app crashes --show crash_name.ips        # Show crash details

                Output (list):
                {
                  "success": true,
                  "data": {
                    "crashes": [
                      {
                        "name": "MyApp-2024-01-15-103045.ips",
                        "bundleId": "com.example.app",
                        "processName": "MyApp",
                        "timestamp": "2024-01-15 10:30:45"
                      }
                    ],
                    "count": 1,
                    "filter": null
                  }
                }

                Output (show):
                {
                  "success": true,
                  "data": {
                    "name": "MyApp-2024-01-15-103045.ips",
                    "contents": "...",
                    "summary": "Exception Type: EXC_CRASH (SIGABRT)..."
                  }
                }
                """
        )

        @Option(name: .shortAndLong, help: "Filter by bundle ID")
        var bundleId: String?

        @Option(name: .shortAndLong, help: "Show detailed crash report by name")
        var show: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Option(name: .shortAndLong, help: "Maximum number of crashes to list (default: 10)")
        var limit: Int = 10

        func run() async throws {
            let reporter = CrashReporter()

            if let crashName = show {
                // Show detailed crash report
                let result = try await reporter.getCrashDetails(
                    name: crashName,
                    simulatorUDID: simulator
                )
                print(Output.success(result).json)
            } else {
                // List crashes
                let result = try await reporter.listCrashes(
                    bundleId: bundleId,
                    simulatorUDID: simulator,
                    limit: limit
                )
                print(Output.success(result).json)
            }
        }
    }
}

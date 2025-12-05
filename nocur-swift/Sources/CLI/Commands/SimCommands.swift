import ArgumentParser
import Core

struct Sim: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "sim",
        abstract: "iOS Simulator control",
        discussion: """
            Commands for managing iOS Simulators: listing available devices,
            booting/shutting down simulators, and capturing screenshots.
            """,
        subcommands: [
            List.self,
            Boot.self,
            Shutdown.self,
            Screenshot.self,
            Observe.self,
            Diff.self,
            Status.self
        ],
        defaultSubcommand: List.self
    )
}

// MARK: - List

extension Sim {
    struct List: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "List available simulators",
            discussion: """
                Returns all available iOS simulators with their UDID, name,
                runtime, and current state.

                Example output:
                {
                  "success": true,
                  "simulators": [
                    {
                      "udid": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
                      "name": "iPhone 15 Pro",
                      "runtime": "iOS 17.2",
                      "state": "Shutdown"
                    }
                  ]
                }
                """
        )

        @Flag(name: .shortAndLong, help: "Only show booted simulators")
        var booted: Bool = false

        @Option(name: .shortAndLong, help: "Filter by device name (partial match)")
        var filter: String?

        func run() async throws {
            let controller = SimulatorController()
            let simulators = try await controller.listSimulators(
                bootedOnly: booted,
                filter: filter
            )
            print(Output.success(simulators).json)
        }
    }
}

// MARK: - Boot

extension Sim {
    struct Boot: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Boot a simulator",
            discussion: """
                Boots the specified simulator by UDID or name.
                If no identifier is provided, boots the first available iPhone.

                Example:
                  nocur-swift sim boot                           # Boot first available
                  nocur-swift sim boot "iPhone 15 Pro"           # Boot by name
                  nocur-swift sim boot XXXXXXXX-XXXX-XXXX-...   # Boot by UDID
                """
        )

        @Argument(help: "Simulator UDID or name (optional)")
        var identifier: String?

        @Flag(name: .long, help: "Wait for boot to complete")
        var wait: Bool = false

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.bootSimulator(
                identifier: identifier,
                wait: wait
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Shutdown

extension Sim {
    struct Shutdown: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Shutdown a simulator",
            discussion: """
                Shuts down the specified simulator or all booted simulators.

                Example:
                  nocur-swift sim shutdown                  # Shutdown all
                  nocur-swift sim shutdown "iPhone 15"      # Shutdown by name
                """
        )

        @Argument(help: "Simulator UDID or name (optional, shuts down all if omitted)")
        var identifier: String?

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.shutdownSimulator(identifier: identifier)
            print(Output.success(result).json)
        }
    }
}

// MARK: - Screenshot

extension Sim {
    struct Screenshot: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Capture simulator screenshot",
            discussion: """
                Captures a screenshot of the specified or booted simulator.

                Use --base64 to get the image data directly in JSON output
                (no file operations needed). This is MUCH faster for AI agents.

                Use --jpeg for faster encoding and smaller files (default with --base64).

                Example output (with --base64):
                {
                  "success": true,
                  "base64": "data:image/jpeg;base64,...",
                  "width": 1179,
                  "height": 2556,
                  "simulator": "iPhone 15 Pro"
                }
                """
        )

        @Argument(help: "Simulator UDID (uses booted if omitted)")
        var udid: String?

        @Option(name: .shortAndLong, help: "Output path (auto-generated if omitted)")
        var output: String?

        @Flag(name: .long, help: "Output base64-encoded image in JSON (fastest for agents)")
        var base64: Bool = false

        @Flag(name: .long, help: "Use JPEG format (faster, smaller)")
        var jpeg: Bool = false

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.takeScreenshot(
                udid: udid,
                outputPath: output,
                base64Output: base64,
                useJpeg: jpeg
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Observe

extension Sim {
    struct Observe: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Observe simulator over time (screenshot sequence)",
            discussion: """
                Captures multiple screenshots over a duration to understand app behavior.
                This is a workaround for video recording when the agent doesn't support video.

                Useful for:
                - Understanding animations
                - Verifying transitions
                - Observing loading states
                - Debugging timing issues

                Example:
                  nocur-swift sim observe --duration 2 --frames 5

                Output:
                {
                  "success": true,
                  "data": {
                    "frames": [
                      { "timestamp": 0.0, "image": "data:image/jpeg;base64,..." },
                      { "timestamp": 0.5, "image": "data:image/jpeg;base64,..." },
                      ...
                    ],
                    "duration": 2.0,
                    "frameCount": 5,
                    "simulator": "iPhone 16 Pro"
                  }
                }
                """
        )

        @Argument(help: "Simulator UDID (uses booted if omitted)")
        var udid: String?

        @Option(name: .shortAndLong, help: "Duration in seconds (max 5)")
        var duration: Double = 2.0

        @Option(name: .shortAndLong, help: "Number of frames to capture (2-10)")
        var frames: Int = 5

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.observe(
                udid: udid,
                duration: duration,
                frames: frames
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Diff

extension Sim {
    struct Diff: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Compare current screen to a reference screenshot",
            discussion: """
                Compares the current simulator screen to a reference image.
                Useful for verifying that UI changes have been applied correctly.

                Example:
                  nocur-swift sim diff /path/to/reference.png

                Output:
                {
                  "success": true,
                  "data": {
                    "changesDetected": true,
                    "changePercentage": 15.5,
                    "changedRegions": [...],
                    "summary": "Moderate changes detected: 15% of screen changed",
                    "currentScreenshot": "data:image/jpeg;base64,..."
                  }
                }
                """
        )

        @Argument(help: "Path to reference screenshot to compare against")
        var reference: String

        @Argument(help: "Simulator UDID (uses booted if omitted)")
        var udid: String?

        @Option(name: .shortAndLong, help: "Minimum change percentage to report (default: 5)")
        var threshold: Double = 5.0

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.diff(
                udid: udid,
                referencePath: reference,
                threshold: threshold
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Status

extension Sim {
    struct Status: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Get current simulator status",
            discussion: """
                Returns the status of the currently booted simulator(s),
                including device info, installed apps, and running processes.
                """
        )

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.getStatus()
            print(Output.success(result).json)
        }
    }
}

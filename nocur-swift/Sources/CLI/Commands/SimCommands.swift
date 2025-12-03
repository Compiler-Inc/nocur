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
                Returns the path to the saved PNG file.

                Example output:
                {
                  "success": true,
                  "path": "/var/folders/.../screenshot_1234567890.png",
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

        func run() async throws {
            let controller = SimulatorController()
            let result = try await controller.takeScreenshot(
                udid: udid,
                outputPath: output
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

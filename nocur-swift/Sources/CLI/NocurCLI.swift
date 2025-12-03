import ArgumentParser
import Core

@main
struct NocurCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "nocur-swift",
        abstract: "iOS development toolkit for AI agents",
        discussion: """
            Nocur provides programmatic access to iOS Simulator control,
            app lifecycle management, view hierarchy introspection, and
            UI interaction - all designed for AI agent consumption.

            All commands output JSON to stdout for easy parsing.
            Errors are written to stderr.
            """,
        version: "0.1.0",
        subcommands: [
            Sim.self,
            App.self,
            UI.self,
            Project.self
        ]
    )
}

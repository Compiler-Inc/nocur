import ArgumentParser
import Core

struct Project: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "project",
        abstract: "Xcode project utilities",
        discussion: """
            Commands for detecting and inspecting Xcode projects.
            """,
        subcommands: [
            Detect.self,
            Info.self,
            Schemes.self
        ],
        defaultSubcommand: Detect.self
    )
}

// MARK: - Detect

extension Project {
    struct Detect: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Auto-detect Xcode project",
            discussion: """
                Searches for Xcode projects or workspaces in the current
                directory or specified path. Prefers workspaces over projects.

                Example output:
                {
                  "success": true,
                  "type": "workspace",
                  "path": "/path/to/MyApp.xcworkspace",
                  "name": "MyApp",
                  "schemes": ["MyApp", "MyAppTests"],
                  "targets": ["MyApp", "MyAppTests"]
                }
                """
        )

        @Option(name: .shortAndLong, help: "Directory to search (default: current)")
        var path: String?

        func run() async throws {
            let detector = ProjectDetector()
            let result = try await detector.detectProject(in: path)
            print(Output.success(result).json)
        }
    }
}

// MARK: - Info

extension Project {
    struct Info: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Get project information",
            discussion: """
                Returns detailed information about an Xcode project.

                Example output:
                {
                  "success": true,
                  "name": "MyApp",
                  "path": "/path/to/MyApp.xcodeproj",
                  "bundleId": "com.example.myapp",
                  "version": "1.0.0",
                  "buildNumber": "1",
                  "deploymentTarget": "16.0",
                  "swiftVersion": "5.9",
                  "targets": [
                    {
                      "name": "MyApp",
                      "type": "application",
                      "bundleId": "com.example.myapp"
                    }
                  ],
                  "dependencies": [
                    {"name": "Alamofire", "version": "5.8.0"}
                  ]
                }
                """
        )

        @Option(name: .shortAndLong, help: "Path to project/workspace")
        var project: String?

        func run() async throws {
            let detector = ProjectDetector()
            let result = try await detector.getProjectInfo(path: project)
            print(Output.success(result).json)
        }
    }
}

// MARK: - Schemes

extension Project {
    struct Schemes: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "List available schemes",
            discussion: """
                Lists all schemes in the project/workspace.

                Example output:
                {
                  "success": true,
                  "schemes": [
                    {
                      "name": "MyApp",
                      "shared": true,
                      "buildable": true
                    }
                  ]
                }
                """
        )

        @Option(name: .shortAndLong, help: "Path to project/workspace")
        var project: String?

        func run() async throws {
            let detector = ProjectDetector()
            let result = try await detector.listSchemes(path: project)
            print(Output.success(result).json)
        }
    }
}

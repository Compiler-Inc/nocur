import ArgumentParser
import Core

struct Project: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "project",
        abstract: "Xcode project utilities",
        discussion: """
            Commands for detecting, inspecting, and modifying Xcode projects.
            """,
        subcommands: [
            Detect.self,
            Info.self,
            Schemes.self,
            AddFiles.self
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

// MARK: - Add Files

extension Project {
    struct AddFiles: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "add-files",
            abstract: "Add files to Xcode project",
            discussion: """
                Adds source files to an Xcode project and target.
                This is essential after creating new Swift files - they won't
                appear in Xcode until added to the project.

                Example:
                  nocur-swift project add-files MyView.swift
                  nocur-swift project add-files File1.swift File2.swift --target MyApp
                  nocur-swift project add-files Views/*.swift --group Sources/Views

                Example output:
                {
                  "success": true,
                  "data": {
                    "project": "/path/to/MyApp.xcodeproj",
                    "target": "MyApp",
                    "files": [
                      {"path": "MyView.swift", "name": "MyView.swift", "added": true}
                    ],
                    "addedCount": 1
                  }
                }
                """
        )

        @Argument(help: "File paths to add")
        var files: [String]

        @Option(name: .shortAndLong, help: "Path to .xcodeproj (auto-detects if not specified)")
        var project: String?

        @Option(name: .shortAndLong, help: "Target name (uses first target if not specified)")
        var target: String?

        @Option(name: .shortAndLong, help: "Group path in project (e.g., 'Sources/Views')")
        var group: String?

        func run() async throws {
            let modifier = ProjectModifier()
            do {
                let result = try await modifier.addFiles(
                    files,
                    projectPath: project,
                    targetName: target,
                    groupPath: group
                )
                print(Output.success(result).json)
            } catch {
                print(Output<AddFilesResult>.failure(error.localizedDescription).json)
            }
        }
    }
}

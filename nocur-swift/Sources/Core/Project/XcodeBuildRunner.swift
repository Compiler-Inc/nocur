import Foundation

/// Wraps xcodebuild for building iOS apps
public final class XcodeBuildRunner {

    public init() {}

    // MARK: - Build

    public func build(
        projectPath: String?,
        scheme: String?,
        configuration: String,
        destinationUDID: String?,
        clean: Bool
    ) async throws -> BuildResult {
        let detector = ProjectDetector()

        // Detect project if not provided
        let projectInfo = try await detector.detectProject(in: projectPath.flatMap { URL(fileURLWithPath: $0).deletingLastPathComponent().path })

        // Determine scheme
        let buildScheme: String
        if let scheme = scheme {
            buildScheme = scheme
        } else if let firstScheme = projectInfo.schemes.first {
            buildScheme = firstScheme
        } else {
            throw NocurError.invalidArgument("No scheme found. Please specify --scheme")
        }

        // Build destination
        let destination: String
        if let udid = destinationUDID {
            destination = "platform=iOS Simulator,id=\(udid)"
        } else {
            destination = "platform=iOS Simulator,name=iPhone 15 Pro"
        }

        // Construct xcodebuild command
        var args = ["xcodebuild"]

        if projectInfo.type == "workspace" {
            args.append(contentsOf: ["-workspace", projectInfo.path])
        } else {
            args.append(contentsOf: ["-project", projectInfo.path])
        }

        args.append(contentsOf: [
            "-scheme", buildScheme,
            "-configuration", configuration,
            "-destination", destination,
            "-derivedDataPath", "DerivedData"
        ])

        if clean {
            args.append("clean")
        }
        args.append("build")

        // Run build and capture output
        let startTime = Date()
        var warnings = 0
        var errors = 0
        var buildErrors: [BuildError] = []

        let exitCode = try await shellStreaming(args) { stdout in
            // Parse warnings and errors
            for line in stdout.components(separatedBy: "\n") {
                if line.contains("warning:") {
                    warnings += 1
                } else if line.contains("error:") {
                    errors += 1
                    // Parse error details
                    let error = parseCompileError(line)
                    if let error = error {
                        buildErrors.append(error)
                    }
                }
            }
        } onStderr: { stderr in
            // Errors also come through stderr
            for line in stderr.components(separatedBy: "\n") {
                if line.contains("error:") {
                    errors += 1
                    let error = parseCompileError(line)
                    if let error = error {
                        buildErrors.append(error)
                    }
                }
            }
        }

        let buildTime = Date().timeIntervalSince(startTime)

        if exitCode != 0 {
            throw NocurError.buildFailed(errors: buildErrors)
        }

        // Find built app
        let appPath = try findBuiltApp(
            derivedDataPath: "DerivedData",
            scheme: buildScheme,
            configuration: configuration
        )

        // Get bundle ID
        let bundleId = try getBundleId(appPath: appPath)

        return BuildResult(
            appPath: appPath,
            bundleId: bundleId,
            buildTime: buildTime,
            warnings: warnings,
            errors: errors
        )
    }

    // MARK: - Helpers

    private func parseCompileError(_ line: String) -> BuildError? {
        // Format: /path/to/File.swift:42:10: error: message
        let pattern = #"(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else {
            return nil
        }

        let file = line[Range(match.range(at: 1), in: line)!]
        let lineNum = Int(line[Range(match.range(at: 2), in: line)!])
        let column = Int(line[Range(match.range(at: 3), in: line)!])
        let severity = String(line[Range(match.range(at: 4), in: line)!])
        let message = String(line[Range(match.range(at: 5), in: line)!])

        return BuildError(
            file: String(file),
            line: lineNum,
            column: column,
            message: message,
            severity: severity
        )
    }

    private func findBuiltApp(derivedDataPath: String, scheme: String, configuration: String) throws -> String {
        let buildDir = "\(derivedDataPath)/Build/Products/\(configuration)-iphonesimulator"

        let contents = try FileManager.default.contentsOfDirectory(atPath: buildDir)
        guard let app = contents.first(where: { $0.hasSuffix(".app") }) else {
            throw NocurError.notFound("Built app not found in \(buildDir)")
        }

        return (buildDir as NSString).appendingPathComponent(app)
    }

    private func getBundleId(appPath: String) throws -> String {
        let plistPath = "\(appPath)/Info.plist"
        guard let data = FileManager.default.contents(atPath: plistPath),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let bundleId = plist["CFBundleIdentifier"] as? String else {
            throw NocurError.parseError("Failed to read bundle ID from \(appPath)")
        }
        return bundleId
    }
}

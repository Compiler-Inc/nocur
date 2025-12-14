import Foundation

// DeviceInfo is defined in Core/Device/DeviceManager.swift

/// Wraps xcodebuild for building iOS apps
public final class XcodeBuildRunner {

    public init() {}

    // MARK: - Build with Device Info

    /// Build for a specific device (simulator or physical)
    public func build(
        projectPath: String?,
        scheme: String?,
        configuration: String,
        device: DeviceInfo?,
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

        // Build destination based on device type
        let destination: String
        let isPhysicalDevice: Bool
        
        if let device = device {
            switch device.deviceType {
            case .simulator:
                destination = "platform=iOS Simulator,id=\(device.id)"
                isPhysicalDevice = false
            case .physical:
                destination = "platform=iOS,id=\(device.id)"
                isPhysicalDevice = true
            }
        } else {
            // Default to simulator
            destination = "platform=iOS Simulator,name=iPhone 16 Pro"
            isPhysicalDevice = false
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
        
        // For physical devices, allow automatic provisioning updates
        if isPhysicalDevice {
            args.append("-allowProvisioningUpdates")
        }

        if clean {
            args.append("clean")
        }
        args.append("build")

        // Run build and capture all output
        let startTime = Date()

        let (exitCode, stdout, stderr) = await runBuild(args: args)

        let buildTime = Date().timeIntervalSince(startTime)

        // Parse all output for errors and warnings
        let allOutput = stdout + "\n" + stderr
        let (buildErrors, warnings) = parseOutput(allOutput)

        if exitCode != 0 {
            throw NocurError.buildFailed(errors: buildErrors)
        }

        // Find built app (different path for device vs simulator)
        let appPath = try findBuiltApp(
            derivedDataPath: "DerivedData",
            scheme: buildScheme,
            configuration: configuration,
            isPhysicalDevice: isPhysicalDevice
        )

        // Get bundle ID
        let bundleId = try getBundleId(appPath: appPath)

        return BuildResult(
            appPath: appPath,
            bundleId: bundleId,
            buildTime: buildTime,
            warnings: warnings,
            errors: buildErrors.count
        )
    }
    
    // MARK: - Legacy Build (for backward compatibility)

    public func build(
        projectPath: String?,
        scheme: String?,
        configuration: String,
        destinationUDID: String?,
        clean: Bool
    ) async throws -> BuildResult {
        // Convert UDID to DeviceInfo if provided
        var device: DeviceInfo? = nil
        if let udid = destinationUDID {
            // Assume simulator for legacy calls
            device = DeviceInfo(
                id: udid,
                name: "Simulator",
                model: "Simulator",
                osVersion: "Unknown",
                deviceType: .simulator,
                state: .booted,
                isAvailable: true
            )
        }
        
        return try await build(
            projectPath: projectPath,
            scheme: scheme,
            configuration: configuration,
            device: device,
            clean: clean
        )
    }

    // MARK: - Build Execution

    private func runBuild(args: [String]) async -> (exitCode: Int32, stdout: String, stderr: String) {
        await withCheckedContinuation { continuation in
            let process = Process()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()

            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = args
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe
            process.environment = ProcessInfo.processInfo.environment

            do {
                try process.run()
                process.waitUntilExit()

                let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
                let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

                let stdout = String(data: stdoutData, encoding: .utf8) ?? ""
                let stderr = String(data: stderrData, encoding: .utf8) ?? ""

                continuation.resume(returning: (process.terminationStatus, stdout, stderr))
            } catch {
                continuation.resume(returning: (-1, "", error.localizedDescription))
            }
        }
    }

    private func parseOutput(_ output: String) -> (errors: [BuildError], warnings: Int) {
        var errors: [BuildError] = []
        var warnings = 0

        for line in output.components(separatedBy: "\n") {
            if line.contains(": warning:") {
                warnings += 1
            } else if line.contains(": error:") {
                if let error = parseCompileError(line) {
                    errors.append(error)
                }
            }
        }

        return (errors, warnings)
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

    private func findBuiltApp(
        derivedDataPath: String,
        scheme: String,
        configuration: String,
        isPhysicalDevice: Bool = false
    ) throws -> String {
        // Physical devices use "iphoneos", simulators use "iphonesimulator"
        let sdk = isPhysicalDevice ? "iphoneos" : "iphonesimulator"
        let buildDir = "\(derivedDataPath)/Build/Products/\(configuration)-\(sdk)"

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

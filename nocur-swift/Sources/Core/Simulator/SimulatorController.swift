import Foundation

/// Controls iOS Simulator via simctl
public final class SimulatorController {

    public init() {}

    // MARK: - List Simulators

    public func listSimulators(bootedOnly: Bool = false, filter: String? = nil) async throws -> SimulatorListResult {
        let output = try await shell("xcrun", "simctl", "list", "devices", "-j")

        guard let data = output.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = json["devices"] as? [String: [[String: Any]]] else {
            throw NocurError.parseError("Failed to parse simctl output")
        }

        var simulators: [SimulatorInfo] = []

        for (runtime, deviceList) in devices {
            // Extract iOS version from runtime string
            let runtimeName = runtime
                .replacingOccurrences(of: "com.apple.CoreSimulator.SimRuntime.", with: "")
                .replacingOccurrences(of: "-", with: " ")
                .replacingOccurrences(of: "iOS ", with: "iOS ")

            for device in deviceList {
                guard let udid = device["udid"] as? String,
                      let name = device["name"] as? String,
                      let stateString = device["state"] as? String,
                      let isAvailable = device["isAvailable"] as? Bool else {
                    continue
                }

                let state = SimulatorState(rawValue: stateString) ?? .unknown
                let deviceType = device["deviceTypeIdentifier"] as? String ?? "Unknown"

                // Apply filters
                if bootedOnly && state != .booted {
                    continue
                }

                if let filter = filter?.lowercased(),
                   !name.lowercased().contains(filter) {
                    continue
                }

                let info = SimulatorInfo(
                    udid: udid,
                    name: name,
                    runtime: runtimeName,
                    state: state,
                    deviceType: deviceType,
                    isAvailable: isAvailable
                )
                simulators.append(info)
            }
        }

        // Sort by name, then runtime
        simulators.sort { ($0.name, $0.runtime) < ($1.name, $1.runtime) }

        return SimulatorListResult(simulators: simulators)
    }

    // MARK: - Boot Simulator

    public func bootSimulator(identifier: String?, wait: Bool = false) async throws -> BootResult {
        let udid: String
        let name: String

        if let identifier = identifier {
            // Find by UDID or name
            let list = try await listSimulators()
            if let sim = list.simulators.first(where: { $0.udid == identifier }) {
                udid = sim.udid
                name = sim.name
            } else if let sim = list.simulators.first(where: { $0.name.lowercased().contains(identifier.lowercased()) }) {
                udid = sim.udid
                name = sim.name
            } else {
                throw NocurError.notFound("Simulator not found: \(identifier)")
            }
        } else {
            // Boot first available iPhone
            let list = try await listSimulators()
            guard let sim = list.simulators.first(where: {
                $0.name.contains("iPhone") && $0.isAvailable && $0.state == .shutdown
            }) else {
                throw NocurError.notFound("No available iPhone simulator found")
            }
            udid = sim.udid
            name = sim.name
        }

        let startTime = Date()
        _ = try await shell("xcrun", "simctl", "boot", udid)

        if wait {
            // Wait for boot to complete
            try await waitForState(udid: udid, state: .booted, timeout: 60)
        }

        let bootTime = Date().timeIntervalSince(startTime)

        return BootResult(
            udid: udid,
            name: name,
            state: .booted,
            bootTime: bootTime
        )
    }

    // MARK: - Shutdown Simulator

    public func shutdownSimulator(identifier: String?) async throws -> EmptyResponse {
        if let identifier = identifier {
            // Shutdown specific simulator
            let list = try await listSimulators(bootedOnly: true)
            if let sim = list.simulators.first(where: { $0.udid == identifier || $0.name.lowercased().contains(identifier.lowercased()) }) {
                _ = try await shell("xcrun", "simctl", "shutdown", sim.udid)
            } else {
                throw NocurError.notFound("Booted simulator not found: \(identifier)")
            }
        } else {
            // Shutdown all
            _ = try await shell("xcrun", "simctl", "shutdown", "all")
        }

        return EmptyResponse("Simulator shutdown complete")
    }

    // MARK: - Screenshot

    public func takeScreenshot(udid: String?, outputPath: String?, base64Output: Bool = false, useJpeg: Bool = false) async throws -> ScreenshotResult {
        let targetUDID = try await resolveSimulator(udid)
        let list = try await listSimulators()
        let simName = list.simulators.first { $0.udid == targetUDID }?.name ?? "Unknown"

        let format = useJpeg || base64Output ? "jpeg" : "png"
        let ext = format == "jpeg" ? "jpg" : "png"
        let path = outputPath ?? FileManager.default.temporaryDirectory
            .appendingPathComponent("screenshot_\(Int(Date().timeIntervalSince1970)).\(ext)")
            .path

        // simctl supports --type png|jpeg
        _ = try await shell("xcrun", "simctl", "io", targetUDID, "screenshot", "--type=\(format)", path)

        // Get image dimensions
        let (width, height) = try getImageDimensions(path: path)

        if base64Output {
            // Read file and compress for smaller context size
            guard let data = FileManager.default.contents(atPath: path) else {
                throw NocurError.notFound("Screenshot file not found")
            }

            // Resize and compress to reduce context usage (~150KB -> ~30KB)
            let compressedData = compressImageForContext(data: data, maxWidth: 600, jpegQuality: 0.5)
            let base64String = compressedData.base64EncodedString()

            // Get new dimensions after resize
            let (newWidth, newHeight) = getCompressedDimensions(originalWidth: width, originalHeight: height, maxWidth: 600)

            // Clean up temp file
            try? FileManager.default.removeItem(atPath: path)

            return ScreenshotResult(
                base64: "data:image/jpeg;base64,\(base64String)",
                width: newWidth,
                height: newHeight,
                simulator: simName,
                format: "jpeg"
            )
        }

        return ScreenshotResult(
            path: path,
            width: width,
            height: height,
            simulator: simName,
            format: format
        )
    }

    // MARK: - Observe (Screenshot Sequence)

    /// Capture multiple screenshots over a duration for understanding app behavior
    public func observe(
        udid: String?,
        duration: Double,
        frames: Int = 5
    ) async throws -> ObserveResult {
        let targetUDID = try await resolveSimulator(udid)
        let list = try await listSimulators()
        let simName = list.simulators.first { $0.udid == targetUDID }?.name ?? "Unknown"

        // Cap duration at 5 seconds to avoid huge payloads
        let cappedDuration = min(duration, 5.0)
        // Cap frames at 10
        let cappedFrames = min(max(frames, 2), 10)

        let interval = cappedDuration / Double(cappedFrames - 1)
        var capturedFrames: [ObserveFrame] = []
        let startTime = Date()

        for i in 0..<cappedFrames {
            // Capture frame
            let screenshotResult = try await takeScreenshot(
                udid: targetUDID,
                outputPath: nil,
                base64Output: true,
                useJpeg: true
            )

            let timestamp = Date().timeIntervalSince(startTime)
            if let base64 = screenshotResult.base64 {
                capturedFrames.append(ObserveFrame(
                    timestamp: timestamp,
                    image: base64
                ))
            }

            // Wait for next frame (except after last)
            if i < cappedFrames - 1 {
                try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }

        let actualDuration = Date().timeIntervalSince(startTime)

        return ObserveResult(
            frames: capturedFrames,
            duration: actualDuration,
            simulator: simName
        )
    }

    // MARK: - Diff (Screen Comparison)

    /// Compare current simulator state to a reference screenshot
    public func diff(
        udid: String?,
        referencePath: String,
        threshold: Double = 5.0  // Minimum change percentage to report
    ) async throws -> DiffResult {
        let targetUDID = try await resolveSimulator(udid)

        // Load reference image
        guard FileManager.default.fileExists(atPath: referencePath) else {
            throw NocurError.notFound("Reference image not found: \(referencePath)")
        }

        guard let referenceData = FileManager.default.contents(atPath: referencePath) else {
            throw NocurError.parseError("Could not read reference image")
        }

        // Take current screenshot
        let currentScreenshot = try await takeScreenshot(
            udid: targetUDID,
            outputPath: nil,
            base64Output: true,
            useJpeg: true
        )

        // Simple pixel comparison: count changed pixels
        // We'll use a sampling approach for speed
        let changeResult = compareImages(
            referenceData: referenceData,
            referencePath: referencePath,
            currentBase64: currentScreenshot.base64 ?? ""
        )

        let changesDetected = changeResult.changePercentage > threshold

        // Generate summary
        let summary: String
        if !changesDetected {
            summary = "No significant changes detected (< \(Int(threshold))% change)"
        } else if changeResult.changePercentage > 50 {
            summary = "Major changes detected: \(Int(changeResult.changePercentage))% of screen changed"
        } else if changeResult.changePercentage > 20 {
            summary = "Moderate changes detected: \(Int(changeResult.changePercentage))% of screen changed"
        } else {
            summary = "Minor changes detected: \(Int(changeResult.changePercentage))% of screen changed"
        }

        return DiffResult(
            changesDetected: changesDetected,
            changePercentage: changeResult.changePercentage,
            changedRegions: changeResult.regions,
            summary: summary,
            currentScreenshot: currentScreenshot.base64
        )
    }

    /// Simple image comparison helper
    private func compareImages(
        referenceData: Data,
        referencePath: String,
        currentBase64: String
    ) -> (changePercentage: Double, regions: [ChangedRegion]) {
        // For a simple implementation, we'll use file size difference as a proxy
        // A more sophisticated implementation would do pixel-by-pixel comparison

        // Extract base64 data from current screenshot
        guard let base64Start = currentBase64.range(of: "base64,") else {
            return (0, [])
        }
        let base64Data = String(currentBase64[base64Start.upperBound...])
        guard let currentData = Data(base64Encoded: base64Data) else {
            return (0, [])
        }

        // Compare file sizes as a rough proxy for change
        let refSize = referenceData.count
        let curSize = currentData.count
        let sizeDiff = abs(refSize - curSize)
        let avgSize = (refSize + curSize) / 2

        // Size difference doesn't perfectly correlate with visual change,
        // but it's a reasonable heuristic for JPEG images
        var estimatedChange = Double(sizeDiff) / Double(avgSize) * 100

        // Normalize - JPEG compression means even identical images can vary ~5%
        estimatedChange = max(0, estimatedChange - 5)

        // For now, return a single "changed" region covering the whole screen
        // A proper implementation would do region detection
        var regions: [ChangedRegion] = []
        if estimatedChange > 5 {
            // Placeholder region - full screen change
            regions.append(ChangedRegion(x: 0, y: 0, width: 100, height: 100))
        }

        return (estimatedChange, regions)
    }

    // MARK: - Status

    public func getStatus() async throws -> SimulatorStatus {
        let list = try await listSimulators(bootedOnly: true)
        var runningApps: [RunningAppInfo] = []

        for sim in list.simulators {
            // Get running apps for each booted simulator
            if let apps = try? await getRunningApps(udid: sim.udid) {
                runningApps.append(contentsOf: apps)
            }
        }

        return SimulatorStatus(booted: list.simulators, runningApps: runningApps)
    }

    // MARK: - App Management

    public func installApp(appPath: String?, simulatorUDID: String?) async throws -> InstallResult {
        let udid = try await resolveSimulator(simulatorUDID)
        let list = try await listSimulators()
        let simName = list.simulators.first { $0.udid == udid }?.name ?? "Unknown"

        guard let path = appPath else {
            throw NocurError.invalidArgument("App path required")
        }

        _ = try await shell("xcrun", "simctl", "install", udid, path)

        // Extract bundle ID from app
        let bundleId = try getBundleId(appPath: path)

        return InstallResult(bundleId: bundleId, simulator: simName, appPath: path)
    }

    public func launchApp(
        bundleId: String?,
        simulatorUDID: String?,
        waitForDebugger: Bool = false,
        arguments: [String] = []
    ) async throws -> LaunchResult {
        let udid = try await resolveSimulator(simulatorUDID)
        let list = try await listSimulators()
        let simName = list.simulators.first { $0.udid == udid }?.name ?? "Unknown"

        guard let bundleId = bundleId else {
            throw NocurError.invalidArgument("Bundle ID required")
        }

        var args = ["xcrun", "simctl", "launch"]
        if waitForDebugger {
            args.append("-w")
        }
        args.append(udid)
        args.append(bundleId)
        args.append(contentsOf: arguments)

        let output = try await shell(args)

        // Parse PID from output (format: "com.example.app: 12345")
        let pid = output.components(separatedBy: ": ").last.flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? 0

        return LaunchResult(bundleId: bundleId, pid: pid, simulator: simName)
    }

    public func terminateApp(bundleId: String?, simulatorUDID: String?) async throws -> TerminateResult {
        let udid = try await resolveSimulator(simulatorUDID)

        guard let bundleId = bundleId else {
            throw NocurError.invalidArgument("Bundle ID required")
        }

        _ = try? await shell("xcrun", "simctl", "terminate", udid, bundleId)

        return TerminateResult(bundleId: bundleId, terminated: true)
    }

    public func uninstallApp(bundleId: String, simulatorUDID: String?) async throws -> EmptyResponse {
        let udid = try await resolveSimulator(simulatorUDID)
        _ = try await shell("xcrun", "simctl", "uninstall", udid, bundleId)
        return EmptyResponse("App uninstalled: \(bundleId)")
    }

    public func listInstalledApps(simulatorUDID: String?) async throws -> InstalledAppsResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Get app container paths
        let output = try await shell("xcrun", "simctl", "listapps", udid)

        // Parse the plist output
        // Note: This is a simplified implementation
        var apps: [InstalledAppInfo] = []

        // Parse the output (it's in plist format)
        if let data = output.data(using: .utf8),
           let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: [String: Any]] {
            for (bundleId, info) in plist {
                let name = info["CFBundleName"] as? String ?? bundleId
                let version = info["CFBundleShortVersionString"] as? String
                let path = info["Path"] as? String ?? ""

                apps.append(InstalledAppInfo(bundleId: bundleId, name: name, version: version, path: path))
            }
        }

        return InstalledAppsResult(apps: apps)
    }

    // MARK: - Helpers

    private func resolveSimulator(_ udid: String?) async throws -> String {
        if let udid = udid {
            return udid
        }

        // Get first booted simulator
        let list = try await listSimulators(bootedOnly: true)
        guard let sim = list.simulators.first else {
            throw NocurError.notFound("No booted simulator found")
        }
        return sim.udid
    }

    private func waitForState(udid: String, state: SimulatorState, timeout: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            let list = try await listSimulators()
            if let sim = list.simulators.first(where: { $0.udid == udid }), sim.state == state {
                return
            }
            try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }

        throw NocurError.timeout("Timeout waiting for simulator state: \(state)")
    }

    private func getRunningApps(udid: String) async throws -> [RunningAppInfo] {
        // This requires deeper integration - placeholder for now
        return []
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

    private func getImageDimensions(path: String) throws -> (Int, Int) {
        // Use sips to get dimensions
        let output = try shellSync("sips", "-g", "pixelWidth", "-g", "pixelHeight", path)

        var width = 0
        var height = 0

        for line in output.components(separatedBy: "\n") {
            if line.contains("pixelWidth") {
                width = Int(line.components(separatedBy: ": ").last ?? "") ?? 0
            } else if line.contains("pixelHeight") {
                height = Int(line.components(separatedBy: ": ").last ?? "") ?? 0
            }
        }

        return (width, height)
    }

    /// Compress image using sips command line tool (always available on macOS)
    /// Resizes to maxWidth and recompresses JPEG
    private func compressImageForContext(data: Data, maxWidth: Int, jpegQuality: Double) -> Data {
        // Write to temp file, use sips to resize, read back
        let tempInput = FileManager.default.temporaryDirectory
            .appendingPathComponent("compress_in_\(UUID().uuidString).jpg")
        let tempOutput = FileManager.default.temporaryDirectory
            .appendingPathComponent("compress_out_\(UUID().uuidString).jpg")

        defer {
            try? FileManager.default.removeItem(at: tempInput)
            try? FileManager.default.removeItem(at: tempOutput)
        }

        do {
            try data.write(to: tempInput)

            // Resize with sips (uses ImageIO, very efficient)
            _ = try shellSync("sips", "--resampleWidth", "\(maxWidth)", tempInput.path, "--out", tempOutput.path)

            // Read compressed result
            if let compressedData = FileManager.default.contents(atPath: tempOutput.path) {
                return compressedData
            }
        } catch {
            // On any error, return original
        }

        return data
    }

    /// Calculate new dimensions after resize
    private func getCompressedDimensions(originalWidth: Int, originalHeight: Int, maxWidth: Int) -> (Int, Int) {
        if originalWidth <= maxWidth {
            return (originalWidth, originalHeight)
        }
        let scale = Double(maxWidth) / Double(originalWidth)
        return (maxWidth, Int(Double(originalHeight) * scale))
    }
}

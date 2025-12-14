import Foundation

/// Manages app lifecycle on physical iOS devices using devicectl
public final class DeviceAppManager {
    
    public init() {}
    
    // MARK: - Install
    
    /// Install an app on a physical device
    /// - Parameters:
    ///   - appPath: Path to the .app bundle
    ///   - deviceId: CoreDevice UUID of the target device
    public func install(appPath: String, deviceId: String) async throws -> InstallResult {
        // Verify app exists
        guard FileManager.default.fileExists(atPath: appPath) else {
            throw NocurError.notFound("App not found: \(appPath)")
        }
        
        // Install using devicectl
        _ = try await shell(
            "xcrun", "devicectl", "device", "install", "app",
            "--device", deviceId,
            appPath
        )
        
        // Get bundle ID from app
        let bundleId = try getBundleId(appPath: appPath)
        
        return InstallResult(
            bundleId: bundleId,
            simulator: deviceId,  // Using deviceId as the "simulator" field for compatibility
            appPath: appPath
        )
    }
    
    // MARK: - Launch
    
    /// Launch an app on a physical device
    /// - Parameters:
    ///   - bundleId: Bundle identifier of the app
    ///   - deviceId: CoreDevice UUID of the target device
    /// - Returns: LaunchResult with PID (note: devicectl may not return PID)
    public func launch(bundleId: String, deviceId: String) async throws -> LaunchResult {
        let output = try await shell(
            "xcrun", "devicectl", "device", "process", "launch",
            "--device", deviceId,
            bundleId
        )
        
        // Try to parse PID from output (format varies)
        // devicectl output might include process ID
        let pid = parsePid(from: output) ?? 0
        
        return LaunchResult(
            bundleId: bundleId,
            pid: pid,
            simulator: deviceId
        )
    }
    
    // MARK: - Terminate
    
    /// Terminate an app on a physical device by PID
    /// - Parameters:
    ///   - pid: Process ID to terminate
    ///   - deviceId: CoreDevice UUID of the target device
    public func terminate(pid: Int, deviceId: String) async throws {
        _ = try await shell(
            "xcrun", "devicectl", "device", "process", "terminate",
            "--device", deviceId,
            "--pid", String(pid)
        )
    }
    
    /// Terminate an app by bundle ID (finds PID first)
    /// - Parameters:
    ///   - bundleId: Bundle identifier of the app
    ///   - deviceId: CoreDevice UUID of the target device
    public func terminateApp(bundleId: String, deviceId: String) async throws -> TerminateResult {
        // First, try to find the running process
        if let pid = try? await findProcessPid(bundleId: bundleId, deviceId: deviceId) {
            try await terminate(pid: pid, deviceId: deviceId)
            return TerminateResult(bundleId: bundleId, terminated: true)
        }
        
        // App might not be running
        return TerminateResult(bundleId: bundleId, terminated: false)
    }
    
    // MARK: - List Apps
    
    /// List installed apps on a physical device
    public func listApps(deviceId: String) async throws -> [InstalledAppInfo] {
        // Create temp file for JSON output
        let tempFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("devicectl_apps_\(UUID().uuidString).json")
        
        defer {
            try? FileManager.default.removeItem(at: tempFile)
        }
        
        _ = try await shell(
            "xcrun", "devicectl", "device", "info", "apps",
            "--device", deviceId,
            "--json-output", tempFile.path
        )
        
        guard let data = FileManager.default.contents(atPath: tempFile.path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = json["result"] as? [String: Any],
              let apps = result["apps"] as? [[String: Any]] else {
            return []
        }
        
        return apps.compactMap { app -> InstalledAppInfo? in
            guard let bundleId = app["bundleIdentifier"] as? String else { return nil }
            let name = app["name"] as? String ?? bundleId
            let version = app["bundleShortVersion"] as? String
            let path = app["path"] as? String ?? ""
            
            return InstalledAppInfo(
                bundleId: bundleId,
                name: name,
                version: version,
                path: path
            )
        }
    }
    
    // MARK: - List Processes
    
    /// List running processes on a physical device
    public func listProcesses(deviceId: String) async throws -> [RunningAppInfo] {
        // Create temp file for JSON output
        let tempFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("devicectl_procs_\(UUID().uuidString).json")
        
        defer {
            try? FileManager.default.removeItem(at: tempFile)
        }
        
        _ = try await shell(
            "xcrun", "devicectl", "device", "info", "processes",
            "--device", deviceId,
            "--json-output", tempFile.path
        )
        
        guard let data = FileManager.default.contents(atPath: tempFile.path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = json["result"] as? [String: Any],
              let processes = result["runningProcesses"] as? [[String: Any]] else {
            return []
        }
        
        return processes.compactMap { proc -> RunningAppInfo? in
            guard let pid = proc["processIdentifier"] as? Int,
                  let name = proc["executable"] as? String else { return nil }
            
            // Bundle ID might not be available for all processes
            let bundleId = (proc["bundleIdentifier"] as? String) ?? name
            
            return RunningAppInfo(
                bundleId: bundleId,
                name: name,
                pid: pid
            )
        }
    }
    
    // MARK: - Helpers
    
    private func getBundleId(appPath: String) throws -> String {
        let plistPath = "\(appPath)/Info.plist"
        guard let data = FileManager.default.contents(atPath: plistPath),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let bundleId = plist["CFBundleIdentifier"] as? String else {
            throw NocurError.parseError("Failed to read bundle ID from \(appPath)")
        }
        return bundleId
    }
    
    private func parsePid(from output: String) -> Int? {
        // Try to find PID in devicectl output
        // Common patterns: "pid: 1234" or "Process ID: 1234"
        let patterns = [
            #"pid[:\s]+(\d+)"#,
            #"Process ID[:\s]+(\d+)"#,
            #"processIdentifier[:\s]+(\d+)"#
        ]
        
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
               let match = regex.firstMatch(in: output, range: NSRange(output.startIndex..., in: output)),
               let range = Range(match.range(at: 1), in: output) {
                return Int(output[range])
            }
        }
        
        return nil
    }
    
    private func findProcessPid(bundleId: String, deviceId: String) async throws -> Int? {
        let processes = try await listProcesses(deviceId: deviceId)
        return processes.first { $0.bundleId == bundleId }?.pid
    }
}

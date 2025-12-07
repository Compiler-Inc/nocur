import Foundation

// MARK: - Crash Report Models

/// A crash report summary from idb
public struct CrashReport: Encodable {
    public let name: String
    public let bundleId: String?
    public let processName: String?
    public let timestamp: String?
    public let crashType: String?

    public init(
        name: String,
        bundleId: String? = nil,
        processName: String? = nil,
        timestamp: String? = nil,
        crashType: String? = nil
    ) {
        self.name = name
        self.bundleId = bundleId
        self.processName = processName
        self.timestamp = timestamp
        self.crashType = crashType
    }
}

/// Detailed crash report with stack trace
public struct CrashDetails: Encodable {
    public let name: String
    public let contents: String
    public let summary: String?

    public init(name: String, contents: String, summary: String? = nil) {
        self.name = name
        self.contents = contents
        self.summary = summary
    }
}

/// Result of listing crashes
public struct CrashListResult: Encodable {
    public let crashes: [CrashReport]
    public let count: Int
    public let filter: String?

    public init(crashes: [CrashReport], filter: String?) {
        self.crashes = crashes
        self.count = crashes.count
        self.filter = filter
    }
}

// MARK: - CrashReporter

/// Reports crash logs from the iOS simulator using idb
public final class CrashReporter {

    public init() {}

    /// Track connected simulators
    private static var connectedSimulators: Set<String> = []

    /// Ensure idb is connected
    private func ensureIdbConnected(_ udid: String) async throws {
        if CrashReporter.connectedSimulators.contains(udid) {
            return
        }
        _ = try? await shell("idb", "connect", udid)
        CrashReporter.connectedSimulators.insert(udid)
    }

    /// Resolve simulator UDID
    private func resolveSimulator(_ udid: String?) async throws -> String {
        let resolvedUdid: String

        if let udid = udid {
            resolvedUdid = udid
        } else {
            let output = try await shell("xcrun", "simctl", "list", "devices", "booted", "-j")

            guard let data = output.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let devices = json["devices"] as? [String: [[String: Any]]] else {
                throw NocurError.notFound("No booted simulator found")
            }

            var foundUdid: String?
            for (_, deviceList) in devices {
                if let device = deviceList.first, let udid = device["udid"] as? String {
                    foundUdid = udid
                    break
                }
            }

            guard let udid = foundUdid else {
                throw NocurError.notFound("No booted simulator found")
            }
            resolvedUdid = udid
        }

        try await ensureIdbConnected(resolvedUdid)
        return resolvedUdid
    }

    /// List crash reports
    /// - Parameters:
    ///   - bundleId: Filter by bundle ID (optional)
    ///   - simulatorUDID: Simulator UDID (uses booted if nil)
    ///   - limit: Maximum number of crashes to return
    public func listCrashes(
        bundleId: String?,
        simulatorUDID: String?,
        limit: Int = 10
    ) async throws -> CrashListResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Get crash list from idb
        let output = try await shell("idb", "crash", "list", "--udid", udid)

        // Parse the crash list
        var crashes = parseCrashList(output)

        // Filter by bundle ID if provided
        if let bundleId = bundleId {
            crashes = crashes.filter { crash in
                crash.bundleId?.contains(bundleId) == true ||
                crash.name.contains(bundleId)
            }
        }

        // Limit results
        let limitedCrashes = Array(crashes.prefix(limit))

        return CrashListResult(crashes: limitedCrashes, filter: bundleId)
    }

    /// Get detailed crash report
    /// - Parameters:
    ///   - name: Crash report name
    ///   - simulatorUDID: Simulator UDID (uses booted if nil)
    public func getCrashDetails(
        name: String,
        simulatorUDID: String?
    ) async throws -> CrashDetails {
        let udid = try await resolveSimulator(simulatorUDID)

        // Get crash details from idb
        let output = try await shell("idb", "crash", "show", name, "--udid", udid)

        // Extract summary from crash report
        let summary = extractCrashSummary(output)

        return CrashDetails(name: name, contents: output, summary: summary)
    }

    /// Parse crash list output from idb
    private func parseCrashList(_ output: String) -> [CrashReport] {
        var crashes: [CrashReport] = []

        // idb crash list outputs one crash per line
        // Format varies but typically: name | process | bundle_id | timestamp
        for line in output.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }

            // Try to parse the line
            // Format: "crash_name.ips | ProcessName | com.bundle.id | 2024-01-15 10:30:45"
            let parts = trimmed.components(separatedBy: " | ")

            if parts.count >= 1 {
                let name = parts[0].trimmingCharacters(in: .whitespaces)
                let processName = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespaces) : nil
                let bundleId = parts.count > 2 ? parts[2].trimmingCharacters(in: .whitespaces) : nil
                let timestamp = parts.count > 3 ? parts[3].trimmingCharacters(in: .whitespaces) : nil

                crashes.append(CrashReport(
                    name: name,
                    bundleId: bundleId,
                    processName: processName,
                    timestamp: timestamp
                ))
            }
        }

        return crashes
    }

    /// Extract a summary from the crash report contents
    private func extractCrashSummary(_ contents: String) -> String? {
        var summary: [String] = []

        // Look for key lines in the crash report
        let lines = contents.components(separatedBy: "\n")

        for line in lines {
            // Capture exception type
            if line.contains("Exception Type:") {
                summary.append(line.trimmingCharacters(in: .whitespaces))
            }
            // Capture exception codes
            if line.contains("Exception Codes:") {
                summary.append(line.trimmingCharacters(in: .whitespaces))
            }
            // Capture termination reason
            if line.contains("Termination Reason:") {
                summary.append(line.trimmingCharacters(in: .whitespaces))
            }
            // Capture the crashing thread header
            if line.contains("Crashed Thread:") || line.contains("Application Specific Information:") {
                summary.append(line.trimmingCharacters(in: .whitespaces))
            }
        }

        // Also try to get the first few lines of the crashed thread backtrace
        if let crashedThreadIndex = lines.firstIndex(where: { $0.contains("Thread") && $0.contains("Crashed") }) {
            // Get up to 5 frames from the crashed thread
            let endIndex = min(crashedThreadIndex + 6, lines.count)
            for i in (crashedThreadIndex + 1)..<endIndex {
                let frame = lines[i].trimmingCharacters(in: .whitespaces)
                if !frame.isEmpty && frame.first?.isNumber == true {
                    summary.append(frame)
                }
            }
        }

        return summary.isEmpty ? nil : summary.joined(separator: "\n")
    }
}

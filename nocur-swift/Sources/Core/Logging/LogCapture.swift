import Foundation

// MARK: - Log Entry Model

/// A single log entry from the simulator
public struct LogEntry: Encodable {
    public let timestamp: String
    public let level: String
    public let process: String
    public let message: String
    public let subsystem: String?
    public let category: String?

    public init(
        timestamp: String,
        level: String,
        process: String,
        message: String,
        subsystem: String? = nil,
        category: String? = nil
    ) {
        self.timestamp = timestamp
        self.level = level
        self.process = process
        self.message = message
        self.subsystem = subsystem
        self.category = category
    }
}

/// Result of log capture
public struct LogCaptureResult: Encodable {
    public let logs: [LogEntry]
    public let count: Int
    public let duration: Double
    public let filter: String?

    public init(logs: [LogEntry], duration: Double, filter: String?) {
        self.logs = logs
        self.count = logs.count
        self.duration = duration
        self.filter = filter
    }
}

// MARK: - idb Log Entry (for JSON parsing)

private struct IdbLogEntry: Decodable {
    let timestamp: String?
    let messageType: String?
    let eventMessage: String?
    let processImagePath: String?
    let subsystem: String?
    let category: String?
}

// MARK: - LogCapture

/// Captures logs from the iOS simulator using idb
public final class LogCapture {

    public init() {}

    /// Track connected simulators
    private static var connectedSimulators: Set<String> = []

    /// Ensure idb is connected
    private func ensureIdbConnected(_ udid: String) async throws {
        if LogCapture.connectedSimulators.contains(udid) {
            return
        }
        _ = try? await shell("idb", "connect", udid)
        LogCapture.connectedSimulators.insert(udid)
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

    /// Capture logs for a specified duration
    /// - Parameters:
    ///   - bundleId: Filter by bundle ID (optional)
    ///   - processName: Filter by process name (optional)
    ///   - simulatorUDID: Simulator UDID (uses booted if nil)
    ///   - duration: Capture duration in seconds (max 30)
    ///   - level: Log level filter (default, info, debug)
    public func captureLogs(
        bundleId: String?,
        processName: String?,
        simulatorUDID: String?,
        duration: Double = 5.0,
        level: String = "default"
    ) async throws -> LogCaptureResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Build predicate for filtering
        var predicate: String? = nil
        if let bundleId = bundleId {
            predicate = "processImagePath contains '\(bundleId)'"
        } else if let processName = processName {
            predicate = "processImagePath contains '\(processName)'"
        }

        // Cap duration at 30 seconds to avoid huge outputs
        let cappedDuration = min(duration, 30.0)

        // Build idb log command
        var args = ["idb", "log", "--udid", udid, "--json", "--"]
        args.append(contentsOf: ["--style", "json"])
        args.append(contentsOf: ["--timeout", "\(Int(cappedDuration))s"])
        args.append(contentsOf: ["--level", level])

        if let predicate = predicate {
            args.append(contentsOf: ["--predicate", predicate])
        }

        // Run and capture output
        let output = try await shell(args)

        // Parse log entries
        let logs = parseLogOutput(output)

        // Limit to most recent 100 entries to avoid huge context
        let limitedLogs = Array(logs.suffix(100))

        return LogCaptureResult(
            logs: limitedLogs,
            duration: cappedDuration,
            filter: predicate
        )
    }

    /// Parse the JSON log output from idb
    private func parseLogOutput(_ output: String) -> [LogEntry] {
        var entries: [LogEntry] = []

        // idb outputs one JSON object per line (after initial message)
        for line in output.components(separatedBy: "\n") {
            // Skip non-JSON lines
            guard line.hasPrefix("{") || line.hasPrefix("[") else {
                continue
            }

            guard let data = line.data(using: .utf8) else {
                continue
            }

            // Try parsing as single entry
            if let entry = try? JSONDecoder().decode(IdbLogEntry.self, from: data) {
                if let message = entry.eventMessage, !message.isEmpty {
                    let process = entry.processImagePath?
                        .components(separatedBy: "/").last ?? "unknown"

                    entries.append(LogEntry(
                        timestamp: entry.timestamp ?? "",
                        level: entry.messageType ?? "default",
                        process: process,
                        message: message,
                        subsystem: entry.subsystem,
                        category: entry.category
                    ))
                }
            }
        }

        return entries
    }
}

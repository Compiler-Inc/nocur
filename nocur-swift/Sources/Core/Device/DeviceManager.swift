import Foundation

// MARK: - Unified Device Types

/// Represents any iOS device - simulator or physical
public struct DeviceInfo: Codable, Equatable {
    public let id: String              // UDID for simulators, CoreDevice UUID for physical
    public let name: String            // "iPhone 16 Pro" or "Atharva's iPhone"
    public let model: String           // "iPhone 16 Pro", "iPad Air"
    public let osVersion: String       // "18.0", "26.1"
    public let deviceType: DeviceType
    public let state: DeviceState
    public let isAvailable: Bool
    
    public init(
        id: String,
        name: String,
        model: String,
        osVersion: String,
        deviceType: DeviceType,
        state: DeviceState,
        isAvailable: Bool
    ) {
        self.id = id
        self.name = name
        self.model = model
        self.osVersion = osVersion
        self.deviceType = deviceType
        self.state = state
        self.isAvailable = isAvailable
    }
}

public enum DeviceType: String, Codable {
    case simulator
    case physical
}

public enum DeviceState: String, Codable {
    case booted       // Simulator is running
    case shutdown     // Simulator is off
    case connected    // Physical device connected & paired
    case disconnected // Physical device not connected
    case unavailable  // Device exists but can't be used
}

/// Result of listing devices
public struct DeviceListResult: Codable {
    public let devices: [DeviceInfo]
    public let simulatorCount: Int
    public let physicalCount: Int
    
    public init(devices: [DeviceInfo]) {
        self.devices = devices
        self.simulatorCount = devices.filter { $0.deviceType == .simulator }.count
        self.physicalCount = devices.filter { $0.deviceType == .physical }.count
    }
}

// MARK: - Device Manager

/// Unified device manager for both simulators and physical devices
public final class DeviceManager {
    
    public init() {}
    
    // MARK: - List All Devices
    
    /// List all available devices (simulators + physical)
    public func listAllDevices(availableOnly: Bool = false) async throws -> DeviceListResult {
        async let simulators = listSimulators(bootedOnly: false)
        async let physical = listPhysicalDevices(connectedOnly: false)
        
        var allDevices: [DeviceInfo] = []
        
        // Collect simulators
        if let sims = try? await simulators {
            allDevices.append(contentsOf: sims)
        }
        
        // Collect physical devices
        if let phys = try? await physical {
            allDevices.append(contentsOf: phys)
        }
        
        // Filter if requested
        if availableOnly {
            allDevices = allDevices.filter { $0.isAvailable }
        }
        
        // Sort: booted/connected first, then by name
        allDevices.sort { lhs, rhs in
            let lhsActive = lhs.state == .booted || lhs.state == .connected
            let rhsActive = rhs.state == .booted || rhs.state == .connected
            if lhsActive != rhsActive {
                return lhsActive
            }
            return lhs.name < rhs.name
        }
        
        return DeviceListResult(devices: allDevices)
    }
    
    // MARK: - List Simulators
    
    /// List iOS simulators via simctl
    public func listSimulators(bootedOnly: Bool = false) async throws -> [DeviceInfo] {
        let output = try await shell("xcrun", "simctl", "list", "devices", "-j")
        
        guard let data = output.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = json["devices"] as? [String: [[String: Any]]] else {
            throw NocurError.parseError("Failed to parse simctl output")
        }
        
        var simulators: [DeviceInfo] = []
        
        for (runtime, deviceList) in devices {
            // Only include iOS simulators (not watchOS, tvOS, etc.)
            guard runtime.contains("iOS") || runtime.contains("iPhoneOS") else {
                continue
            }
            
            // Extract iOS version from runtime string
            // Format: "com.apple.CoreSimulator.SimRuntime.iOS-18-0" -> "18.0"
            let osVersion = extractOSVersion(from: runtime)
            
            for device in deviceList {
                guard let udid = device["udid"] as? String,
                      let name = device["name"] as? String,
                      let stateString = device["state"] as? String,
                      let isAvailable = device["isAvailable"] as? Bool else {
                    continue
                }
                
                // Skip unavailable devices
                guard isAvailable else { continue }
                
                let state: DeviceState
                switch stateString {
                case "Booted": state = .booted
                case "Shutdown": state = .shutdown
                default: state = .unavailable
                }
                
                // Apply booted filter
                if bootedOnly && state != .booted {
                    continue
                }
                
                let info = DeviceInfo(
                    id: udid,
                    name: name,
                    model: name,  // For simulators, name IS the model
                    osVersion: osVersion,
                    deviceType: .simulator,
                    state: state,
                    isAvailable: isAvailable
                )
                simulators.append(info)
            }
        }
        
        return simulators
    }
    
    // MARK: - List Physical Devices
    
    /// List physical iOS devices via devicectl
    public func listPhysicalDevices(connectedOnly: Bool = false) async throws -> [DeviceInfo] {
        // Create temp file for JSON output (devicectl requires file path)
        let tempFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("devicectl_\(UUID().uuidString).json")
        
        defer {
            try? FileManager.default.removeItem(at: tempFile)
        }
        
        do {
            _ = try await shell("xcrun", "devicectl", "list", "devices", "--json-output", tempFile.path)
        } catch {
            // devicectl might not be available or no devices
            return []
        }
        
        guard let data = FileManager.default.contents(atPath: tempFile.path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = json["result"] as? [String: Any],
              let deviceList = result["devices"] as? [[String: Any]] else {
            return []
        }
        
        var devices: [DeviceInfo] = []
        
        for device in deviceList {
            guard let identifier = device["identifier"] as? String,
                  let deviceProps = device["deviceProperties"] as? [String: Any],
                  let hardwareProps = device["hardwareProperties"] as? [String: Any],
                  let connectionProps = device["connectionProperties"] as? [String: Any] else {
                continue
            }
            
            // Only include iOS devices (not watchOS, macOS)
            let platform = hardwareProps["platform"] as? String ?? ""
            guard platform == "iOS" || platform == "iPhoneOS" else {
                continue
            }
            
            let name = deviceProps["name"] as? String ?? "Unknown Device"
            let marketingName = hardwareProps["marketingName"] as? String ?? "Unknown"
            let osVersion = deviceProps["osVersionNumber"] as? String ?? "Unknown"
            
            // Determine state from connection properties
            let pairingState = connectionProps["pairingState"] as? String ?? ""
            let tunnelState = connectionProps["tunnelState"] as? String ?? ""
            
            let state: DeviceState
            let isAvailable: Bool
            
            if pairingState == "paired" && tunnelState != "unavailable" {
                state = .connected
                isAvailable = true
            } else if pairingState == "paired" {
                state = .disconnected
                isAvailable = false
            } else {
                state = .unavailable
                isAvailable = false
            }
            
            // Apply connected filter
            if connectedOnly && state != .connected {
                continue
            }
            
            let info = DeviceInfo(
                id: identifier,
                name: name,
                model: marketingName,
                osVersion: osVersion,
                deviceType: .physical,
                state: state,
                isAvailable: isAvailable
            )
            devices.append(info)
        }
        
        return devices
    }
    
    // MARK: - Boot/Connect
    
    /// Boot a simulator by ID
    public func bootSimulator(id: String, wait: Bool = true) async throws {
        _ = try await shell("xcrun", "simctl", "boot", id)
        
        if wait {
            // Wait for boot to complete (max 60s)
            try await waitForSimulatorState(id: id, state: .booted, timeout: 60)
        }
    }
    
    /// Get a device by ID
    public func getDevice(id: String) async throws -> DeviceInfo? {
        let result = try await listAllDevices()
        return result.devices.first { $0.id == id }
    }
    
    /// Get the first booted simulator or connected physical device
    public func getActiveDevice() async throws -> DeviceInfo? {
        let result = try await listAllDevices()
        return result.devices.first { $0.state == .booted || $0.state == .connected }
    }
    
    // MARK: - Helpers
    
    private func extractOSVersion(from runtime: String) -> String {
        // Format: "com.apple.CoreSimulator.SimRuntime.iOS-18-0" -> "18.0"
        let cleaned = runtime
            .replacingOccurrences(of: "com.apple.CoreSimulator.SimRuntime.", with: "")
            .replacingOccurrences(of: "iOS-", with: "")
            .replacingOccurrences(of: "-", with: ".")
        return cleaned
    }
    
    private func waitForSimulatorState(id: String, state: DeviceState, timeout: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        
        while Date() < deadline {
            let simulators = try await listSimulators()
            if let sim = simulators.first(where: { $0.id == id }), sim.state == state {
                return
            }
            try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds
        }
        
        throw NocurError.timeout("Timeout waiting for simulator state: \(state)")
    }
}

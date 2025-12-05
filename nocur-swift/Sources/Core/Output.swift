import Foundation

// MARK: - Output Wrapper

/// Standard output wrapper for all CLI responses.
/// All commands return JSON in this format for consistent parsing.
public struct Output<T: Encodable>: Encodable {
    public let success: Bool
    public let data: T?
    public let error: String?
    public let timestamp: String

    private init(success: Bool, data: T?, error: String?) {
        self.success = success
        self.data = data
        self.error = error
        self.timestamp = ISO8601DateFormatter().string(from: Date())
    }

    public static func success(_ data: T) -> Output<T> {
        Output(success: true, data: data, error: nil)
    }

    public static func failure(_ error: String) -> Output<T> {
        Output(success: false, data: nil, error: error)
    }

    public var json: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        guard let data = try? encoder.encode(self),
              let string = String(data: data, encoding: .utf8) else {
            return "{\"success\": false, \"error\": \"Failed to encode output\"}"
        }
        return string
    }
}

// MARK: - Empty Response

/// For commands that don't return data
public struct EmptyResponse: Encodable {
    public let message: String

    public init(_ message: String = "OK") {
        self.message = message
    }
}

// MARK: - Simulator Models

public struct SimulatorInfo: Encodable {
    public let udid: String
    public let name: String
    public let runtime: String
    public let state: SimulatorState
    public let deviceType: String
    public let isAvailable: Bool

    public init(udid: String, name: String, runtime: String, state: SimulatorState, deviceType: String, isAvailable: Bool) {
        self.udid = udid
        self.name = name
        self.runtime = runtime
        self.state = state
        self.deviceType = deviceType
        self.isAvailable = isAvailable
    }
}

public enum SimulatorState: String, Encodable {
    case shutdown = "Shutdown"
    case booted = "Booted"
    case booting = "Booting"
    case shuttingDown = "Shutting Down"
    case unknown = "Unknown"
}

public struct SimulatorListResult: Encodable {
    public let simulators: [SimulatorInfo]
    public let count: Int

    public init(simulators: [SimulatorInfo]) {
        self.simulators = simulators
        self.count = simulators.count
    }
}

public struct BootResult: Encodable {
    public let udid: String
    public let name: String
    public let state: SimulatorState
    public let bootTime: Double?

    public init(udid: String, name: String, state: SimulatorState, bootTime: Double? = nil) {
        self.udid = udid
        self.name = name
        self.state = state
        self.bootTime = bootTime
    }
}

public struct ScreenshotResult: Encodable {
    public let path: String?
    public let base64: String?
    public let width: Int
    public let height: Int
    public let simulator: String
    public let format: String

    public init(path: String, width: Int, height: Int, simulator: String, format: String = "png") {
        self.path = path
        self.base64 = nil
        self.width = width
        self.height = height
        self.simulator = simulator
        self.format = format
    }

    public init(base64: String, width: Int, height: Int, simulator: String, format: String = "jpeg") {
        self.path = nil
        self.base64 = base64
        self.width = width
        self.height = height
        self.simulator = simulator
        self.format = format
    }
}

// MARK: - Observation Models (for video workaround)

/// A single frame captured during observation
public struct ObserveFrame: Encodable {
    public let timestamp: Double
    public let image: String  // base64 JPEG

    public init(timestamp: Double, image: String) {
        self.timestamp = timestamp
        self.image = image
    }
}

/// Result of observing the simulator over time
public struct ObserveResult: Encodable {
    public let frames: [ObserveFrame]
    public let duration: Double
    public let frameCount: Int
    public let simulator: String

    public init(frames: [ObserveFrame], duration: Double, simulator: String) {
        self.frames = frames
        self.duration = duration
        self.frameCount = frames.count
        self.simulator = simulator
    }
}

/// A region that changed between screenshots
public struct ChangedRegion: Encodable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

/// Result of comparing two screenshots
public struct DiffResult: Encodable {
    public let changesDetected: Bool
    public let changePercentage: Double
    public let changedRegions: [ChangedRegion]
    public let summary: String
    public let currentScreenshot: String?  // base64 of current state

    public init(
        changesDetected: Bool,
        changePercentage: Double,
        changedRegions: [ChangedRegion],
        summary: String,
        currentScreenshot: String? = nil
    ) {
        self.changesDetected = changesDetected
        self.changePercentage = changePercentage
        self.changedRegions = changedRegions
        self.summary = summary
        self.currentScreenshot = currentScreenshot
    }
}

/// Result for compound interact command - returns screenshot after action
public struct InteractResult: Encodable {
    public let action: String
    public let success: Bool
    public let screenshot: ScreenshotResult?
    public let element: String?

    public init(action: String, success: Bool, screenshot: ScreenshotResult? = nil, element: String? = nil) {
        self.action = action
        self.success = success
        self.screenshot = screenshot
        self.element = element
    }
}

public struct SimulatorStatus: Encodable {
    public let booted: [SimulatorInfo]
    public let runningApps: [RunningAppInfo]

    public init(booted: [SimulatorInfo], runningApps: [RunningAppInfo]) {
        self.booted = booted
        self.runningApps = runningApps
    }
}

// MARK: - App Models

public struct RunningAppInfo: Encodable {
    public let bundleId: String
    public let name: String
    public let pid: Int

    public init(bundleId: String, name: String, pid: Int) {
        self.bundleId = bundleId
        self.name = name
        self.pid = pid
    }
}

public struct InstalledAppInfo: Encodable {
    public let bundleId: String
    public let name: String
    public let version: String?
    public let path: String

    public init(bundleId: String, name: String, version: String?, path: String) {
        self.bundleId = bundleId
        self.name = name
        self.version = version
        self.path = path
    }
}

public struct InstalledAppsResult: Encodable {
    public let apps: [InstalledAppInfo]
    public let count: Int

    public init(apps: [InstalledAppInfo]) {
        self.apps = apps
        self.count = apps.count
    }
}

public struct BuildResult: Encodable {
    public let appPath: String
    public let bundleId: String
    public let buildTime: Double
    public let warnings: Int
    public let errors: Int

    public init(appPath: String, bundleId: String, buildTime: Double, warnings: Int, errors: Int) {
        self.appPath = appPath
        self.bundleId = bundleId
        self.buildTime = buildTime
        self.warnings = warnings
        self.errors = errors
    }
}

/// Structured build error with file location for agent consumption
public struct BuildError: Encodable {
    public let file: String?
    public let line: Int?
    public let column: Int?
    public let message: String
    public let severity: String

    public init(file: String?, line: Int?, column: Int?, message: String, severity: String = "error") {
        self.file = file
        self.line = line
        self.column = column
        self.message = message
        self.severity = severity
    }
}

/// Result returned when build fails - contains structured errors for agent to fix
public struct BuildFailureResult: Encodable {
    public let buildFailed: Bool
    public let errorCount: Int
    public let warningCount: Int
    public let errors: [BuildError]
    public let summary: String

    public init(errors: [BuildError], warnings: Int = 0) {
        self.buildFailed = true
        self.errorCount = errors.count
        self.warningCount = warnings
        self.errors = errors

        // Create a summary for quick reading
        if errors.isEmpty {
            self.summary = "Build failed with unknown errors"
        } else {
            let uniqueFiles = Set(errors.compactMap { $0.file }).count
            self.summary = "\(errors.count) error(s) in \(uniqueFiles) file(s)"
        }
    }
}

public struct InstallResult: Encodable {
    public let bundleId: String
    public let simulator: String
    public let appPath: String

    public init(bundleId: String, simulator: String, appPath: String) {
        self.bundleId = bundleId
        self.simulator = simulator
        self.appPath = appPath
    }
}

public struct LaunchResult: Encodable {
    public let bundleId: String
    public let pid: Int
    public let simulator: String

    public init(bundleId: String, pid: Int, simulator: String) {
        self.bundleId = bundleId
        self.pid = pid
        self.simulator = simulator
    }
}

public struct TerminateResult: Encodable {
    public let bundleId: String
    public let terminated: Bool

    public init(bundleId: String, terminated: Bool) {
        self.bundleId = bundleId
        self.terminated = terminated
    }
}

// MARK: - UI Models

public struct ViewNode: Encodable {
    public let className: String
    public let frame: Frame?
    public let accessibilityIdentifier: String?
    public let accessibilityLabel: String?
    public let accessibilityValue: String?
    public let accessibilityTraits: [String]?
    public let isEnabled: Bool
    public let isHidden: Bool
    public let children: [ViewNode]?

    public init(
        className: String,
        frame: Frame? = nil,
        accessibilityIdentifier: String? = nil,
        accessibilityLabel: String? = nil,
        accessibilityValue: String? = nil,
        accessibilityTraits: [String]? = nil,
        isEnabled: Bool = true,
        isHidden: Bool = false,
        children: [ViewNode]? = nil
    ) {
        self.className = className
        self.frame = frame
        self.accessibilityIdentifier = accessibilityIdentifier
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.accessibilityTraits = accessibilityTraits
        self.isEnabled = isEnabled
        self.isHidden = isHidden
        self.children = children
    }
}

public struct Frame: Encodable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct HierarchyResult: Encodable {
    public let captureMethod: String
    public let bundleId: String?
    public let root: ViewNode

    public init(captureMethod: String, bundleId: String?, root: ViewNode) {
        self.captureMethod = captureMethod
        self.bundleId = bundleId
        self.root = root
    }
}

public struct AccessibilityElement: Encodable {
    public let identifier: String?
    public let label: String?
    public let value: String?
    public let type: String
    public let frame: Frame
    public let isEnabled: Bool
    public let traits: [String]

    public init(
        identifier: String?,
        label: String?,
        value: String?,
        type: String,
        frame: Frame,
        isEnabled: Bool,
        traits: [String]
    ) {
        self.identifier = identifier
        self.label = label
        self.value = value
        self.type = type
        self.frame = frame
        self.isEnabled = isEnabled
        self.traits = traits
    }
}

public struct AccessibilityTreeResult: Encodable {
    public let elements: [AccessibilityElement]
    public let count: Int

    public init(elements: [AccessibilityElement]) {
        self.elements = elements
        self.count = elements.count
    }
}

public struct TapResult: Encodable {
    public let action: String
    public let coordinates: Frame
    public let element: String?

    public init(x: Double, y: Double, element: String? = nil) {
        self.action = "tap"
        self.coordinates = Frame(x: x, y: y, width: 0, height: 0)
        self.element = element
    }
}

public struct ScrollResult: Encodable {
    public let action: String
    public let direction: String
    public let amount: Double

    public init(direction: String, amount: Double) {
        self.action = "scroll"
        self.direction = direction
        self.amount = amount
    }
}

public struct TypeResult: Encodable {
    public let action: String
    public let text: String
    public let element: String?
    public let cleared: Bool

    public init(text: String, element: String?, cleared: Bool) {
        self.action = "type"
        self.text = text
        self.element = element
        self.cleared = cleared
    }
}

public struct FindResult: Encodable {
    public let matches: [AccessibilityElement]
    public let count: Int

    public init(matches: [AccessibilityElement]) {
        self.matches = matches
        self.count = matches.count
    }
}

// MARK: - Project Models

public struct ProjectInfo: Encodable {
    public let type: String  // "project" or "workspace"
    public let path: String
    public let name: String
    public let bundleId: String?
    public let version: String?
    public let buildNumber: String?
    public let deploymentTarget: String?
    public let swiftVersion: String?
    public let schemes: [String]
    public let targets: [TargetInfo]

    public init(
        type: String,
        path: String,
        name: String,
        bundleId: String? = nil,
        version: String? = nil,
        buildNumber: String? = nil,
        deploymentTarget: String? = nil,
        swiftVersion: String? = nil,
        schemes: [String] = [],
        targets: [TargetInfo] = []
    ) {
        self.type = type
        self.path = path
        self.name = name
        self.bundleId = bundleId
        self.version = version
        self.buildNumber = buildNumber
        self.deploymentTarget = deploymentTarget
        self.swiftVersion = swiftVersion
        self.schemes = schemes
        self.targets = targets
    }
}

public struct TargetInfo: Encodable {
    public let name: String
    public let type: String
    public let bundleId: String?

    public init(name: String, type: String, bundleId: String? = nil) {
        self.name = name
        self.type = type
        self.bundleId = bundleId
    }
}

public struct SchemeInfo: Encodable {
    public let name: String
    public let shared: Bool
    public let buildable: Bool

    public init(name: String, shared: Bool, buildable: Bool) {
        self.name = name
        self.shared = shared
        self.buildable = buildable
    }
}

public struct SchemesResult: Encodable {
    public let schemes: [SchemeInfo]

    public init(schemes: [SchemeInfo]) {
        self.schemes = schemes
    }
}

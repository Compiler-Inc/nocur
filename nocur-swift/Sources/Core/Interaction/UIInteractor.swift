import Foundation

/// Direction for scroll gestures
public enum ScrollDirection: String, Codable, CaseIterable, Sendable {
    case up, down, left, right
}

/// Interacts with UI elements in the simulator using Facebook's idb
public final class UIInteractor {

    public init() {}

    // MARK: - Tap

    public func tap(
        x: Double,
        y: Double,
        simulatorUDID: String?,
        tapCount: Int
    ) async throws -> TapResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // idb uses logical points (not device pixels)
        // All coordinates from ui_hierarchy are already in logical points
        // No scaling needed - pass through directly
        let tapX = Int(x)
        let tapY = Int(y)

        // Use idb for reliable touch input
        for _ in 0..<tapCount {
            _ = try await shell("idb", "ui", "tap", "--udid", udid, String(tapX), String(tapY))
        }

        return TapResult(x: x, y: y, element: nil)
    }

    public func tapElement(
        identifier: String,
        simulatorUDID: String?,
        tapCount: Int
    ) async throws -> TapResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Find element by identifier
        let inspector = ViewInspector()
        let result = try await inspector.findElements(
            text: nil,
            type: nil,
            identifier: identifier,
            simulatorUDID: udid
        )

        guard let element = result.matches.first else {
            // Get available elements to help agent
            let available = try await getAvailableElements(inspector: inspector, udid: udid)
            throw NocurError.notFound(
                "Element not found with identifier: '\(identifier)'. " +
                "Available identifiers: \(available.identifiers.prefix(10).joined(separator: ", "))" +
                (available.identifiers.count > 10 ? " (and \(available.identifiers.count - 10) more)" : "")
            )
        }

        // Calculate center point - idb returns logical coordinates
        let x = element.frame.x + element.frame.width / 2
        let y = element.frame.y + element.frame.height / 2

        return try await tap(x: x, y: y, simulatorUDID: udid, tapCount: tapCount)
    }

    public func tapElementByLabel(
        label: String,
        simulatorUDID: String?,
        tapCount: Int
    ) async throws -> TapResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Find element by label
        let inspector = ViewInspector()
        let result = try await inspector.findElements(
            text: label,
            type: nil,
            identifier: nil,
            simulatorUDID: udid
        )

        guard let element = result.matches.first else {
            // Get available elements to help agent
            let available = try await getAvailableElements(inspector: inspector, udid: udid)
            throw NocurError.notFound(
                "Element not found with label: '\(label)'. " +
                "Available labels: \(available.labels.prefix(10).joined(separator: ", "))" +
                (available.labels.count > 10 ? " (and \(available.labels.count - 10) more)" : "")
            )
        }

        // Calculate center point - idb returns logical coordinates
        let x = element.frame.x + element.frame.width / 2
        let y = element.frame.y + element.frame.height / 2

        return try await tap(x: x, y: y, simulatorUDID: udid, tapCount: tapCount)
    }

    // MARK: - Scroll

    public func scroll(
        direction: ScrollDirection,
        amount: Double,
        elementIdentifier: String?,
        simulatorUDID: String?
    ) async throws -> ScrollResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Calculate swipe coordinates using idb (logical points)
        // iPhone 16 Pro logical size: ~393x852
        let centerX = 196.0  // Center X in logical points
        let centerY = 426.0  // Center Y in logical points

        var endX = centerX
        var endY = centerY

        switch direction {
        case .up:
            endY = centerY - amount
        case .down:
            endY = centerY + amount
        case .left:
            endX = centerX - amount
        case .right:
            endX = centerX + amount
        }

        // Use idb swipe (expects logical points)
        _ = try await shell(
            "idb", "ui", "swipe",
            "--udid", udid,
            String(Int(centerX)), String(Int(centerY)),
            String(Int(endX)), String(Int(endY))
        )

        return ScrollResult(direction: direction.rawValue, amount: amount)
    }

    // MARK: - Type

    public func typeText(
        _ text: String,
        elementIdentifier: String?,
        simulatorUDID: String?,
        clearFirst: Bool
    ) async throws -> TypeResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // If element specified, tap it first to focus
        if let identifier = elementIdentifier {
            _ = try await tapElement(
                identifier: identifier,
                simulatorUDID: udid,
                tapCount: 1
            )
            try await Task.sleep(nanoseconds: 200_000_000) // 200ms to let keyboard appear
        }

        // Clear existing text if requested
        if clearFirst {
            // idb `ui key` does not support modifier keys, so we clear by sending a
            // sequence of backspaces to the currently focused element.
            let backspaceCount = 64
            let args = ["idb", "ui", "key-sequence", "--udid", udid] + Array(repeating: "42", count: backspaceCount)
            _ = try await shell(args)
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        // Type text using idb - requires idb to be connected
        _ = try await shell("idb", "ui", "text", "--udid", udid, text)

        return TypeResult(text: text, element: elementIdentifier, cleared: clearFirst)
    }

    // MARK: - Compound Interact (tap/type + screenshot in one call)

    /// Perform an action and immediately take a screenshot - reduces round-trips
    public func interact(
        action: InteractAction,
        simulatorUDID: String?
    ) async throws -> InteractResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Perform the action
        switch action {
        case .tap(let x, let y):
            _ = try await tap(x: x, y: y, simulatorUDID: udid, tapCount: 1)

        case .tapElement(let id):
            _ = try await tapElement(identifier: id, simulatorUDID: udid, tapCount: 1)

        case .tapLabel(let label):
            _ = try await tapElementByLabel(label: label, simulatorUDID: udid, tapCount: 1)

        case .type(let text, let elementId, let clear):
            _ = try await typeText(text, elementIdentifier: elementId, simulatorUDID: udid, clearFirst: clear)

        case .scroll(let direction, let amount):
            _ = try await scroll(direction: direction, amount: amount, elementIdentifier: nil, simulatorUDID: udid)
        }

        // Brief delay to let UI settle
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Take screenshot immediately
        let simController = SimulatorController()
        let screenshot = try await simController.takeScreenshot(
            udid: udid,
            outputPath: nil,
            base64Output: true,
            useJpeg: true
        )

        return InteractResult(
            action: action.description,
            success: true,
            screenshot: screenshot,
            element: action.element
        )
    }

    // MARK: - Helpers

    /// Track which simulators we've connected to avoid redundant connect calls
    private static var connectedSimulators: Set<String> = []

    /// Ensure idb is connected to the simulator before performing any operations
    private func ensureIdbConnected(_ udid: String) async throws {
        // Skip if already connected in this session
        if UIInteractor.connectedSimulators.contains(udid) {
            return
        }

        // Connect idb to the simulator
        _ = try? await shell("idb", "connect", udid)
        UIInteractor.connectedSimulators.insert(udid)
    }

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

        // Auto-connect idb to the simulator
        try await ensureIdbConnected(resolvedUdid)

        return resolvedUdid
    }

    /// Helper to get available elements for error messages
    private func getAvailableElements(inspector: ViewInspector, udid: String) async throws -> AvailableElements {
        let result = try await inspector.captureAccessibilityTree(
            simulatorUDID: udid,
            includeNonAccessible: false
        )

        var identifiers: [String] = []
        var labels: [String] = []

        for element in result.elements {
            if let id = element.identifier, !id.isEmpty {
                identifiers.append(id)
            }
            if let label = element.label, !label.isEmpty {
                labels.append(label)
            }
        }

        return AvailableElements(identifiers: identifiers, labels: labels)
    }
}

/// Helper struct for available elements
private struct AvailableElements {
    let identifiers: [String]
    let labels: [String]
}

/// Action types for compound interact command
public enum InteractAction {
    case tap(x: Double, y: Double)
    case tapElement(id: String)
    case tapLabel(label: String)
    case type(text: String, elementId: String?, clear: Bool)
    case scroll(direction: ScrollDirection, amount: Double)

    var description: String {
        switch self {
        case .tap(let x, let y): return "tap(\(Int(x)), \(Int(y)))"
        case .tapElement(let id): return "tap(#\(id))"
        case .tapLabel(let label): return "tap(\"\(label)\")"
        case .type(let text, _, _): return "type(\"\(text.prefix(20))...\")"
        case .scroll(let dir, _): return "scroll(\(dir.rawValue))"
        }
    }

    public var element: String? {
        switch self {
        case .tapElement(let id): return id
        case .tapLabel(let label): return label
        case .type(_, let elementId, _): return elementId
        default: return nil
        }
    }
}

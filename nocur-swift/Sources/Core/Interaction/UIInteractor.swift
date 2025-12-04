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

        // idb uses logical points directly (not device pixels)
        // iPhone 16 Pro: device resolution 1206x2622, logical 393x852 (3x scale)
        let scale: Double = 3.0
        let logicalX = Int(x / scale)
        let logicalY = Int(y / scale)

        // Use idb for reliable touch input
        for _ in 0..<tapCount {
            _ = try await shell("idb", "ui", "tap", "--udid", udid, String(logicalX), String(logicalY))
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
            throw NocurError.notFound("Element not found: \(identifier)")
        }

        // Calculate center point
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
            throw NocurError.notFound("Element not found with label: \(label)")
        }

        // Calculate center point
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

        // Calculate swipe coordinates using idb
        // Start from center of screen
        let scale: Double = 3.0
        let centerX = 603 / scale  // ~201 logical points
        let centerY = 1311 / scale // ~437 logical points

        let swipeAmount = amount / scale

        var endX = centerX
        var endY = centerY

        switch direction {
        case .up:
            endY = centerY - swipeAmount
        case .down:
            endY = centerY + swipeAmount
        case .left:
            endX = centerX - swipeAmount
        case .right:
            endX = centerX + swipeAmount
        }

        // Use idb swipe
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
            try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }

        // Clear existing text if requested
        if clearFirst {
            // Use simctl keysequence - much simpler than idb
            _ = try await shell("xcrun", "simctl", "io", udid, "keysequence", "cmd-a", "delete")
            try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        }

        // Type text using simctl - faster and more reliable than idb
        // simctl io send-keys is actually called "keysequence"
        // We need to escape special characters and use the text input
        for char in text {
            if char == " " {
                _ = try await shell("xcrun", "simctl", "io", udid, "keysequence", "space")
            } else if char == "\n" {
                _ = try await shell("xcrun", "simctl", "io", udid, "keysequence", "return")
            } else if char == "@" {
                _ = try await shell("xcrun", "simctl", "io", udid, "keysequence", "shift-2")
            } else {
                _ = try await shell("xcrun", "simctl", "io", udid, "keysequence", String(char))
            }
        }

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

    private func resolveSimulator(_ udid: String?) async throws -> String {
        if let udid = udid {
            return udid
        }

        let output = try await shell("xcrun", "simctl", "list", "devices", "booted", "-j")

        guard let data = output.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = json["devices"] as? [String: [[String: Any]]] else {
            throw NocurError.notFound("No booted simulator found")
        }

        for (_, deviceList) in devices {
            if let device = deviceList.first, let udid = device["udid"] as? String {
                return udid
            }
        }

        throw NocurError.notFound("No booted simulator found")
    }
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

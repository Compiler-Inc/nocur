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
            try await Task.sleep(nanoseconds: 200_000_000)
        }

        // Clear existing text if requested
        if clearFirst {
            // Use idb key events: select all (Cmd+A) then delete
            _ = try await shell("idb", "ui", "key", "--udid", udid, "4", "--modifier", "command")  // Cmd+A
            try await Task.sleep(nanoseconds: 100_000_000)
            _ = try await shell("idb", "ui", "key", "--udid", udid, "42")  // Backspace
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        // Type text using idb
        _ = try await shell("idb", "ui", "text", "--udid", udid, text)

        return TypeResult(text: text, element: elementIdentifier, cleared: clearFirst)
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

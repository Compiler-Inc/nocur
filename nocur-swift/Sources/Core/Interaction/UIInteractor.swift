import Foundation

/// Interacts with UI elements in the simulator
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

        // Use simctl to send tap event
        for _ in 0..<tapCount {
            _ = try await shell(
                "xcrun", "simctl", "io", udid, "tap",
                String(Int(x)), String(Int(y))
            )
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

        // Tap at center
        for _ in 0..<tapCount {
            _ = try await shell(
                "xcrun", "simctl", "io", udid, "tap",
                String(Int(x)), String(Int(y))
            )
        }

        return TapResult(x: x, y: y, element: identifier)
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

        // Tap at center
        for _ in 0..<tapCount {
            _ = try await shell(
                "xcrun", "simctl", "io", udid, "tap",
                String(Int(x)), String(Int(y))
            )
        }

        return TapResult(x: x, y: y, element: label)
    }

    // MARK: - Scroll

    public func scroll(
        direction: ScrollDirection,
        amount: Double,
        elementIdentifier: String?,
        simulatorUDID: String?
    ) async throws -> ScrollResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Calculate scroll vectors
        var deltaX: Double = 0
        var deltaY: Double = 0

        switch direction {
        case .up:
            deltaY = amount
        case .down:
            deltaY = -amount
        case .left:
            deltaX = amount
        case .right:
            deltaX = -amount
        }

        // Get start point (center of screen or element)
        var startX: Double = 196  // Default center X for iPhone
        var startY: Double = 426  // Default center Y for iPhone

        if let identifier = elementIdentifier {
            let inspector = ViewInspector()
            let result = try await inspector.findElements(
                text: nil,
                type: nil,
                identifier: identifier,
                simulatorUDID: udid
            )

            if let element = result.matches.first {
                startX = element.frame.x + element.frame.width / 2
                startY = element.frame.y + element.frame.height / 2
            }
        }

        // Use simctl to send swipe event
        let endX = startX + deltaX
        let endY = startY + deltaY

        _ = try await shell(
            "xcrun", "simctl", "io", udid, "swipe",
            String(Int(startX)), String(Int(startY)),
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

            // Small delay for focus
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        // Clear existing text if requested
        if clearFirst {
            // Select all and delete
            // Note: This is platform-specific and may need adjustment
            _ = try await shell("xcrun", "simctl", "io", udid, "keyboard", "selectAll")
            try await Task.sleep(nanoseconds: 50_000_000)
        }

        // Type text using simctl
        _ = try await shell("xcrun", "simctl", "io", udid, "keyboard", text)

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

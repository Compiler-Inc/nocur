import Foundation

/// Inspects view hierarchy and accessibility tree of running apps
public final class ViewInspector {

    public init() {}

    // MARK: - Hierarchy Capture

    public func captureHierarchy(
        simulatorUDID: String?,
        bundleId: String?,
        maxDepth: Int?,
        includeHidden: Bool,
        includeFrames: Bool
    ) async throws -> HierarchyResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Use accessibility inspector to capture hierarchy
        // This is the fallback method - deeper introspection requires dylib injection
        let tree = try await captureAccessibilityHierarchy(udid: udid)

        return HierarchyResult(
            captureMethod: "accessibility",
            bundleId: bundleId,
            root: tree
        )
    }

    // MARK: - Accessibility Tree

    public func captureAccessibilityTree(
        simulatorUDID: String?,
        includeNonAccessible: Bool
    ) async throws -> AccessibilityTreeResult {
        let udid = try await resolveSimulator(simulatorUDID)

        // Use xcrun accessibility API
        // Note: This requires the app to be running and accessible
        let elements = try await captureAccessibilityElements(udid: udid)

        return AccessibilityTreeResult(elements: elements)
    }

    // MARK: - Find Elements

    public func findElements(
        text: String?,
        type: String?,
        identifier: String?,
        simulatorUDID: String?
    ) async throws -> FindResult {
        let udid = try await resolveSimulator(simulatorUDID)
        let allElements = try await captureAccessibilityElements(udid: udid)

        var matches = allElements

        if let text = text?.lowercased() {
            matches = matches.filter {
                ($0.label?.lowercased().contains(text) ?? false) ||
                ($0.value?.lowercased().contains(text) ?? false)
            }
        }

        if let type = type?.lowercased() {
            matches = matches.filter {
                $0.type.lowercased().contains(type)
            }
        }

        if let identifier = identifier {
            matches = matches.filter {
                $0.identifier == identifier
            }
        }

        return FindResult(matches: matches)
    }

    // MARK: - Private Helpers

    private func resolveSimulator(_ udid: String?) async throws -> String {
        if let udid = udid {
            return udid
        }

        // Get first booted simulator
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

    private func captureAccessibilityHierarchy(udid: String) async throws -> ViewNode {
        // Use simctl ui to get basic hierarchy
        // This is a simplified implementation - full implementation would use
        // private APIs or dylib injection

        // For now, return a placeholder structure
        // In production, this would capture the actual UI hierarchy

        return ViewNode(
            className: "UIWindow",
            frame: Frame(x: 0, y: 0, width: 393, height: 852),
            accessibilityIdentifier: nil,
            accessibilityLabel: "Main Window",
            isEnabled: true,
            isHidden: false,
            children: []
        )
    }

    private func captureAccessibilityElements(udid: String) async throws -> [AccessibilityElement] {
        // Use accessibility APIs to capture elements
        // This would typically use XCUITest or accessibility inspector

        // Placeholder implementation - in production would capture real elements
        return []
    }
}

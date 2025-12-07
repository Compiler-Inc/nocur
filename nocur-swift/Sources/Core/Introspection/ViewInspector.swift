import Foundation

// MARK: - idb Accessibility Models (for JSON parsing)

/// Represents the frame structure from idb
private struct IdbFrame: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

/// Represents a node in the idb accessibility tree
private struct IdbAccessibilityNode: Decodable {
    let type: String
    let role: String?
    let AXLabel: String?
    let AXValue: String?
    let AXUniqueId: String?
    let frame: IdbFrame
    let enabled: Bool
    let children: [IdbAccessibilityNode]?

    enum CodingKeys: String, CodingKey {
        case type, role, AXLabel, AXValue, AXUniqueId, frame, enabled, children
    }
}

/// Inspects view hierarchy and accessibility tree of running apps using idb
public final class ViewInspector {

    public init() {}

    /// Track which simulators we've connected to avoid redundant connect calls
    private static var connectedSimulators: Set<String> = []

    // MARK: - Hierarchy Capture

    public func captureHierarchy(
        simulatorUDID: String?,
        bundleId: String?,
        maxDepth: Int?,
        includeHidden: Bool,
        includeFrames: Bool
    ) async throws -> HierarchyResult {
        let udid = try await resolveSimulator(simulatorUDID)
        let tree = try await captureAccessibilityHierarchy(udid: udid)

        return HierarchyResult(
            captureMethod: "idb_accessibility",
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

    /// Ensure idb is connected to the simulator
    private func ensureIdbConnected(_ udid: String) async throws {
        if ViewInspector.connectedSimulators.contains(udid) {
            return
        }
        _ = try? await shell("idb", "connect", udid)
        ViewInspector.connectedSimulators.insert(udid)
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

        // Ensure idb is connected
        try await ensureIdbConnected(resolvedUdid)
        return resolvedUdid
    }

    /// Capture the full accessibility hierarchy using idb
    private func captureAccessibilityHierarchy(udid: String) async throws -> ViewNode {
        let output = try await shell("idb", "ui", "describe-all", "--udid", udid, "--json", "--nested")

        guard let data = output.data(using: .utf8) else {
            throw NocurError.parseError("Failed to get accessibility data from idb")
        }

        // Parse the JSON array from idb
        let decoder = JSONDecoder()
        let nodes: [IdbAccessibilityNode]
        do {
            nodes = try decoder.decode([IdbAccessibilityNode].self, from: data)
        } catch {
            throw NocurError.parseError("Failed to parse idb accessibility JSON: \(error)")
        }

        // Convert to our ViewNode format
        // idb returns an array with one root node (usually Application)
        guard let rootNode = nodes.first else {
            return ViewNode(
                className: "Empty",
                frame: Frame(x: 0, y: 0, width: 0, height: 0),
                isEnabled: false,
                isHidden: false,
                children: []
            )
        }

        return convertToViewNode(rootNode)
    }

    /// Convert idb node to our ViewNode format
    private func convertToViewNode(_ node: IdbAccessibilityNode) -> ViewNode {
        let children = node.children?.map { convertToViewNode($0) }

        return ViewNode(
            className: node.type,
            frame: Frame(x: node.frame.x, y: node.frame.y, width: node.frame.width, height: node.frame.height),
            accessibilityIdentifier: node.AXUniqueId,
            accessibilityLabel: node.AXLabel,
            accessibilityValue: node.AXValue,
            accessibilityTraits: node.role != nil ? [node.role!] : nil,
            isEnabled: node.enabled,
            isHidden: false,
            children: children
        )
    }

    /// Capture accessibility elements as a flat list using idb
    private func captureAccessibilityElements(udid: String) async throws -> [AccessibilityElement] {
        let output = try await shell("idb", "ui", "describe-all", "--udid", udid, "--json", "--nested")

        guard let data = output.data(using: .utf8) else {
            throw NocurError.parseError("Failed to get accessibility data from idb")
        }

        let decoder = JSONDecoder()
        let nodes: [IdbAccessibilityNode]
        do {
            nodes = try decoder.decode([IdbAccessibilityNode].self, from: data)
        } catch {
            throw NocurError.parseError("Failed to parse idb accessibility JSON: \(error)")
        }

        // Flatten the tree into a list of elements
        var elements: [AccessibilityElement] = []
        for node in nodes {
            flattenTree(node, into: &elements)
        }

        return elements
    }

    /// Recursively flatten the accessibility tree
    private func flattenTree(_ node: IdbAccessibilityNode, into elements: inout [AccessibilityElement]) {
        let element = AccessibilityElement(
            identifier: node.AXUniqueId,
            label: node.AXLabel,
            value: node.AXValue,
            type: node.type,
            frame: Frame(x: node.frame.x, y: node.frame.y, width: node.frame.width, height: node.frame.height),
            isEnabled: node.enabled,
            traits: node.role != nil ? [node.role!] : []
        )
        elements.append(element)

        // Recursively process children
        if let children = node.children {
            for child in children {
                flattenTree(child, into: &elements)
            }
        }
    }
}

import XCTest
@testable import Core

final class ViewInspectorTests: XCTestCase {

    var inspector: ViewInspector!

    override func setUp() {
        super.setUp()
        inspector = ViewInspector()
    }

    // MARK: - Capture Hierarchy Tests

    func testCaptureHierarchy() async throws {
        // Ensure we have a booted simulator
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for hierarchy test")
        }

        let result = try await inspector.captureHierarchy(
            simulatorUDID: nil,
            bundleId: nil,
            maxDepth: nil,
            includeHidden: false,
            includeFrames: true
        )

        // Verify result structure
        XCTAssertEqual(result.captureMethod, "accessibility")
        XCTAssertNotNil(result.root)
        XCTAssertFalse(result.root.className.isEmpty)
    }

    func testCaptureHierarchyWithDepth() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for hierarchy test")
        }

        let result = try await inspector.captureHierarchy(
            simulatorUDID: nil,
            bundleId: nil,
            maxDepth: 3,
            includeHidden: false,
            includeFrames: true
        )

        XCTAssertNotNil(result.root)
    }

    func testCaptureHierarchyIncludeHidden() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for hierarchy test")
        }

        let result = try await inspector.captureHierarchy(
            simulatorUDID: nil,
            bundleId: nil,
            maxDepth: nil,
            includeHidden: true,
            includeFrames: true
        )

        XCTAssertNotNil(result.root)
    }

    // MARK: - Accessibility Tree Tests

    func testCaptureAccessibilityTree() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for accessibility test")
        }

        let result = try await inspector.captureAccessibilityTree(
            simulatorUDID: nil,
            includeNonAccessible: false
        )

        // Result is valid (may be empty if no accessible elements)
        XCTAssertNotNil(result.elements)
    }

    func testCaptureAccessibilityTreeIncludeAll() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for accessibility test")
        }

        let result = try await inspector.captureAccessibilityTree(
            simulatorUDID: nil,
            includeNonAccessible: true
        )

        XCTAssertNotNil(result.elements)
    }

    // MARK: - Find Elements Tests

    func testFindElementsByText() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for find test")
        }

        // Search for common UI text (may or may not find results)
        let result = try await inspector.findElements(
            text: "Settings",
            type: nil,
            identifier: nil,
            simulatorUDID: nil
        )

        // Result should be valid (may be empty)
        XCTAssertNotNil(result.matches)
    }

    func testFindElementsByType() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for find test")
        }

        let result = try await inspector.findElements(
            text: nil,
            type: "button",
            identifier: nil,
            simulatorUDID: nil
        )

        XCTAssertNotNil(result.matches)
    }

    func testFindElementsByIdentifier() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for find test")
        }

        // Search for a specific identifier (may not exist)
        let result = try await inspector.findElements(
            text: nil,
            type: nil,
            identifier: "testIdentifier123",
            simulatorUDID: nil
        )

        // Should return empty array for non-existent identifier
        XCTAssertNotNil(result.matches)
    }

    func testFindElementsCombinedFilters() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for find test")
        }

        let result = try await inspector.findElements(
            text: "OK",
            type: "button",
            identifier: nil,
            simulatorUDID: nil
        )

        XCTAssertNotNil(result.matches)
    }

    // MARK: - Error Cases

    func testHierarchyNoSimulator() async throws {
        // Create inspector but don't check for booted simulator
        // This test verifies error handling when no simulator is booted
        // Skip if there is a booted simulator
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard status.booted.isEmpty else {
            throw XCTSkip("Simulator is booted - cannot test no-simulator error")
        }

        do {
            _ = try await inspector.captureHierarchy(
                simulatorUDID: nil,
                bundleId: nil,
                maxDepth: nil,
                includeHidden: false,
                includeFrames: true
            )
            XCTFail("Should have thrown error when no simulator booted")
        } catch {
            // Expected
        }
    }
}

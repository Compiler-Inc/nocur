import XCTest
@testable import Core

final class SimulatorControllerTests: XCTestCase {

    var controller: SimulatorController!

    override func setUp() {
        super.setUp()
        controller = SimulatorController()
    }

    // MARK: - List Simulators

    func testListSimulators() async throws {
        let result = try await controller.listSimulators()

        // Should return at least one simulator (Xcode installs default simulators)
        XCTAssertGreaterThan(result.count, 0, "Should have at least one simulator")
        XCTAssertEqual(result.simulators.count, result.count)

        // Verify simulator info structure
        if let first = result.simulators.first {
            XCTAssertFalse(first.udid.isEmpty, "UDID should not be empty")
            XCTAssertFalse(first.name.isEmpty, "Name should not be empty")
            XCTAssertFalse(first.runtime.isEmpty, "Runtime should not be empty")
        }
    }

    func testListSimulatorsWithFilter() async throws {
        let result = try await controller.listSimulators(filter: "iPhone")

        // All results should contain "iPhone"
        for sim in result.simulators {
            XCTAssertTrue(
                sim.name.lowercased().contains("iphone"),
                "Filtered result '\(sim.name)' should contain 'iPhone'"
            )
        }
    }

    func testListBootedSimulators() async throws {
        let result = try await controller.listSimulators(bootedOnly: true)

        // All results should be booted
        for sim in result.simulators {
            XCTAssertEqual(sim.state, .booted, "Simulator should be booted")
        }
    }

    // MARK: - Boot/Shutdown (Integration Tests)

    func testBootAndShutdown() async throws {
        // Find a shutdown simulator
        let list = try await controller.listSimulators()
        guard let shutdownSim = list.simulators.first(where: {
            $0.state == .shutdown && $0.name.contains("iPhone") && $0.isAvailable
        }) else {
            throw XCTSkip("No available shutdown simulator to test with")
        }

        // Boot it
        let bootResult = try await controller.bootSimulator(
            identifier: shutdownSim.udid,
            wait: true
        )

        XCTAssertEqual(bootResult.udid, shutdownSim.udid)
        XCTAssertEqual(bootResult.state, .booted)
        XCTAssertNotNil(bootResult.bootTime)

        // Verify it's booted
        let afterBoot = try await controller.listSimulators(bootedOnly: true)
        XCTAssertTrue(
            afterBoot.simulators.contains { $0.udid == shutdownSim.udid },
            "Simulator should appear in booted list"
        )

        // Shutdown
        _ = try await controller.shutdownSimulator(identifier: shutdownSim.udid)

        // Give it a moment to shut down
        try await Task.sleep(nanoseconds: 2_000_000_000)

        // Verify it's shutdown
        let afterShutdown = try await controller.listSimulators()
        let sim = afterShutdown.simulators.first { $0.udid == shutdownSim.udid }
        XCTAssertEqual(sim?.state, .shutdown, "Simulator should be shutdown")
    }

    // MARK: - Screenshot

    func testScreenshot() async throws {
        // Ensure we have a booted simulator
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for screenshot test")
        }

        let result = try await controller.takeScreenshot(udid: nil, outputPath: nil)

        // Verify result
        let path = try XCTUnwrap(result.path, "Screenshot path should not be nil")
        XCTAssertFalse(path.isEmpty, "Screenshot path should not be empty")
        XCTAssertGreaterThan(result.width, 0, "Width should be positive")
        XCTAssertGreaterThan(result.height, 0, "Height should be positive")
        XCTAssertFalse(result.simulator.isEmpty, "Simulator name should not be empty")

        // Verify file exists
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: path),
            "Screenshot file should exist at \(path)"
        )

        // Clean up
        try? FileManager.default.removeItem(atPath: path)
    }

    func testScreenshotWithCustomPath() async throws {
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for screenshot test")
        }

        let customPath = FileManager.default.temporaryDirectory
            .appendingPathComponent("test_screenshot_\(UUID().uuidString).png")
            .path

        let result = try await controller.takeScreenshot(udid: nil, outputPath: customPath)

        let path = try XCTUnwrap(result.path, "Screenshot path should not be nil")
        XCTAssertEqual(path, customPath, "Should use custom path")
        XCTAssertTrue(FileManager.default.fileExists(atPath: customPath))

        // Clean up
        try? FileManager.default.removeItem(atPath: customPath)
    }

    // MARK: - Status

    func testGetStatus() async throws {
        let result = try await controller.getStatus()

        // Structure should be valid (even if no simulators booted)
        XCTAssertNotNil(result.booted)
        XCTAssertNotNil(result.runningApps)
    }
}

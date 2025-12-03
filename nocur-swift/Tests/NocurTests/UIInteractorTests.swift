import XCTest
@testable import Core

final class UIInteractorTests: XCTestCase {

    var interactor: UIInteractor!

    override func setUp() {
        super.setUp()
        interactor = UIInteractor()
    }

    // MARK: - Tap Tests

    func testTapAtCoordinates() async throws {
        // Ensure we have a booted simulator
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for tap test")
        }

        // Tap at center of screen (should succeed on any app)
        let result = try await interactor.tap(
            x: 200,
            y: 400,
            simulatorUDID: nil,
            tapCount: 1
        )

        XCTAssertEqual(result.x, 200)
        XCTAssertEqual(result.y, 400)
        XCTAssertNil(result.element)
    }

    func testDoubleTap() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for tap test")
        }

        let result = try await interactor.tap(
            x: 200,
            y: 400,
            simulatorUDID: nil,
            tapCount: 2
        )

        XCTAssertEqual(result.x, 200)
        XCTAssertEqual(result.y, 400)
    }

    // MARK: - Scroll Tests

    func testScrollDown() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for scroll test")
        }

        let result = try await interactor.scroll(
            direction: .down,
            amount: 300,
            elementIdentifier: nil,
            simulatorUDID: nil
        )

        XCTAssertEqual(result.direction, "down")
        XCTAssertEqual(result.amount, 300)
    }

    func testScrollUp() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for scroll test")
        }

        let result = try await interactor.scroll(
            direction: .up,
            amount: 200,
            elementIdentifier: nil,
            simulatorUDID: nil
        )

        XCTAssertEqual(result.direction, "up")
        XCTAssertEqual(result.amount, 200)
    }

    func testScrollLeft() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for scroll test")
        }

        let result = try await interactor.scroll(
            direction: .left,
            amount: 150,
            elementIdentifier: nil,
            simulatorUDID: nil
        )

        XCTAssertEqual(result.direction, "left")
        XCTAssertEqual(result.amount, 150)
    }

    func testScrollRight() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for scroll test")
        }

        let result = try await interactor.scroll(
            direction: .right,
            amount: 150,
            elementIdentifier: nil,
            simulatorUDID: nil
        )

        XCTAssertEqual(result.direction, "right")
        XCTAssertEqual(result.amount, 150)
    }

    // MARK: - Type Tests

    func testTypeText() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for type test")
        }

        // Note: This will type into whatever is focused
        // In real usage, you'd tap a text field first
        let result = try await interactor.typeText(
            "Hello",
            elementIdentifier: nil,
            simulatorUDID: nil,
            clearFirst: false
        )

        XCTAssertEqual(result.text, "Hello")
        XCTAssertNil(result.element)
        XCTAssertFalse(result.cleared)
    }

    func testTypeTextWithClear() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for type test")
        }

        let result = try await interactor.typeText(
            "World",
            elementIdentifier: nil,
            simulatorUDID: nil,
            clearFirst: true
        )

        XCTAssertEqual(result.text, "World")
        XCTAssertTrue(result.cleared)
    }

    // MARK: - Error Cases

    func testTapElementNotFound() async throws {
        let controller = SimulatorController()
        let status = try await controller.getStatus()
        guard !status.booted.isEmpty else {
            throw XCTSkip("No booted simulator for test")
        }

        do {
            _ = try await interactor.tapElement(
                identifier: "nonExistentElementId12345",
                simulatorUDID: nil,
                tapCount: 1
            )
            XCTFail("Should have thrown error for non-existent element")
        } catch {
            // Expected - element not found
            XCTAssertTrue(error.localizedDescription.contains("not found") ||
                         error is NocurError)
        }
    }
}

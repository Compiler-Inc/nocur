import ArgumentParser
import Core

struct UI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "ui",
        abstract: "UI introspection and interaction",
        discussion: """
            Commands for inspecting view hierarchy, accessibility tree,
            and interacting with UI elements (tap, scroll, type).

            These are the core tools for AI agents to understand and
            interact with iOS app interfaces.
            """,
        subcommands: [
            Hierarchy.self,
            Accessibility.self,
            Tap.self,
            Scroll.self,
            Type.self,
            Find.self
        ]
    )
}

// MARK: - Hierarchy

extension UI {
    struct Hierarchy: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Dump view hierarchy",
            discussion: """
                Captures the complete view hierarchy of the running app.
                Returns structured JSON representing all views, their types,
                frames, and properties.

                Example output:
                {
                  "success": true,
                  "captureMethod": "accessibility",
                  "bundleId": "com.example.myapp",
                  "timestamp": "2024-01-15T10:30:00Z",
                  "root": {
                    "class": "UIWindow",
                    "frame": {"x": 0, "y": 0, "width": 393, "height": 852},
                    "accessibilityIdentifier": null,
                    "accessibilityLabel": null,
                    "children": [...]
                  }
                }

                For SwiftUI apps, also includes:
                {
                  "swiftUITree": {
                    "type": "VStack",
                    "children": [
                      {"type": "Text", "content": "Hello"},
                      {"type": "Button", "label": "Tap me"}
                    ]
                  }
                }
                """
        )

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Option(name: .long, help: "Bundle ID of app to inspect")
        var bundleId: String?

        @Option(name: .long, help: "Max depth to traverse (default: unlimited)")
        var depth: Int?

        @Flag(name: .long, help: "Include hidden views")
        var includeHidden: Bool = false

        @Flag(name: .long, inversion: .prefixedNo, help: "Include frame coordinates (default: true)")
        var includeFrames: Bool = true

        func run() async throws {
            let inspector = ViewInspector()
            let result = try await inspector.captureHierarchy(
                simulatorUDID: simulator,
                bundleId: bundleId,
                maxDepth: depth,
                includeHidden: includeHidden,
                includeFrames: includeFrames
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Accessibility

extension UI {
    struct Accessibility: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Dump accessibility tree",
            discussion: """
                Captures the accessibility tree of the running app.
                This is often more useful than raw view hierarchy for
                understanding UI semantics.

                Example output:
                {
                  "success": true,
                  "elements": [
                    {
                      "identifier": "loginButton",
                      "label": "Log In",
                      "type": "button",
                      "frame": {"x": 100, "y": 500, "width": 200, "height": 44},
                      "enabled": true,
                      "traits": ["button"]
                    }
                  ]
                }
                """
        )

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Flag(name: .long, help: "Include non-accessible elements")
        var all: Bool = false

        func run() async throws {
            let inspector = ViewInspector()
            let result = try await inspector.captureAccessibilityTree(
                simulatorUDID: simulator,
                includeNonAccessible: all
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Tap

extension UI {
    struct Tap: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Tap at coordinates or element",
            discussion: """
                Simulates a tap gesture. Can tap by:
                - Coordinates: nocur-swift ui tap 200 500
                - Accessibility ID: nocur-swift ui tap --id "loginButton"
                - Accessibility label: nocur-swift ui tap --label "Log In"

                Example output:
                {
                  "success": true,
                  "action": "tap",
                  "coordinates": {"x": 200, "y": 500},
                  "element": "loginButton"
                }
                """
        )

        @Argument(help: "X coordinate")
        var x: Double?

        @Argument(help: "Y coordinate")
        var y: Double?

        @Option(name: .long, help: "Tap element by accessibility identifier")
        var id: String?

        @Option(name: .long, help: "Tap element by accessibility label")
        var label: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Option(name: .long, help: "Number of taps (default: 1)")
        var count: Int = 1

        func run() async throws {
            let interactor = UIInteractor()

            let result: TapResult
            if let id = id {
                result = try await interactor.tapElement(
                    identifier: id,
                    simulatorUDID: simulator,
                    tapCount: count
                )
            } else if let label = label {
                result = try await interactor.tapElementByLabel(
                    label: label,
                    simulatorUDID: simulator,
                    tapCount: count
                )
            } else if let x = x, let y = y {
                result = try await interactor.tap(
                    x: x, y: y,
                    simulatorUDID: simulator,
                    tapCount: count
                )
            } else {
                throw ValidationError("Provide coordinates (x y) or --id or --label")
            }

            print(Output.success(result).json)
        }
    }
}

// MARK: - Scroll

extension UI {
    struct Scroll: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Scroll in a direction",
            discussion: """
                Simulates a scroll gesture.

                Examples:
                  nocur-swift ui scroll down           # Scroll down
                  nocur-swift ui scroll up --amount 500    # Scroll up 500 points
                  nocur-swift ui scroll left --id scrollView  # Scroll in element
                """
        )

        @Argument(help: "Direction: up, down, left, right")
        var direction: ScrollDirection

        @Option(name: .long, help: "Scroll amount in points (default: 300)")
        var amount: Double = 300

        @Option(name: .long, help: "Element identifier to scroll within")
        var id: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        func run() async throws {
            let interactor = UIInteractor()
            let result = try await interactor.scroll(
                direction: direction,
                amount: amount,
                elementIdentifier: id,
                simulatorUDID: simulator
            )
            print(Output.success(result).json)
        }
    }
}

// Extend Core's ScrollDirection with ArgumentParser support
extension ScrollDirection: ExpressibleByArgument {}

// MARK: - Type

extension UI {
    struct `Type`: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Type text",
            discussion: """
                Types text into the currently focused field or specified element.

                Examples:
                  nocur-swift ui type "Hello World"
                  nocur-swift ui type "user@example.com" --id emailField
                  nocur-swift ui type "password" --clear  # Clear first, then type
                """
        )

        @Argument(help: "Text to type")
        var text: String

        @Option(name: .long, help: "Element identifier to type into")
        var id: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        @Flag(name: .long, help: "Clear existing text before typing")
        var clear: Bool = false

        func run() async throws {
            let interactor = UIInteractor()
            let result = try await interactor.typeText(
                text,
                elementIdentifier: id,
                simulatorUDID: simulator,
                clearFirst: clear
            )
            print(Output.success(result).json)
        }
    }
}

// MARK: - Find

extension UI {
    struct Find: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Find UI elements",
            discussion: """
                Searches for UI elements matching criteria. Useful for
                finding elements before interacting with them.

                Examples:
                  nocur-swift ui find --text "Submit"
                  nocur-swift ui find --type button
                  nocur-swift ui find --id "loginButton"

                Example output:
                {
                  "success": true,
                  "matches": [
                    {
                      "identifier": "submitButton",
                      "label": "Submit",
                      "type": "button",
                      "frame": {"x": 100, "y": 700, "width": 200, "height": 44},
                      "enabled": true
                    }
                  ]
                }
                """
        )

        @Option(name: .long, help: "Find by text content or label")
        var text: String?

        @Option(name: .long, help: "Find by element type (button, textField, etc.)")
        var type: String?

        @Option(name: .long, help: "Find by accessibility identifier")
        var id: String?

        @Option(name: .long, help: "Target simulator UDID")
        var simulator: String?

        func run() async throws {
            let inspector = ViewInspector()
            let result = try await inspector.findElements(
                text: text,
                type: type,
                identifier: id,
                simulatorUDID: simulator
            )
            print(Output.success(result).json)
        }
    }
}

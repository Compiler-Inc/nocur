import ArgumentParser
import Core

struct Device: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "device",
        abstract: "Unified device management (simulators + physical devices)",
        discussion: """
            Commands for managing all iOS devices: both simulators and physical devices.
            Use these commands to list available devices, get device info, and manage
            the active device for building and running apps.
            """,
        subcommands: [
            List.self,
            Info.self
        ],
        defaultSubcommand: List.self
    )
}

// MARK: - List

extension Device {
    struct List: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "List all available devices (simulators + physical)",
            discussion: """
                Returns all available iOS devices including simulators and physical devices.
                Physical devices require Xcode 15+ and devicectl.

                Example output:
                {
                  "success": true,
                  "data": {
                    "devices": [
                      {
                        "id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
                        "name": "iPhone 16 Pro",
                        "model": "iPhone 16 Pro",
                        "osVersion": "18.0",
                        "deviceType": "simulator",
                        "state": "booted",
                        "isAvailable": true
                      },
                      {
                        "id": "YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY",
                        "name": "Atharva's iPhone",
                        "model": "iPhone 16 Pro",
                        "osVersion": "26.1",
                        "deviceType": "physical",
                        "state": "connected",
                        "isAvailable": true
                      }
                    ],
                    "simulatorCount": 1,
                    "physicalCount": 1
                  }
                }
                """
        )

        @Flag(name: .long, help: "Only show simulators")
        var simulators: Bool = false

        @Flag(name: .long, help: "Only show physical devices")
        var physical: Bool = false

        @Flag(name: .long, help: "Only show available/usable devices")
        var available: Bool = false

        func run() async throws {
            let manager = DeviceManager()
            
            if simulators {
                // Only simulators
                let sims = try await manager.listSimulators(bootedOnly: false)
                let filtered = available ? sims.filter { $0.isAvailable } : sims
                let result = DeviceListResult(devices: filtered)
                print(Output.success(result).json)
            } else if physical {
                // Only physical devices
                let phys = try await manager.listPhysicalDevices(connectedOnly: false)
                let filtered = available ? phys.filter { $0.isAvailable } : phys
                let result = DeviceListResult(devices: filtered)
                print(Output.success(result).json)
            } else {
                // All devices
                let result = try await manager.listAllDevices(availableOnly: available)
                print(Output.success(result).json)
            }
        }
    }
}

// MARK: - Info

extension Device {
    struct Info: AsyncParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "Get info about a specific device",
            discussion: """
                Returns detailed information about a specific device by its ID.
                """
        )

        @Argument(help: "Device ID (UDID for simulators, CoreDevice UUID for physical)")
        var deviceId: String

        func run() async throws {
            let manager = DeviceManager()
            
            guard let device = try await manager.getDevice(id: deviceId) else {
                print(Output<DeviceInfo>.failure("Device not found: \(deviceId)").json)
                return
            }
            
            print(Output.success(device).json)
        }
    }
}

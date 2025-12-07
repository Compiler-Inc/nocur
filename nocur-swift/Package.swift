// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "nocur-swift",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "nocur-swift", targets: ["CLI"]),
        .library(name: "NocurCore", targets: ["Core"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.3.0"),
        .package(url: "https://github.com/tuist/XcodeProj.git", from: "8.16.0")
    ],
    targets: [
        .executableTarget(
            name: "CLI",
            dependencies: [
                "Core",
                .product(name: "ArgumentParser", package: "swift-argument-parser")
            ]
        ),
        .target(
            name: "Core",
            dependencies: [
                .product(name: "XcodeProj", package: "XcodeProj")
            ]
        ),
        .testTarget(
            name: "NocurTests",
            dependencies: ["Core"]
        )
    ]
)

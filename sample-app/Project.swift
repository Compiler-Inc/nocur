import ProjectDescription

let project = Project(
    name: "NocurTestApp",
    organizationName: "Nocur",
    targets: [
        .target(
            name: "NocurTestApp",
            destinations: [.iPhone, .iPad],
            product: .app,
            bundleId: "com.nocur.testapp",
            deploymentTargets: .iOS("17.0"),
            infoPlist: .extendingDefault(with: [
                "UILaunchScreen": [
                    "UIColorName": "",
                    "UIImageName": "",
                ],
                "NSAppTransportSecurity": [
                    "NSAllowsArbitraryLoads": true
                ]
            ]),
            sources: ["NocurTestApp/**/*.swift"],
            resources: ["NocurTestApp/Assets.xcassets"],
            entitlements: .file(path: "NocurTestApp/NocurTestApp.entitlements"),
            dependencies: []
        ),
    ]
)

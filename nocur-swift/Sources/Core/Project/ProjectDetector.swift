import Foundation

/// Detects and inspects Xcode projects
public final class ProjectDetector {

    public init() {}

    // MARK: - Detect Project

    public func detectProject(in path: String?) async throws -> ProjectInfo {
        let searchPath = path ?? FileManager.default.currentDirectoryPath

        // Look for workspace first (preferred), then project
        let contents = try FileManager.default.contentsOfDirectory(atPath: searchPath)

        // Check for .xcworkspace
        if let workspace = contents.first(where: { $0.hasSuffix(".xcworkspace") && !$0.contains("xcuserdata") }) {
            let fullPath = (searchPath as NSString).appendingPathComponent(workspace)
            return try await getWorkspaceInfo(path: fullPath)
        }

        // Check for .xcodeproj
        if let project = contents.first(where: { $0.hasSuffix(".xcodeproj") }) {
            let fullPath = (searchPath as NSString).appendingPathComponent(project)
            return try await getProjectInfo(path: fullPath)!
        }

        throw NocurError.notFound("No Xcode project or workspace found in \(searchPath)")
    }

    // MARK: - Get Project Info

    public func getProjectInfo(path: String?) async throws -> ProjectInfo? {
        let projectPath: String

        if let path = path {
            projectPath = path
        } else {
            let detected = try await detectProject(in: nil)
            projectPath = detected.path
        }

        let isWorkspace = projectPath.hasSuffix(".xcworkspace")
        let name = (projectPath as NSString).lastPathComponent
            .replacingOccurrences(of: ".xcworkspace", with: "")
            .replacingOccurrences(of: ".xcodeproj", with: "")

        // Get schemes using xcodebuild
        let schemes = try await listSchemes(path: projectPath)

        // Get targets using xcodebuild -list
        let listOutput = try await shell("xcodebuild", "-list", "-json",
                                         isWorkspace ? "-workspace" : "-project", projectPath)

        var targets: [TargetInfo] = []
        var bundleId: String?
        var deploymentTarget: String?

        if let data = listOutput.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

            if let projectInfo = json["project"] as? [String: Any] {
                if let targetNames = projectInfo["targets"] as? [String] {
                    targets = targetNames.map { TargetInfo(name: $0, type: "unknown") }
                }
            } else if let workspaceInfo = json["workspace"] as? [String: Any] {
                if let schemeNames = workspaceInfo["schemes"] as? [String] {
                    // Workspace doesn't list targets directly
                }
            }
        }

        // Try to get more info from build settings
        if let firstScheme = schemes.schemes.first?.name {
            let settingsOutput = try? await shell(
                "xcodebuild", "-showBuildSettings", "-json",
                isWorkspace ? "-workspace" : "-project", projectPath,
                "-scheme", firstScheme
            )

            if let settingsData = settingsOutput?.data(using: .utf8),
               let settings = try? JSONSerialization.jsonObject(with: settingsData) as? [[String: Any]],
               let buildSettings = settings.first?["buildSettings"] as? [String: Any] {
                bundleId = buildSettings["PRODUCT_BUNDLE_IDENTIFIER"] as? String
                deploymentTarget = buildSettings["IPHONEOS_DEPLOYMENT_TARGET"] as? String
            }
        }

        return ProjectInfo(
            type: isWorkspace ? "workspace" : "project",
            path: projectPath,
            name: name,
            bundleId: bundleId,
            deploymentTarget: deploymentTarget,
            schemes: schemes.schemes.map { $0.name },
            targets: targets
        )
    }

    private func getWorkspaceInfo(path: String) async throws -> ProjectInfo {
        return try await getProjectInfo(path: path)!
    }

    // MARK: - List Schemes

    public func listSchemes(path: String?) async throws -> SchemesResult {
        var args = ["xcodebuild", "-list", "-json"]

        if let path = path {
            if path.hasSuffix(".xcworkspace") {
                args.append(contentsOf: ["-workspace", path])
            } else {
                args.append(contentsOf: ["-project", path])
            }
        }

        let output = try await shell(args)

        guard let data = output.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NocurError.parseError("Failed to parse xcodebuild output")
        }

        var schemeNames: [String] = []

        if let projectInfo = json["project"] as? [String: Any],
           let schemes = projectInfo["schemes"] as? [String] {
            schemeNames = schemes
        } else if let workspaceInfo = json["workspace"] as? [String: Any],
                  let schemes = workspaceInfo["schemes"] as? [String] {
            schemeNames = schemes
        }

        let schemes = schemeNames.map { name in
            SchemeInfo(name: name, shared: true, buildable: true)
        }

        return SchemesResult(schemes: schemes)
    }
}

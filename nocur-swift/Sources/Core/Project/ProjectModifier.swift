import Foundation
import XcodeProj
import PathKit

/// Modifies Xcode projects programmatically (add files, etc.)
public final class ProjectModifier {

    public init() {}

    // MARK: - Add Files to Project

    /// Adds one or more files to an Xcode project's target
    /// - Parameters:
    ///   - files: Paths to files to add
    ///   - projectPath: Path to .xcodeproj (auto-detects if nil)
    ///   - targetName: Name of target to add files to (uses first target if nil)
    ///   - groupPath: Group path within project (e.g., "Sources/Views")
    /// - Returns: Result with added file references
    public func addFiles(
        _ files: [String],
        projectPath: String?,
        targetName: String?,
        groupPath: String?
    ) async throws -> AddFilesResult {
        // Resolve project path
        let projPath: String
        if let path = projectPath {
            projPath = path
        } else {
            let detector = ProjectDetector()
            let detected = try await detector.detectProject(in: nil)
            // For workspaces, we need to find the actual .xcodeproj inside
            if detected.type == "workspace" {
                projPath = try findProjectInWorkspace(detected.path)
            } else {
                projPath = detected.path
            }
        }

        // Load the Xcode project
        let path = Path(projPath)
        let xcodeproj = try XcodeProj(path: path)
        let pbxproj = xcodeproj.pbxproj

        // Find the target
        let target: PBXNativeTarget
        if let name = targetName {
            guard let found = pbxproj.nativeTargets.first(where: { $0.name == name }) else {
                throw NocurError.notFound("Target '\(name)' not found in project")
            }
            target = found
        } else {
            // Use first native target (usually the main app)
            guard let first = pbxproj.nativeTargets.first else {
                throw NocurError.notFound("No targets found in project")
            }
            target = first
        }

        // Find or create the group
        let projectDir = path.parent()
        let mainGroup = try pbxproj.rootGroup()

        var targetGroup = mainGroup
        if let groupPathStr = groupPath {
            // Navigate/create group hierarchy
            let components = groupPathStr.components(separatedBy: "/")
            for component in components {
                if let existing = targetGroup?.group(named: component) {
                    targetGroup = existing
                } else {
                    // Create the group if it doesn't exist
                    let newGroup = PBXGroup(sourceTree: .group, name: component)
                    pbxproj.add(object: newGroup)
                    targetGroup?.children.append(newGroup)
                    targetGroup = newGroup
                }
            }
        }

        guard let group = targetGroup else {
            throw NocurError.notFound("Could not find or create group")
        }

        // Add each file
        var addedFiles: [AddedFileInfo] = []

        for filePath in files {
            let fileFullPath = Path(filePath)
            let fileName = fileFullPath.lastComponent

            // Calculate relative path from project directory
            let relativePath: String
            if fileFullPath.isAbsolute {
                if fileFullPath.string.hasPrefix(projectDir.string) {
                    relativePath = String(fileFullPath.string.dropFirst(projectDir.string.count + 1))
                } else {
                    relativePath = fileFullPath.string
                }
            } else {
                relativePath = filePath
            }

            // Check if file already exists in project
            let existingRef = group.children.first { element in
                if let fileRef = element as? PBXFileReference {
                    return fileRef.path == relativePath || fileRef.name == fileName
                }
                return false
            }

            if existingRef != nil {
                addedFiles.append(AddedFileInfo(
                    path: filePath,
                    name: fileName,
                    added: false,
                    reason: "Already in project"
                ))
                continue
            }

            // Determine file type
            let fileType = fileTypeForExtension(fileFullPath.extension ?? "")

            // Create file reference
            let fileRef = PBXFileReference(
                sourceTree: .group,
                name: fileName,
                lastKnownFileType: fileType,
                path: relativePath
            )
            pbxproj.add(object: fileRef)
            group.children.append(fileRef)

            // Add to target's build phase if it's a source file
            if isSourceFile(fileName) {
                let buildFile = PBXBuildFile(file: fileRef)
                pbxproj.add(object: buildFile)

                // Add to sources build phase
                if let sourcesBuildPhase = target.buildPhases.first(where: { $0 is PBXSourcesBuildPhase }) as? PBXSourcesBuildPhase {
                    sourcesBuildPhase.files?.append(buildFile)
                }
            }

            addedFiles.append(AddedFileInfo(
                path: filePath,
                name: fileName,
                added: true,
                reason: nil
            ))
        }

        // Save the project
        try xcodeproj.write(path: path)

        return AddFilesResult(
            project: projPath,
            target: target.name,
            files: addedFiles,
            addedCount: addedFiles.filter { $0.added }.count
        )
    }

    // MARK: - Helpers

    private func findProjectInWorkspace(_ workspacePath: String) throws -> String {
        let workspaceDir = (workspacePath as NSString).deletingLastPathComponent
        let contents = try FileManager.default.contentsOfDirectory(atPath: workspaceDir)

        if let project = contents.first(where: { $0.hasSuffix(".xcodeproj") }) {
            return (workspaceDir as NSString).appendingPathComponent(project)
        }

        throw NocurError.notFound("No .xcodeproj found in workspace directory")
    }

    private func fileTypeForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
        case "swift": return "sourcecode.swift"
        case "m": return "sourcecode.c.objc"
        case "mm": return "sourcecode.cpp.objcpp"
        case "c": return "sourcecode.c.c"
        case "cpp", "cc", "cxx": return "sourcecode.cpp.cpp"
        case "h": return "sourcecode.c.h"
        case "hpp": return "sourcecode.cpp.h"
        case "xib": return "file.xib"
        case "storyboard": return "file.storyboard"
        case "xcassets": return "folder.assetcatalog"
        case "plist": return "text.plist.xml"
        case "json": return "text.json"
        case "strings": return "text.plist.strings"
        case "entitlements": return "text.plist.entitlements"
        case "metal": return "sourcecode.metal"
        default: return "file"
        }
    }

    private func isSourceFile(_ fileName: String) -> Bool {
        let sourceExtensions = ["swift", "m", "mm", "c", "cpp", "cc", "cxx", "metal"]
        let ext = (fileName as NSString).pathExtension.lowercased()
        return sourceExtensions.contains(ext)
    }
}

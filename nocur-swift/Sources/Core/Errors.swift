import Foundation

/// Errors that can occur during nocur operations
public enum NocurError: LocalizedError {
    case notFound(String)
    case invalidArgument(String)
    case parseError(String)
    case timeout(String)
    case shellError(command: String, exitCode: Int32, stderr: String)
    case buildFailed(errors: [BuildError])
    case unknown(String)

    public var errorDescription: String? {
        switch self {
        case .notFound(let message):
            return "Not found: \(message)"
        case .invalidArgument(let message):
            return "Invalid argument: \(message)"
        case .parseError(let message):
            return "Parse error: \(message)"
        case .timeout(let message):
            return "Timeout: \(message)"
        case .shellError(let command, let exitCode, let stderr):
            return "Command '\(command)' failed with exit code \(exitCode): \(stderr)"
        case .buildFailed(let errors):
            let messages = errors.map { $0.message }.joined(separator: "\n")
            return "Build failed:\n\(messages)"
        case .unknown(let message):
            return "Error: \(message)"
        }
    }
}

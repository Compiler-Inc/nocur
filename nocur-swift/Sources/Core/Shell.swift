import Foundation

/// Execute a shell command asynchronously
public func shell(_ args: String...) async throws -> String {
    try await shell(Array(args))
}

/// Execute a shell command asynchronously with array of arguments
public func shell(_ args: [String]) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global().async {
            do {
                let result = try shellSync(args)
                continuation.resume(returning: result)
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}

/// Execute a shell command synchronously
public func shellSync(_ args: String...) throws -> String {
    try shellSync(Array(args))
}

/// Execute a shell command synchronously with array of arguments
public func shellSync(_ args: [String]) throws -> String {
    guard !args.isEmpty else {
        throw NocurError.invalidArgument("No command provided")
    }

    let process = Process()
    let stdout = Pipe()
    let stderr = Pipe()

    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = args
    process.standardOutput = stdout
    process.standardError = stderr
    process.environment = ProcessInfo.processInfo.environment

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        throw NocurError.shellError(
            command: args.joined(separator: " "),
            exitCode: -1,
            stderr: error.localizedDescription
        )
    }

    let outputData = stdout.fileHandleForReading.readDataToEndOfFile()
    let errorData = stderr.fileHandleForReading.readDataToEndOfFile()

    let output = String(data: outputData, encoding: .utf8) ?? ""
    let errorOutput = String(data: errorData, encoding: .utf8) ?? ""

    if process.terminationStatus != 0 {
        throw NocurError.shellError(
            command: args.joined(separator: " "),
            exitCode: process.terminationStatus,
            stderr: errorOutput
        )
    }

    return output
}

/// Execute a shell command and stream output
public func shellStreaming(
    _ args: [String],
    onStdout: @escaping (String) -> Void,
    onStderr: @escaping (String) -> Void
) async throws -> Int32 {
    guard !args.isEmpty else {
        throw NocurError.invalidArgument("No command provided")
    }

    return try await withCheckedThrowingContinuation { continuation in
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()

        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = args
        process.standardOutput = stdout
        process.standardError = stderr
        process.environment = ProcessInfo.processInfo.environment

        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
                onStdout(str)
            }
        }

        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty, let str = String(data: data, encoding: .utf8) {
                onStderr(str)
            }
        }

        process.terminationHandler = { proc in
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            continuation.resume(returning: proc.terminationStatus)
        }

        do {
            try process.run()
        } catch {
            continuation.resume(throwing: NocurError.shellError(
                command: args.joined(separator: " "),
                exitCode: -1,
                stderr: error.localizedDescription
            ))
        }
    }
}

import Foundation

// MARK: - AI Model Protocol

protocol AIModelService {
    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String
    var modelType: AIModelType { get }
}
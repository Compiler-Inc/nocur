import Foundation
import FoundationModels

// MARK: - Apple Foundation Models Service

class AppleFoundationModelService: AIModelService {
    let modelType: AIModelType = .appleFoundation
    private var foundationSession: Any?

    init() {
        initializeSession()
    }

    private func initializeSession() {
        if #available(iOS 26.0, *) {
            foundationSession = LanguageModelSession {
                "You are a helpful assistant. Answer questions clearly and concisely."
            }
        }
    }

    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String {
        guard #available(iOS 26.0, *) else {
            throw NSError(domain: "FoundationModelsError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Foundation Models requires iOS 26.0 or later"])
        }

        // Check if Foundation Models is available on this device
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            break
        case .unavailable(let reason):
            switch reason {
            case .appleIntelligenceNotEnabled:
                return "Apple Intelligence is not enabled on this device. Please enable it in Settings > Apple Intelligence."
            case .deviceNotEligible:
                return "This device doesn't support Foundation Models. Try using the Local Demo Model instead."
            @unknown default:
                return "Foundation Models is unavailable on this device."
            }
        }

        do {
            guard let sessionAny = foundationSession,
                  let session = sessionAny as? LanguageModelSession else {
                throw NSError(domain: "FoundationModelsError", code: 3, userInfo: [NSLocalizedDescriptionKey: "Foundation Models session not initialized"])
            }

            // Build proper conversation context
            let recentMessages = conversationHistory.suffix(6).filter {
                !$0.content.contains("Hi there! I'm your local chat assistant")
            }
            let conversationContext = recentMessages.map { msg in
                msg.isUser ? "User: \(msg.content)" : "Assistant: \(msg.content)"
            }.joined(separator: "\n")

            let cleanPrompt: String
            if conversationContext.isEmpty {
                cleanPrompt = message
            } else {
                cleanPrompt = "\(conversationContext)\nUser: \(message)"
            }

            let response = try await session.respond(to: cleanPrompt)
            return response.content
        } catch {
            // Handle safety filter issues intelligently
            return handleSafetyFilterError(error: error, message: message)
        }
    }

    private func handleSafetyFilterError(error: Error, message: String) -> String {
        let errorDescription = error.localizedDescription
        let lowerMessage = message.lowercased()

        if errorDescription.contains("unsafe") || errorDescription.contains("content") || errorDescription.contains("policy") {
            // Try math operations first
            if let result = MathHelper.trySimpleMath(message) {
                return result
            }

            // Handle common requests
            if lowerMessage.contains("hello") || lowerMessage.contains("hi") || lowerMessage.contains("hey") {
                return "Hello! I'm Apple's Foundation Models running locally on your device. How can I help you today?"
            }

            if lowerMessage.contains("what") && (lowerMessage.contains("you") || lowerMessage.contains("are")) {
                return "I'm Apple's Foundation Models, running entirely on your device for privacy. I can help with questions, math, writing, and general assistance."
            }

            if lowerMessage.contains("joke") {
                return "I understand you'd like a joke, but Apple's safety filters are being cautious. Try asking for a fun fact instead!"
            }

            return "Apple's safety filters are being extra cautious with this question. Try rephrasing your question more directly, or use simpler language. For math and technical questions, the Local Demo Model might work better."
        }

        return "Failed to generate response: \(errorDescription)"
    }

    func resetSession() {
        initializeSession()
    }
}
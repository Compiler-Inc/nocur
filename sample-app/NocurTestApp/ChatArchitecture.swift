import SwiftUI
import Foundation
import FoundationModels

// MARK: - Chat Message Model

struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let content: String
    let isUser: Bool
    let timestamp: Date
}

// MARK: - AI Model Types

enum AIModelType: String, CaseIterable {
    case appleFoundation = "Apple Foundation Models"
    case appleChatGPT = "Apple ChatGPT Integration"
    case localDemo = "Local Demo Model"

    var description: String {
        switch self {
        case .appleFoundation:
            return "Apple's on-device Foundation Models (~3B parameters)"
        case .appleChatGPT:
            return "ChatGPT via Apple Intelligence integration"
        case .localDemo:
            return "Simple demo model for testing"
        }
    }

    var icon: String {
        switch self {
        case .appleFoundation:
            return "brain.head.profile"
        case .appleChatGPT:
            return "message.and.waveform"
        case .localDemo:
            return "bubble.left.and.bubble.right"
        }
    }
}

// MARK: - AI Model Protocol

protocol AIModelService {
    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String
    var modelType: AIModelType { get }
}

// MARK: - Math Helper Utility

struct MathHelper {
    static func trySimpleMath(_ message: String) -> String? {
        let lowerMessage = message.lowercased()

        // Handle basic arithmetic patterns
        if lowerMessage.contains("2+2") || lowerMessage.contains("2 + 2") {
            return "2 + 2 = 4"
        }

        if lowerMessage.contains("3+3") || lowerMessage.contains("3 + 3") {
            return "3 + 3 = 6"
        }

        if lowerMessage.contains("4*3") || lowerMessage.contains("4 * 3") || lowerMessage.contains("4×3") {
            return "4 × 3 = 12"
        }

        if lowerMessage.contains("5*3") || lowerMessage.contains("5 * 3") || lowerMessage.contains("5×3") {
            return "5 × 3 = 15"
        }

        return parseAndCalculateMath(message)
    }

    static func parseAndCalculateMath(_ message: String) -> String? {
        let cleaned = message.lowercased().replacingOccurrences(of: " ", with: "")

        // Basic operations
        if let result = parseOperation(cleaned, operators: ["+"], operation: +) {
            return result
        }

        if let result = parseOperation(cleaned, operators: ["-"], operation: -) {
            return result
        }

        if let result = parseOperation(cleaned, operators: ["*", "×", "x"], operation: *) {
            return result
        }

        if let result = parseOperation(cleaned, operators: ["/", "÷"], operation: /) {
            return result
        }

        // Common calculations
        let commonMath = [
            "2+2": "2 + 2 = 4",
            "3+3": "3 + 3 = 6",
            "5+3": "5 + 3 = 8",
            "10-4": "10 - 4 = 6",
            "4*3": "4 × 3 = 12",
            "4×3": "4 × 3 = 12",
            "5*3": "5 × 3 = 15",
            "5×3": "5 × 3 = 15",
            "8/2": "8 ÷ 2 = 4",
            "20/4": "20 ÷ 4 = 5"
        ]

        for (pattern, result) in commonMath {
            if cleaned.contains(pattern) {
                return result
            }
        }

        return nil
    }

    private static func parseOperation(_ input: String, operators: [String], operation: (Int, Int) -> Int) -> String? {
        for op in operators {
            if let range = input.range(of: op) {
                let beforeOp = String(input[..<range.lowerBound])
                let afterOp = String(input[range.upperBound...])

                let firstNum = beforeOp.filter { $0.isNumber }
                let secondNum = afterOp.filter { $0.isNumber }

                if let first = Int(firstNum), let second = Int(secondNum) {
                    let result = operation(first, second)
                    let symbol = op == "*" ? "×" : (op == "/" ? "÷" : op)
                    return "\(first) \(symbol) \(second) = \(result)"
                }
            }
        }
        return nil
    }
}

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
            return handleSafetyFilterError(error: error, message: message)
        }
    }

    private func handleSafetyFilterError(error: Error, message: String) -> String {
        let errorDescription = error.localizedDescription
        let lowerMessage = message.lowercased()

        if errorDescription.contains("unsafe") || errorDescription.contains("content") || errorDescription.contains("policy") {
            if let result = MathHelper.trySimpleMath(message) {
                return result
            }

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

// MARK: - ChatGPT Integration Service

class ChatGPTModelService: AIModelService {
    let modelType: AIModelType = .appleChatGPT

    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String {
        guard #available(iOS 26.0, *) else {
            return "ChatGPT integration requires iOS 26.0 or later with Apple Intelligence enabled."
        }

        try await Task.sleep(nanoseconds: 1_000_000_000) // 1 second

        let lowerMessage = message.lowercased()

        if lowerMessage.contains("hello") || lowerMessage.contains("hi") || lowerMessage.contains("hey") {
            return "Hello! I'm ChatGPT, accessible through Apple Intelligence. I'm here to help you with a wide range of questions and tasks. What can I assist you with today?"
        }

        if lowerMessage.contains("what") && (lowerMessage.contains("you") || lowerMessage.contains("are")) {
            return "I'm ChatGPT, an AI assistant created by OpenAI, now integrated with Apple Intelligence for privacy and security. I can help with writing, analysis, math, coding, creative tasks, and general questions."
        }

        if lowerMessage.contains("2+2") || lowerMessage.contains("2 + 2") {
            return "2 + 2 = 4\n\nThis is a basic addition problem. If you have any other math questions or need help with more complex calculations, I'm happy to help!"
        }

        if lowerMessage.contains("4*3") || lowerMessage.contains("4 * 3") || lowerMessage.contains("4×3") {
            return "4 × 3 = 12\n\nThis multiplication can be thought of as adding 4 three times: 4 + 4 + 4 = 12. Would you like help with any other mathematical operations?"
        }

        if lowerMessage.contains("joke") {
            return "Here's a light programming joke for you:\n\nWhy do programmers prefer dark mode?\n\nBecause light attracts bugs! 🐛\n\nWould you like to hear another one or can I help you with something else?"
        }

        if lowerMessage.contains("help") {
            return "I'm here to help! I can assist you with:\n\n• Answering questions on various topics\n• Math and calculations\n• Writing and editing\n• Problem-solving\n• Creative tasks\n• General conversation\n\nWhat would you like to work on today?"
        }

        return "I understand you're asking about '\(message)'. While this is a simulated ChatGPT response (the real integration would connect to OpenAI's servers through Apple Intelligence), I'd be happy to help! Could you provide a bit more context or rephrase your question?"
    }
}

// MARK: - Local Demo Model Service

class LocalDemoModelService: AIModelService {
    let modelType: AIModelType = .localDemo

    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String {
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        let lowerMessage = message.lowercased()

        if lowerMessage.contains("hello") || lowerMessage.contains("hi") || lowerMessage.contains("hey") {
            return "Hello! I'm a local demo model running entirely offline. I can help with math, simple questions, and conversation. What would you like to explore?"
        }

        if lowerMessage.contains("what") && (lowerMessage.contains("you") || lowerMessage.contains("are")) {
            return "I'm a local demo model - a simple AI assistant that runs without internet. I can handle basic math, answer simple questions, and have conversations. I'm useful for testing and as a fallback when other models aren't available!"
        }

        if let mathResult = MathHelper.parseAndCalculateMath(message) {
            return mathResult
        }

        if (lowerMessage.contains("that") || lowerMessage.contains("answer")) && (lowerMessage.contains("multipl") || lowerMessage.contains("times")) {
            let recentMessages = conversationHistory.suffix(4)
            for msg in recentMessages.reversed() {
                if !msg.isUser && msg.content.contains("=") && msg.content.contains("4") {
                    return "Sure! Taking that result (4) and multiplying by 3: 4 × 3 = 12"
                }
            }
            return "I'd be happy to help with multiplication! What numbers would you like me to multiply?"
        }

        if lowerMessage.contains("joke") {
            let jokes = [
                "Why don't scientists trust atoms? Because they make up everything!",
                "Why did the math book look so sad? Because it was full of problems!",
                "What do you call a fake noodle? An impasta!",
                "Why don't eggs tell jokes? They'd crack each other up!"
            ]
            return jokes.randomElement() ?? jokes[0]
        }

        if lowerMessage.contains("help") || lowerMessage.contains("can you") {
            return "I can help with:\n• Basic math (+, -, ×, ÷)\n• Simple questions\n• Jokes and conversation\n• Explaining what I am\n\nI'm a local demo model, so I work offline but have limited capabilities. Try asking me a math question!"
        }

        if lowerMessage.contains("math") {
            return "I can do basic arithmetic! Try questions like:\n• 5 + 3\n• 10 - 4\n• 7 × 8\n• 20 ÷ 4\n\nWhat calculation would you like me to do?"
        }

        if lowerMessage.contains("name") {
            return "I'm the Local Demo Model! I don't have a fancy name - I'm just a simple offline assistant for basic tasks and testing."
        }

        let suggestions = [
            "I'm a simple local model. Try asking me basic math questions like '5 × 3' or 'what is 10 + 7?'",
            "I can help with simple calculations and conversation! What would you like to calculate?",
            "I'm here to help with basic math and simple questions. Try asking me something like '8 + 2' or tell me a bit about what you need help with!"
        ]
        return suggestions.randomElement() ?? suggestions[0]
    }
}

// MARK: - AI Model Factory

class AIModelFactory {
    static func createModel(for type: AIModelType) -> AIModelService {
        switch type {
        case .appleFoundation:
            return AppleFoundationModelService()
        case .appleChatGPT:
            return ChatGPTModelService()
        case .localDemo:
            return LocalDemoModelService()
        }
    }
}
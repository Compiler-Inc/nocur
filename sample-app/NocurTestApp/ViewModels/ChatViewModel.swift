import Foundation
import SwiftUI

// MARK: - Chat ViewModel

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var currentInput: String = ""
    @Published var isProcessing: Bool = false
    @Published var selectedModel: AIModelType = .appleFoundation
    @Published var errorMessage: String?

    private var currentModelService: AIModelService

    init() {
        // Initialize model service with the default model type
        self.currentModelService = AIModelFactory.createModel(for: .appleFoundation)
        addWelcomeMessage()
    }

    private func addWelcomeMessage() {
        let welcomeMessage = ChatMessage(
            content: "Hi there! I'm your local chat assistant running entirely on your device. Your conversations are completely private. How can I help you today?",
            isUser: false,
            timestamp: Date()
        )
        messages.append(welcomeMessage)
    }

    func updateModel(_ newModel: AIModelType) {
        selectedModel = newModel
        currentModelService = AIModelFactory.createModel(for: newModel)
    }

    func sendMessage() {
        guard !currentInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let userMessage = ChatMessage(
            content: currentInput,
            isUser: true,
            timestamp: Date()
        )
        messages.append(userMessage)

        let messageToProcess = currentInput
        currentInput = ""

        processMessage(messageToProcess)
    }

    private func processMessage(_ message: String) {
        isProcessing = true
        errorMessage = nil

        Task {
            do {
                let response = try await currentModelService.generateResponse(
                    for: message,
                    conversationHistory: messages
                )
                let aiMessage = ChatMessage(
                    content: response,
                    isUser: false,
                    timestamp: Date()
                )
                messages.append(aiMessage)
            } catch {
                errorMessage = error.localizedDescription
                let errorResponse = ChatMessage(
                    content: "I apologize, but I encountered an error processing your request. Please try again.",
                    isUser: false,
                    timestamp: Date()
                )
                messages.append(errorResponse)
            }

            isProcessing = false
        }
    }

    func clearChat() {
        messages.removeAll()
        addWelcomeMessage()

        // Reset the model service if needed
        if let foundationService = currentModelService as? AppleFoundationModelService {
            foundationService.resetSession()
        }
    }
}
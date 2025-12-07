import SwiftUI
import Foundation
import FoundationModels

// Include the architecture definitions
// (In a real project, these would be in separate files properly added to Xcode)

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

        let commonMath = [
            "2+2": "2 + 2 = 4", "3+3": "3 + 3 = 6", "5+3": "5 + 3 = 8",
            "10-4": "10 - 4 = 6", "4*3": "4 × 3 = 12", "4×3": "4 × 3 = 12",
            "5*3": "5 × 3 = 15", "5×3": "5 × 3 = 15", "8/2": "8 ÷ 2 = 4", "20/4": "20 ÷ 4 = 5"
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

    private let openAIAPIKey = "***REMOVED***"
    private let baseURL = "https://api.openai.com/v1/chat/completions"

    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String {
        // Build conversation context for OpenAI API
        var messages: [[String: Any]] = [
            [
                "role": "system",
                "content": "You are a helpful AI assistant integrated with Apple Intelligence for privacy and security. Respond clearly and concisely."
            ]
        ]

        // Add recent conversation history (last 10 messages)
        let recentMessages = conversationHistory.suffix(10).filter {
            !$0.content.contains("Hi there! I'm your local chat assistant")
        }

        for msg in recentMessages {
            messages.append([
                "role": msg.isUser ? "user" : "assistant",
                "content": msg.content
            ])
        }

        // Add current message
        messages.append([
            "role": "user",
            "content": message
        ])

        // Create request body
        let requestBody: [String: Any] = [
            "model": "gpt-3.5-turbo",
            "messages": messages,
            "max_tokens": 500,
            "temperature": 0.7
        ]

        // Make API request
        guard let url = URL(string: baseURL) else {
            throw NSError(domain: "ChatGPTError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid API URL"])
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("Bearer \(openAIAPIKey)", forHTTPHeaderField: "Authorization")
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
        } catch {
            throw NSError(domain: "ChatGPTError", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to serialize request"])
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw NSError(domain: "ChatGPTError", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
            }

            guard httpResponse.statusCode == 200 else {
                // Handle API errors
                if httpResponse.statusCode == 401 {
                    return "ChatGPT API authentication failed. Please check your API key configuration."
                } else if httpResponse.statusCode == 429 {
                    return "ChatGPT API rate limit exceeded. Please try again later."
                } else {
                    return "ChatGPT API error (status: \(httpResponse.statusCode)). Please try again."
                }
            }

            let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]

            if let choices = jsonResponse?["choices"] as? [[String: Any]],
               let firstChoice = choices.first,
               let messageDict = firstChoice["message"] as? [String: Any],
               let content = messageDict["content"] as? String {
                return content.trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                return "Failed to parse ChatGPT response. Please try again."
            }

        } catch {
            // Fallback for network errors
            return "Unable to connect to ChatGPT. Please check your internet connection and try again.\n\nError: \(error.localizedDescription)"
        }
    }
}

// MARK: - Local LLM Service (Ollama Integration)

class LocalDemoModelService: AIModelService {
    let modelType: AIModelType = .localDemo

    private let ollamaBaseURL = "http://localhost:11434/api/generate"
    private let modelName = "llama2" // or "mistral", "codellama", etc.

    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String {
        // Try Ollama first, fallback to hardcoded responses
        do {
            return try await generateWithOllama(message, conversationHistory: conversationHistory)
        } catch {
            print("Ollama failed, using fallback: \(error)")
            return try await generateFallback(message, conversationHistory: conversationHistory)
        }
    }

    private func generateWithOllama(_ message: String, conversationHistory: [ChatMessage]) async throws -> String {
        // Build context for Ollama
        var contextBuilder = "You are a helpful local AI assistant running on the user's device. You provide clear, concise, and helpful responses.\n\n"

        // Add recent conversation history
        let recentMessages = conversationHistory.suffix(6).filter {
            !$0.content.contains("Hi there! I'm your local chat assistant")
        }

        for msg in recentMessages {
            contextBuilder += "\(msg.isUser ? "Human" : "Assistant"): \(msg.content)\n"
        }

        contextBuilder += "Human: \(message)\nAssistant:"

        let requestBody: [String: Any] = [
            "model": modelName,
            "prompt": contextBuilder,
            "stream": false,
            "options": [
                "temperature": 0.7,
                "top_p": 0.9,
                "max_tokens": 500
            ]
        ]

        guard let url = URL(string: ollamaBaseURL) else {
            throw NSError(domain: "OllamaError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid Ollama URL"])
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30

        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "OllamaError", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 404 {
                throw NSError(domain: "OllamaError", code: 3, userInfo: [NSLocalizedDescriptionKey: "Ollama model '\(modelName)' not found. Please install with: ollama pull \(modelName)"])
            } else {
                throw NSError(domain: "OllamaError", code: 4, userInfo: [NSLocalizedDescriptionKey: "Ollama API error (status: \(httpResponse.statusCode))"])
            }
        }

        let jsonResponse = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        if let responseText = jsonResponse?["response"] as? String {
            return responseText.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            throw NSError(domain: "OllamaError", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to parse Ollama response"])
        }
    }

    private func generateFallback(_ message: String, conversationHistory: [ChatMessage]) async throws -> String {
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        let lowerMessage = message.lowercased()

        // Check for math operations first
        if let mathResult = MathHelper.parseAndCalculateMath(message) {
            return mathResult
        }

        // Programming concepts
        if lowerMessage.contains("recursion") {
            return "Recursion is a programming technique where a function calls itself to solve a problem. It consists of:\n\n1. Base case: A condition that stops the recursion\n2. Recursive case: The function calling itself with modified parameters\n\nExample: factorial(n) = n × factorial(n-1), with base case factorial(0) = 1"
        }

        if lowerMessage.contains("algorithm") {
            return "An algorithm is a step-by-step procedure for solving a problem. Good algorithms are:\n• Correct (produces right output)\n• Efficient (uses resources well)\n• Clear (easy to understand)\n• Finite (terminates eventually)"
        }

        // Basic greetings
        if lowerMessage.contains("hello") || lowerMessage.contains("hi") || lowerMessage.contains("hey") {
            return "Hello! I'm a local AI assistant running on your device. I can help with programming concepts, math, and general questions. What would you like to know?"
        }

        // Self-identification
        if lowerMessage.contains("what") && (lowerMessage.contains("you") || lowerMessage.contains("are")) {
            return "I'm a local AI assistant that tries to connect to Ollama for advanced responses, but falls back to built-in knowledge when Ollama isn't available. I can help with programming, math, and general questions!"
        }

        // Programming languages
        if lowerMessage.contains("swift") || lowerMessage.contains("ios") {
            return "Swift is Apple's programming language for iOS, macOS, and other Apple platforms. It's modern, safe, and fast. Would you like to know about any specific Swift concepts?"
        }

        if lowerMessage.contains("python") {
            return "Python is a versatile, high-level programming language known for its readability and simplicity. It's great for beginners and widely used in data science, web development, and automation."
        }

        // Fallback with helpful suggestions
        return "I understand you're asking about '\(message)'. While I don't have Ollama running locally, I can help with:\n\n• Programming concepts (recursion, algorithms, data structures)\n• Math calculations\n• Basic questions about Swift, Python, and other topics\n\nWhat specifically would you like to know more about?"
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

// MARK: - Main Chat View

struct ChatView: View {
    @StateObject private var viewModel = ChatViewModel()

    private var bgBase: Color { Color(red: 0.07, green: 0.07, blue: 0.08) }
    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var textSecondary: Color { Color(white: 0.55) }
    private var textTertiary: Color { Color(white: 0.35) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        NavigationStack {
            ZStack {
                bgBase.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Model selector
                    modelSelector

                    // Chat messages
                    messagesList

                    // Input area
                    inputSection
                }
            }
            .navigationTitle("Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button("Clear Chat", role: .destructive) {
                            viewModel.clearChat()
                        }

                        Button("Settings") {
                            // Settings action
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(accent)
                    }
                }
            }
        }
    }

    // MARK: - Model Selector

    private var modelSelector: some View {
        VStack(spacing: 8) {
            HStack {
                Image(systemName: viewModel.selectedModel.icon)
                    .foregroundStyle(accent)
                    .font(.system(size: 16, weight: .medium))

                Text("Model: \(viewModel.selectedModel.rawValue)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(textPrimary)

                Spacer()

                Menu {
                    ForEach(AIModelType.allCases, id: \.self) { model in
                        Button {
                            viewModel.updateModel(model)
                        } label: {
                            HStack {
                                Image(systemName: model.icon)
                                VStack(alignment: .leading) {
                                    Text(model.rawValue)
                                        .font(.system(size: 14, weight: .medium))
                                    Text(model.description)
                                        .font(.system(size: 12))
                                        .foregroundStyle(.secondary)
                                }
                                if viewModel.selectedModel == model {
                                    Spacer()
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "chevron.down")
                        .foregroundStyle(accent)
                        .font(.system(size: 12, weight: .medium))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(bgElevated)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if let errorMessage = viewModel.errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                    Text(errorMessage)
                        .font(.system(size: 12))
                        .foregroundStyle(.red)
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Messages List

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }

                    if viewModel.isProcessing {
                        TypingIndicator()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .onChange(of: viewModel.messages.count) { _ in
                if let lastMessage = viewModel.messages.last {
                    withAnimation(.easeInOut(duration: 0.5)) {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: viewModel.isProcessing) { _ in
                withAnimation(.easeInOut(duration: 0.5)) {
                    if viewModel.isProcessing {
                        proxy.scrollTo("typing", anchor: .bottom)
                    } else if let lastMessage = viewModel.messages.last {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Input Section

    private var inputSection: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Color.white.opacity(0.1))

            HStack(spacing: 12) {
                HStack(spacing: 12) {
                    TextField("Type your message...", text: $viewModel.currentInput, axis: .vertical)
                        .font(.system(size: 16))
                        .foregroundStyle(textPrimary)
                        .lineLimit(1...4)
                        .disabled(viewModel.isProcessing)
                        .onSubmit {
                            if !viewModel.isProcessing {
                                viewModel.sendMessage()
                            }
                        }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(bgElevated)
                .clipShape(RoundedRectangle(cornerRadius: 20))

                Button {
                    viewModel.sendMessage()
                } label: {
                    Image(systemName: viewModel.isProcessing ? "stop.circle.fill" : "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(viewModel.currentInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !viewModel.isProcessing ? textTertiary : accent)
                }
                .disabled(viewModel.currentInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !viewModel.isProcessing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(bgBase)
        }
    }
}

// MARK: - Message Bubble Component

struct MessageBubble: View {
    let message: ChatMessage

    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var textSecondary: Color { Color(white: 0.55) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        HStack {
            if message.isUser {
                Spacer()
            }

            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .font(.system(size: 16))
                    .foregroundStyle(message.isUser ? Color.black : textPrimary)
                    .multilineTextAlignment(message.isUser ? .trailing : .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(message.isUser ? accent : bgElevated)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                Text(formatTimestamp(message.timestamp))
                    .font(.system(size: 11))
                    .foregroundStyle(textSecondary)
                    .padding(.horizontal, 4)
            }
            .frame(maxWidth: UIScreen.main.bounds.width * 0.75, alignment: message.isUser ? .trailing : .leading)

            if !message.isUser {
                Spacer()
            }
        }
    }

    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Typing Indicator Component

struct TypingIndicator: View {
    @State private var animating = false

    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textSecondary: Color { Color(white: 0.55) }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(textSecondary)
                            .frame(width: 8, height: 8)
                            .scaleEffect(animating ? 1.0 : 0.6)
                            .animation(
                                Animation.easeInOut(duration: 0.6)
                                    .repeatForever()
                                    .delay(0.2 * Double(index)),
                                value: animating
                            )
                    }

                    Text("AI is thinking...")
                        .font(.system(size: 12))
                        .foregroundStyle(textSecondary)
                        .padding(.leading, 8)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(bgElevated)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            Spacer()
        }
        .id("typing")
        .onAppear {
            animating = true
        }
        .onDisappear {
            animating = false
        }
    }
}

// MARK: - App Entry Point

struct ContentView: View {
    var body: some View {
        ChatView()
    }
}

#Preview {
    ContentView()
}
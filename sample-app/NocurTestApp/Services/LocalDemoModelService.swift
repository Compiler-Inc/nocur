import Foundation

// MARK: - Local Demo Model Service

class LocalDemoModelService: AIModelService {
    let modelType: AIModelType = .localDemo

    func generateResponse(for message: String, conversationHistory: [ChatMessage]) async throws -> String {
        // Simulate processing delay
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        let lowerMessage = message.lowercased()

        // Greetings
        if lowerMessage.contains("hello") || lowerMessage.contains("hi") || lowerMessage.contains("hey") {
            return "Hello! I'm a local demo model running entirely offline. I can help with math, simple questions, and conversation. What would you like to explore?"
        }

        // Self-identification
        if lowerMessage.contains("what") && (lowerMessage.contains("you") || lowerMessage.contains("are")) {
            return "I'm a local demo model - a simple AI assistant that runs without internet. I can handle basic math, answer simple questions, and have conversations. I'm useful for testing and as a fallback when other models aren't available!"
        }

        // Math operations
        if let mathResult = MathHelper.parseAndCalculateMath(message) {
            return mathResult
        }

        // Follow-up questions with context
        if (lowerMessage.contains("that") || lowerMessage.contains("answer")) && (lowerMessage.contains("multipl") || lowerMessage.contains("times")) {
            let recentMessages = conversationHistory.suffix(4)
            for msg in recentMessages.reversed() {
                if !msg.isUser && msg.content.contains("=") && msg.content.contains("4") {
                    return "Sure! Taking that result (4) and multiplying by 3: 4 × 3 = 12"
                }
            }
            return "I'd be happy to help with multiplication! What numbers would you like me to multiply?"
        }

        // Random jokes
        if lowerMessage.contains("joke") {
            let jokes = [
                "Why don't scientists trust atoms? Because they make up everything!",
                "Why did the math book look so sad? Because it was full of problems!",
                "What do you call a fake noodle? An impasta!",
                "Why don't eggs tell jokes? They'd crack each other up!"
            ]
            return jokes.randomElement() ?? jokes[0]
        }

        // Help and capabilities
        if lowerMessage.contains("help") || lowerMessage.contains("can you") {
            return "I can help with:\n• Basic math (+, -, ×, ÷)\n• Simple questions\n• Jokes and conversation\n• Explaining what I am\n\nI'm a local demo model, so I work offline but have limited capabilities. Try asking me a math question!"
        }

        // Math capability query
        if lowerMessage.contains("math") {
            return "I can do basic arithmetic! Try questions like:\n• 5 + 3\n• 10 - 4\n• 7 × 8\n• 20 ÷ 4\n\nWhat calculation would you like me to do?"
        }

        // Name questions
        if lowerMessage.contains("name") {
            return "I'm the Local Demo Model! I don't have a fancy name - I'm just a simple offline assistant for basic tasks and testing."
        }

        // Fallback responses
        let suggestions = [
            "I'm a simple local model. Try asking me basic math questions like '5 × 3' or 'what is 10 + 7?'",
            "I can help with simple calculations and conversation! What would you like to calculate?",
            "I'm here to help with basic math and simple questions. Try asking me something like '8 + 2' or tell me a bit about what you need help with!"
        ]
        return suggestions.randomElement() ?? suggestions[0]
    }
}
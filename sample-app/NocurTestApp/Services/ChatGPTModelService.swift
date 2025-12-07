import Foundation

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
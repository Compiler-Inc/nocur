import Foundation

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
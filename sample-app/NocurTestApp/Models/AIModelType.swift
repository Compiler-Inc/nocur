import Foundation

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
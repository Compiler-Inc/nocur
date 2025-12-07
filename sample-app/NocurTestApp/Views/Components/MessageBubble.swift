import SwiftUI

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
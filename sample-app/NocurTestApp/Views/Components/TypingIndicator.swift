import SwiftUI

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
import SwiftUI

// MARK: - Chat Input Section Component

struct ChatInputSection: View {
    @ObservedObject var viewModel: ChatViewModel

    private var bgBase: Color { Color(red: 0.07, green: 0.07, blue: 0.08) }
    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var textTertiary: Color { Color(white: 0.35) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
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
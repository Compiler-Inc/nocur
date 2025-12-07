import SwiftUI

// MARK: - Model Selector Component

struct ModelSelector: View {
    @ObservedObject var viewModel: ChatViewModel

    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }
    private var textPrimary: Color { Color(white: 0.95) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
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
}
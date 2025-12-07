import SwiftUI

// MARK: - Settings View

struct SettingsView: View {
    @State private var enableLogging = false
    @State private var maxChatHistory = 100.0
    @State private var selectedResponseLength = 0

    let responseLengthOptions = ["Concise", "Balanced", "Detailed"]

    private var bgBase: Color { Color(red: 0.07, green: 0.07, blue: 0.08) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        NavigationStack {
            ZStack {
                bgBase.ignoresSafeArea()

                Form {
                    Section("AI Models") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Available Models")
                                .font(.headline)

                            ForEach(AIModelType.allCases, id: \.self) { model in
                                HStack {
                                    Image(systemName: model.icon)
                                        .foregroundStyle(accent)
                                        .frame(width: 20)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(model.rawValue)
                                            .font(.system(size: 16, weight: .medium))
                                        Text(model.description)
                                            .font(.system(size: 14))
                                            .foregroundStyle(.secondary)
                                    }

                                    Spacer()
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    }

                    Section("Privacy") {
                        Toggle("Enable Chat Logging", isOn: $enableLogging)
                            .accessibilityIdentifier("loggingToggle")

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Max Chat History: \(Int(maxChatHistory)) messages")
                                .font(.system(size: 16))

                            Slider(value: $maxChatHistory, in: 10...500, step: 10)
                                .tint(accent)
                        }
                    }

                    Section("Response Settings") {
                        Picker("Response Length", selection: $selectedResponseLength) {
                            ForEach(0..<responseLengthOptions.count, id: \.self) { index in
                                Text(responseLengthOptions[index]).tag(index)
                            }
                        }
                        .accessibilityIdentifier("responseLengthPicker")
                    }

                    Section("About") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Local AI Chat")
                                .font(.headline)
                            Text("All conversations are processed locally on your device to ensure privacy. No data is sent to external servers.")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
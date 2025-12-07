import SwiftUI

// MARK: - Main Chat View

struct ChatView: View {
    @StateObject private var viewModel = ChatViewModel()

    private var bgBase: Color { Color(red: 0.07, green: 0.07, blue: 0.08) }
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }

    var body: some View {
        NavigationStack {
            ZStack {
                bgBase.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Model selector
                    ModelSelector(viewModel: viewModel)

                    // Chat messages
                    messagesList

                    // Input area
                    ChatInputSection(viewModel: viewModel)
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

                        NavigationLink(destination: SettingsView()) {
                            Label("Settings", systemImage: "gear")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(accent)
                    }
                }
            }
        }
    }

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
}
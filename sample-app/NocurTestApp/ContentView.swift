import SwiftUI

// MARK: - Counter ViewModel

class CounterViewModel: ObservableObject {
    @Published var count = 0  // Tracks the current counter value

    func increment() {
        count += 1
    }

    func decrement() {
        count -= 1
    }
}

struct ContentView: View {
    @State private var username = ""
    @State private var password = ""
    @State private var isLoggedIn = false
    @State private var showAlert = false
    @StateObject private var counterVM = CounterViewModel()

    var body: some View {
        NavigationStack {
            if isLoggedIn {
                loggedInView
            } else {
                loginView
            }
        }
    }

    // MARK: - Color Palette
    // Design system: Warm neutrals with amber accent
    // Based on a sophisticated, editorial aesthetic

    // Backgrounds - warm charcoal family
    private var bgBase: Color { Color(red: 0.07, green: 0.07, blue: 0.08) }      // Near black with warmth
    private var bgElevated: Color { Color(red: 0.11, green: 0.11, blue: 0.12) }  // Cards, inputs
    private var bgSubtle: Color { Color(red: 0.14, green: 0.14, blue: 0.15) }    // Hover states

    // Text - proper hierarchy
    private var textPrimary: Color { Color(white: 0.95) }                         // Headlines
    private var textSecondary: Color { Color(white: 0.55) }                       // Body text
    private var textTertiary: Color { Color(white: 0.35) }                        // Placeholders

    // Accent - warm amber (sophisticated, not garish)
    private var accent: Color { Color(red: 0.92, green: 0.75, blue: 0.45) }       // Primary accent
    private var accentMuted: Color { Color(red: 0.72, green: 0.58, blue: 0.35) }  // Muted accent

    // MARK: - Login View

    var loginView: some View {
        ZStack {
            // Clean dark background
            bgBase.ignoresSafeArea()

            // Subtle ambient glow - very understated
            Circle()
                .fill(accent.opacity(0.04))
                .frame(width: 500, height: 500)
                .blur(radius: 150)
                .offset(x: 0, y: -200)

            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 100)

                // Logo area - refined typography
                VStack(spacing: 24) {
                    // Simple icon - no ring, cleaner
                    ZStack {
                        Circle()
                            .fill(bgElevated)
                            .frame(width: 72, height: 72)

                        Image(systemName: "eye")
                            .font(.system(size: 28, weight: .light))
                            .foregroundStyle(accent)
                    }

                    VStack(spacing: 6) {
                        Text("nocur")
                            .font(.system(size: 32, weight: .light, design: .default))
                            .tracking(6)
                            .foregroundStyle(textPrimary)
                            .accessibilityIdentifier("titleLabel")

                        Text("Give your agent eyes")
                            .font(.system(size: 13, weight: .regular))
                            .foregroundStyle(textTertiary)
                            .accessibilityIdentifier("subtitleLabel")
                    }
                }

                Spacer()

                // Login form - cleaner spacing
                VStack(spacing: 16) {
                    // Username field
                    HStack(spacing: 14) {
                        Image(systemName: "person")
                            .font(.system(size: 16, weight: .regular))
                            .foregroundStyle(textTertiary)
                            .frame(width: 20)

                        ZStack(alignment: .leading) {
                            if username.isEmpty {
                                Text("Username")
                                    .font(.system(size: 16, weight: .regular))
                                    .foregroundStyle(textTertiary)
                            }
                            TextField("", text: $username)
                                .font(.system(size: 16, weight: .regular))
                                .textContentType(.username)
                                .autocapitalization(.none)
                                .foregroundStyle(textPrimary)
                                .tint(accent)
                                .accessibilityIdentifier("usernameTextField")
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(bgElevated)
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
                            )
                    )

                    // Password field
                    HStack(spacing: 14) {
                        Image(systemName: "lock")
                            .font(.system(size: 16, weight: .regular))
                            .foregroundStyle(textTertiary)
                            .frame(width: 20)

                        ZStack(alignment: .leading) {
                            if password.isEmpty {
                                Text("Password")
                                    .font(.system(size: 16, weight: .regular))
                                    .foregroundStyle(textTertiary)
                            }
                            SecureField("", text: $password)
                                .font(.system(size: 16, weight: .regular))
                                .textContentType(.password)
                                .foregroundStyle(textPrimary)
                                .tint(accent)
                                .accessibilityIdentifier("passwordTextField")
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(bgElevated)
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
                            )
                    )

                    // Login button - solid color, no gradient
                    Button(action: login) {
                        Text("Sign in")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(bgBase)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(accent)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("loginButton")
                    .padding(.top, 8)
                }
                .padding(.horizontal, 32)

                Spacer()

                // Footer - more subtle
                Text("nocur-swift")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(textTertiary.opacity(0.6))
                    .padding(.bottom, 32)
            }
            .padding(.horizontal, 24)
        }
        .alert("Login Failed", isPresented: $showAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Please enter both username and password")
        }
    }

    // MARK: - Logged In View

    var loggedInView: some View {
        VStack(spacing: 24) {
            Text("Welcome, \(username)!")
                .font(.title)
                .accessibilityIdentifier("welcomeLabel")

            Text("Counter: \(counterVM.count)")
                .font(.title2)
                .monospacedDigit()
                .accessibilityIdentifier("counterLabel")

            HStack(spacing: 20) {
                Button(action: { counterVM.decrement() }) {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 44))
                }
                .accessibilityIdentifier("decrementButton")

                Button(action: { counterVM.increment() }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 44))
                }
                .accessibilityIdentifier("incrementButton")
            }

            Spacer()

            NavigationLink(destination: SettingsView()) {
                Label("Settings", systemImage: "gear")
            }
            .accessibilityIdentifier("settingsLink")

            Button("Log Out", role: .destructive) {
                isLoggedIn = false
                username = ""
                password = ""
                counterVM.count = 0
            }
            .accessibilityIdentifier("logoutButton")
        }
        .padding()
        .navigationTitle("Home")
    }

    // MARK: - Actions

    func login() {
        guard !username.isEmpty && !password.isEmpty else {
            showAlert = true
            return
        }
        isLoggedIn = true
    }
}

// MARK: - Settings View

struct SettingsView: View {
    @State private var notificationsEnabled = true
    @State private var darkModeEnabled = false
    @State private var selectedOption = 0

    let options = ["Option A", "Option B", "Option C"]

    var body: some View {
        Form {
            Section("Preferences") {
                Toggle("Enable Notifications", isOn: $notificationsEnabled)
                    .accessibilityIdentifier("notificationsToggle")

                Toggle("Dark Mode", isOn: $darkModeEnabled)
                    .accessibilityIdentifier("darkModeToggle")
            }

            Section("Selection") {
                Picker("Choose Option", selection: $selectedOption) {
                    ForEach(0..<options.count, id: \.self) { index in
                        Text(options[index]).tag(index)
                    }
                }
                .accessibilityIdentifier("optionPicker")
            }

            Section("Items") {
                ForEach(1...5, id: \.self) { index in
                    HStack {
                        Text("Item \(index)")
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier("listItem\(index)")
                }
            }
        }
        .navigationTitle("Settings")
    }
}

#Preview {
    ContentView()
}

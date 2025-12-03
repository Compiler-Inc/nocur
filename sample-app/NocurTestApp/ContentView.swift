import SwiftUI

struct ContentView: View {
    @State private var username = ""
    @State private var password = ""
    @State private var isLoggedIn = false
    @State private var showAlert = false
    @State private var counter = 0

    var body: some View {
        NavigationStack {
            if isLoggedIn {
                loggedInView
            } else {
                loginView
            }
        }
    }

    // MARK: - Login View

    var loginView: some View {
        VStack(spacing: 24) {
            Text("Nocur Test App")
                .font(.largeTitle)
                .fontWeight(.bold)
                .accessibilityIdentifier("titleLabel")

            Text("A sample app for testing nocur-swift")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("subtitleLabel")

            VStack(spacing: 16) {
                TextField("Username", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.username)
                    .autocapitalization(.none)
                    .accessibilityIdentifier("usernameTextField")

                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.password)
                    .accessibilityIdentifier("passwordTextField")

                Button(action: login) {
                    Text("Log In")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("loginButton")
            }
            .padding(.horizontal)

            Spacer()
        }
        .padding(.top, 60)
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

            Text("Counter: \(counter)")
                .font(.title2)
                .monospacedDigit()
                .accessibilityIdentifier("counterLabel")

            HStack(spacing: 20) {
                Button(action: { counter -= 1 }) {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 44))
                }
                .accessibilityIdentifier("decrementButton")

                Button(action: { counter += 1 }) {
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
                counter = 0
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

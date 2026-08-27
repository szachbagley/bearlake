//
//  LoginView.swift
//  bearlake-client
//

import SwiftUI

/// Email and password, and nothing else.
///
/// There is deliberately **no** "create account" and **no** "forgot
/// password": neither has a self-service path. Accounts are issued by a
/// family admin, and a password reset is an admin action. A link that leads
/// nowhere is worse than a sentence explaining who to ask.
struct LoginView: View {
    let auth: AuthViewModel

    @State private var email = ""
    @State private var password = ""
    @FocusState private var focused: Field?

    private enum Field { case email, password }

    private var canSubmit: Bool {
        email.isEmpty == false && password.isEmpty == false && auth.isWorking == false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focused = .password }

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focused, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { submit() }
                } header: {
                    Text("Sign in")
                } footer: {
                    if let message = auth.loginError {
                        Text(message)
                            .foregroundStyle(.red)
                            .accessibilityAddTraits(.isStaticText)
                    }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            Spacer()
                            if auth.isWorking {
                                ProgressView()
                            } else {
                                Text("Sign In").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(canSubmit == false)
                }

                Section {
                    Text("Accounts are set up by a family admin. "
                         + "If you need an account or a new password, ask Zach or Rachel.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Bear Lake")
            .disabled(auth.isWorking)
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focused = nil
        Task { await auth.login(email: email, password: password) }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview {
    LoginView(auth: .preview())
}
#endif

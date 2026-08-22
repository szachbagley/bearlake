//
//  ChangePasswordView.swift
//  bearlake-client
//

import SwiftUI

/// One view, two flows.
///
/// **Forced** (`mode == .forced`) is presented when `mustChangePassword` is
/// set. It has no Cancel, no tab bar, and no navigation away — the server
/// refuses every other route in that state, so an escape hatch would only
/// lead to a screen full of 403s.
///
/// **Voluntary** (`mode == .voluntary`) is reached from the settings sheet
/// and can be dismissed.
struct ChangePasswordView: View {
    enum Mode {
        case forced
        case voluntary
    }

    let auth: AuthViewModel
    let mode: Mode
    /// Called after a successful voluntary change so the sheet can close.
    var onFinished: () -> Void = {}

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmation = ""
    @FocusState private var focused: Field?

    private enum Field { case current, new, confirm }

    private var canSubmit: Bool {
        currentPassword.isEmpty == false
            && newPassword.isEmpty == false
            && confirmation.isEmpty == false
            && auth.isWorking == false
    }

    var body: some View {
        NavigationStack {
            Form {
                if mode == .forced {
                    Section {
                        Text("Your account was set up with a temporary password. "
                             + "Choose a new one to continue.")
                            .font(.callout)
                    }
                }

                Section {
                    SecureField("Current password", text: $currentPassword)
                        .textContentType(.password)
                        .focused($focused, equals: .current)
                        .submitLabel(.next)
                        .onSubmit { focused = .new }

                    SecureField("New password", text: $newPassword)
                        .textContentType(.newPassword)
                        .focused($focused, equals: .new)
                        .submitLabel(.next)
                        .onSubmit { focused = .confirm }

                    SecureField("Confirm new password", text: $confirmation)
                        .textContentType(.newPassword)
                        .focused($focused, equals: .confirm)
                        .submitLabel(.go)
                        .onSubmit { submit() }
                } footer: {
                    if let message = auth.changePasswordError {
                        Text(message).foregroundStyle(.red)
                    } else {
                        Text("At least \(Limits.passwordMin) characters.")
                    }
                }

                Section {
                    Button(action: submit) {
                        HStack {
                            Spacer()
                            if auth.isWorking {
                                ProgressView()
                            } else {
                                Text("Change Password").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(canSubmit == false)
                }
            }
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if mode == .voluntary {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: onFinished)
                    }
                }
            }
            // The forced flow must not be swipe-dismissable either.
            .interactiveDismissDisabled(mode == .forced)
            .disabled(auth.isWorking)
        }
    }

    private func submit() {
        guard canSubmit else { return }
        focused = nil
        Task {
            let changed = await auth.changePassword(
                current: currentPassword, new: newPassword, confirmation: confirmation
            )
            if changed {
                // Clear the fields before anything else can see them. In the
                // forced flow the state change unmounts this view; in the
                // voluntary flow the sheet closes.
                currentPassword = ""
                newPassword = ""
                confirmation = ""
                if mode == .voluntary { onFinished() }
            }
        }
    }
}

#Preview("Forced") {
    ChangePasswordView(auth: .preview(), mode: .forced)
}

#Preview("Voluntary") {
    ChangePasswordView(auth: .preview(), mode: .voluntary)
}

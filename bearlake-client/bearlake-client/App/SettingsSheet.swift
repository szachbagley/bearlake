//
//  SettingsSheet.swift
//  bearlake-client
//

import SwiftUI

/// The ☰ menu (C47): change password, sign out.
///
/// This is where the storyboard's voluntary change-password entry point
/// lives. Deliberately thin — user management is the web app's job,
/// permanently (C49), so there is nothing else to put here.
struct SettingsSheet: View {
    let auth: AuthViewModel
    var onClose: () -> Void = {}

    @State private var isChangingPassword = false
    @State private var isConfirmingSignOut = false

    var body: some View {
        NavigationStack {
            List {
                if let user = auth.currentUser {
                    Section("Signed in as") {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.displayName).font(.body)
                            Text(user.email)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }

                Section {
                    Button("Change Password") { isChangingPassword = true }
                }

                Section {
                    Button("Sign Out", role: .destructive) { isConfirmingSignOut = true }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onClose)
                }
            }
            .sheet(isPresented: $isChangingPassword) {
                ChangePasswordView(auth: auth, mode: .voluntary) {
                    isChangingPassword = false
                }
            }
            // Signing out is not destructive in the data sense, but it is
            // easy to hit by accident and annoying to recover from on a
            // phone — the user has to find their password again.
            .confirmationDialog(
                "Sign out of Bear Lake?",
                isPresented: $isConfirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign Out", role: .destructive) {
                    Task {
                        await auth.logout()
                        onClose()
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}

#Preview {
    SettingsSheet(auth: .preview())
}

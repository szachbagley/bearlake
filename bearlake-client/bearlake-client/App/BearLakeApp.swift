//
//  BearLakeApp.swift
//  bearlake-client
//

import SwiftUI

@main
struct BearLakeApp: App {
    @State private var composition = AppComposition()

    var body: some Scene {
        WindowGroup {
            RootView(auth: composition.auth)
                .task { await composition.auth.restore() }
        }
    }
}

/// Builds the object graph and closes the loop between the client and the
/// session.
///
/// `APIClient` needs to tell `AuthViewModel` about expiry and the
/// password-change gate, but `AuthViewModel` needs the client to make calls —
/// a cycle. It is broken by constructing the ViewModel first and handing the
/// client closures that reach back to it, rather than by giving either a
/// mutable reference to the other.
@MainActor
@Observable
final class AppComposition {
    let auth: AuthViewModel

    init() {
        let tokens = TokenStore()
        // A box, so the closures below can reach a ViewModel that does not
        // exist yet at the moment the client is built.
        let holder = AuthHolder()

        let client = APIClient(
            baseURL: AppConfig.apiBaseURL ?? URL(fileURLWithPath: "/"),
            tokens: tokens,
            onSessionExpired: { [holder] in
                await holder.value?.sessionExpired()
            },
            onPasswordChangeRequired: { [holder] in
                await holder.value?.requirePasswordChange()
            }
        )

        let auth = AuthViewModel(api: client, tokens: tokens)
        self.auth = auth
        holder.value = auth
    }
}

/// Holds the ViewModel for the client's callbacks. `@MainActor` because the
/// thing it holds is, and `@unchecked Sendable` because the only access is
/// through that isolation.
@MainActor
private final class AuthHolder: @unchecked Sendable {
    var value: AuthViewModel?
}

/// The one place that decides what the user sees, switching on
/// `SessionState` and nothing else.
struct RootView: View {
    let auth: AuthViewModel

    var body: some View {
        switch auth.state {
        case .restoring:
            SplashView()
        case .signedOut:
            LoginView(auth: auth)
        case .mustChangePassword:
            // No tab bar, no dismissal: the server refuses every other route
            // in this state.
            ChangePasswordView(auth: auth, mode: .forced)
        case .signedIn:
            RootTabView(auth: auth)
        }
    }
}

/// Shown while a stored refresh token is being redeemed, so the app does not
/// flash the login screen at a user who is already signed in.
struct SplashView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "house.and.flag")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text("Bear Lake").font(.title)
            ProgressView()
                .accessibilityLabel("Signing in")
        }
        .padding()
    }
}

#Preview("Splash") {
    SplashView()
}

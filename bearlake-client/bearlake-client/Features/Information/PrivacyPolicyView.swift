//
//  PrivacyPolicyView.swift
//  bearlake-client
//
//  C56. The privacy policy, readable inside the app.
//
//  Bundled rather than linked out: the App Store requires a hosted policy URL
//  regardless, but a link is useless at the cabin with no signal, and this is
//  the one screen a family member is most likely to open precisely when they
//  are wondering what the app does with their photos. Everything else in the
//  app works offline; this should too.
//
//  **This text and `docs/privacy-policy.md` are the same policy.** Change one
//  and you must change the other — `PrivacyPolicyDriftTests` fails until the
//  `Last updated` dates match, which is the tripwire that makes the rule
//  enforceable rather than aspirational.
//

import SwiftUI

struct PrivacyPolicyView: View {
    /// Bumped whenever the policy text changes, in both copies.
    static let lastUpdated = "2026-08-28"

    var body: some View {
        ScrollView {
            // Lazy for the same reason as the article renderer: build what is
            // on screen, not the whole document.
            LazyVStack(alignment: .leading, spacing: 16) {
                Text("Last updated \(Self.lastUpdated)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                paragraph(
                    "Bear Lake is a private app for one extended family, used to "
                    + "coordinate a shared vacation property. Accounts are issued by a "
                    + "family administrator; there is no sign-up."
                )

                heading("What the app collects")
                paragraph("Only what you or an administrator put into it:")
                bullets([
                    "Your email address, which is your login identifier and nothing else.",
                    "Your display name, so others can see who created an event.",
                    "Your password, stored only as a salted hash. Nobody — including "
                        + "the administrators — can read it back.",
                    "Content you create: events, announcements, quick tips, articles, "
                        + "and photos attached to articles.",
                ])
                paragraph(
                    "It does not collect your location, contacts, health data, "
                    + "financial data, advertising identifiers, or usage analytics."
                )

                heading("What the app does not do")
                bullets([
                    "No tracking. No analytics, no advertising, no fingerprinting.",
                    "No third-party SDKs at all. The app has zero external dependencies.",
                    "Nothing is sold or shared with anyone for advertising or marketing.",
                    "No profiles are built about you or how you use the app.",
                ])

                heading("Where the data goes")
                paragraph(
                    "Content is stored on a private server run by the family "
                    + "administrators, and photos in a private storage bucket. Photos are "
                    + "never publicly readable: the app fetches them through short-lived "
                    + "signed links that expire, and stores only the storage key."
                )
                paragraph(
                    "Your device contacts two outside services in normal use: the "
                    + "family's own server, for everything you see; and YouTube, only "
                    + "when you open an article containing a video. Videos load through "
                    + "youtube-nocookie.com, YouTube's reduced-tracking domain. YouTube "
                    + "is a Google service and its own privacy policy applies to playback."
                )

                heading("What is stored on your phone")
                bullets([
                    "Your sign-in token, in the iOS Keychain.",
                    "A copy of content you have already viewed, so the app works at the "
                        + "cabin without a signal. This copy is erased when you sign out.",
                ])
                paragraph(
                    "Both are protected by iOS encryption when your phone has a "
                    + "passcode. If your phone has no passcode, iOS does not encrypt app "
                    + "data at rest — please set one."
                )

                heading("Your choices")
                bullets([
                    "To see or correct your data, ask a family administrator.",
                    "To delete it, ask an administrator. Accounts are deactivated rather "
                        + "than deleted so authorship of past content stays accurate; "
                        + "content you created can be deleted on request.",
                    "To stop using the app, sign out — which erases the local copy — and "
                        + "delete the app.",
                ])
                paragraph(
                    "There is no in-app account creation, and therefore no in-app "
                    + "account deletion. Accounts exist only because an administrator "
                    + "created one for you."
                )

                heading("Children")
                paragraph(
                    "The app is used by one family and may be used by children with "
                    + "their parents' supervision. It collects nothing beyond the above, "
                    + "shows no advertising, and contains no third-party content other "
                    + "than family-posted YouTube links."
                )

                heading("Contact")
                paragraph(
                    "Questions, or requests about your data, go to the family "
                    + "administrators at szachbagley@gmail.com."
                )
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Privacy Policy")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(.headline)
            .padding(.top, 4)
            // So VoiceOver's heading rotor can jump between sections rather
            // than making someone swipe through every paragraph.
            .accessibilityAddTraits(.isHeader)
    }

    private func paragraph(_ text: String) -> some View {
        Text(text)
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func bullets(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•").foregroundStyle(.secondary)
                    Text(item).fixedSize(horizontal: false, vertical: true)
                }
                // Collapsed to one element, labelled with the text alone —
                // same reasoning as BlockView.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(item)
            }
        }
    }
}

#if DEBUG
#Preview {
    NavigationStack {
        PrivacyPolicyView()
    }
}
#endif

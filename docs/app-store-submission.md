# App Store submission — prepared answers

Everything here is derived from the codebase, so the forms can be filled in without
re-deriving anything. Distribution decision is C55 in `bearlake-client/client-dev-plan.md`;
the requirements narrative is §9 of that file.

**Order matters:** submit and get approved *normally* first, **then** request unlisted
distribution. Unlisted is something Apple grants on request after approval, not a
setting you flip beforehand.

---

## 1. App information

| Field | Value |
|---|---|
| Name | Bear Lake |
| Bundle ID | `hansen.bearlake-client` |
| Version | 1.0 |
| Build | 1 |
| Signing | Automatic, team `JK7P9CS69J` |
| Minimum iOS | 17.0 |
| Category | Primary: **Lifestyle**. Secondary: Productivity |
| Price | Free |
| Age rating | 4+ — no objectionable content, no ads, no user-generated content visible to strangers |
| Export compliance | Uses encryption **only** via standard HTTPS/TLS provided by the OS → qualifies for the exemption. Answer "Yes" to using encryption, then "Yes" to the standard-exemption question |

## 2. Privacy nutrition labels

The app has **zero third-party SDKs**, which makes this unusually short.

**Data collected and linked to the user's identity:**

| Type | Purpose | Used for tracking? |
|---|---|---|
| Email address | App Functionality (it is the login identifier) | **No** |
| Name | App Functionality (attribution on events) | **No** |
| Photos | App Functionality (article illustrations) | **No** |
| Other User Content | App Functionality (events, announcements, tips, articles) | **No** |

**Not collected:** location, contacts, health, fitness, financial info, browsing
history, search history, identifiers, purchases, diagnostics, usage data,
advertising data.

**Tracking:** answer **No** to "Does this app track users?" Nothing is shared with
data brokers or advertisers, and there is no advertising identifier.

## 3. App Review notes — copy this in

> Bear Lake is a private app for one extended family, used to coordinate a shared
> vacation cabin. It is intended for unlisted distribution and has no general
> audience by design.
>
> **There is no sign-up, by design.** Accounts are issued by a family administrator;
> the app deliberately has no self-registration, no "forgot password" flow, and no
> third-party login. A demo account is provided below.
>
> **Demo account**
> Email: `<demo member email>`
> Password: `<demo password>`
>
> This is a member (non-administrator) account with sample content. It is not
> required to change its password on first sign-in.
>
> **Guideline 4.2 (Minimum Functionality):** we understand a private family app has
> no broad audience. That is precisely why we are requesting unlisted distribution,
> so the app is available only to family members who have the link and is not
> discoverable in search.
>
> **Guideline 4.8 (Sign in with Apple):** not applicable — the app offers no
> third-party or social login of any kind, only family-issued credentials.
>
> **Guideline 5.1.1(v) (Account Deletion):** not applicable — the app does not
> support account *creation*. Accounts can only be created by an administrator
> outside the app. Deactivation is handled by administrators on request; this is
> documented in the privacy policy.
>
> **Network use:** the app talks only to our own API. YouTube (via
> youtube-nocookie.com) is contacted only when a family member opens a knowledge-base
> article containing an embedded video.

## 4. Demo account — create before submitting

In the **web app**, create a user for App Review:

- Role: **member**, not admin — a reviewer must not be able to reach destructive
  admin controls on the family's real data.
- Sign in once yourself and complete the forced password change, so
  `mustChangePassword` is false. **A reviewer who hits the forced-change gate and
  cannot get past it will reject the app.**
- Make sure at least one announcement, one event, one quick tip, and one published
  article are visible to it, so the reviewer sees a working app rather than empty
  screens.

## 5. Still needed — not in the repo

- [x] **App icon** — done. `blicon.png`, 1024×1024, no alpha. Meets the spec and
      stays legible when rendered at true home-screen size (180 px), which thin-line
      artwork often does not.

      One thing to look at before submitting, not a rejection risk: iOS masks icons
      to a rounded square, so the **bottom-right end of the diagonal will be clipped**
      — the artwork runs to the canvas edge there. If that bothers you, inset the
      artwork by roughly 10% and re-export. The dark and tinted appearance slots in
      `Contents.json` are empty, which is fine — iOS derives them.
- [ ] **Privacy policy URL.** The text is in `docs/privacy-policy.md`; it needs to be
      hosted at a public URL. A GitHub Pages page or a single static file on the
      existing Vercel project is enough.
- [ ] **Screenshots.** Required for 6.9" and 6.5" iPhone. These can be taken from the
      simulator; the four screens worth showing are Home, Calendar, an Information
      article, and the knowledge-base list.
- [ ] **Support URL.** Can be the same page as the privacy policy.

## 6. Description — draft

> Bear Lake keeps one family organised around a shared cabin.
>
> **Calendar.** See who is at the cabin and when, and add your own stay in a few taps.
>
> **Information.** The things everyone forgets: where the keys are, how to start the
> boat, which breaker runs the dock. Written once, available to everyone, and readable
> even without a signal.
>
> **Announcements.** Short notes from the family administrators — a changed gate code,
> a new rule, something that broke.
>
> Bear Lake is a private app. Accounts are issued by a family administrator; there is
> no public sign-up.

Keywords: `cabin, family, calendar, shared property, vacation home, lake`

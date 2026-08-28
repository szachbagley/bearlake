# Bear Lake — Privacy Policy

**Last updated:** 2026-08-28

Bear Lake is a private app for one extended family, used to coordinate a shared
vacation property. It is distributed unlisted on the App Store and is not intended
for the general public. Accounts are issued by a family administrator; there is no
sign-up.

## What the app collects

Only what you or a family administrator put into it:

| Data | Why |
|---|---|
| **Email address** | It is your login identifier. Nothing else. |
| **Display name** | So other family members can see who created an event. |
| **Password** | Stored only as a salted hash. Nobody — including the administrators — can read it back. |
| **Content you create** | Calendar events, announcements, quick tips, knowledge-base articles, and photos attached to articles. |

The app does **not** collect location, contacts, health data, financial data,
advertising identifiers, or usage analytics.

## What the app does not do

- **No tracking.** No analytics SDK, no advertising, no attribution, no fingerprinting.
- **No third-party SDKs at all.** The app has zero external dependencies.
- **Nothing is sold or shared.** Your data is never transferred to any third party
  for advertising, marketing, or data-brokerage purposes.
- **No profiles are built** about you or your use of the app.

## Where the data goes

Content is stored on a private server operated by the family administrators
(hosted on Railway), and photos are stored in a private cloud storage bucket
(Amazon S3). Photos are never publicly readable: the app fetches them through
short-lived signed links that expire, and the app stores only the storage key,
never a link.

Two third parties are contacted by your device in normal use:

- **The family's own server**, for everything the app shows you.
- **YouTube**, only when you open a knowledge-base article that contains a video.
  Videos are embedded through `youtube-nocookie.com`, YouTube's reduced-tracking
  domain, and only load when such an article is opened. YouTube is a Google service
  and its own privacy policy applies to that playback.

## What is stored on your phone

- Your **sign-in token**, in the iOS Keychain.
- A **cached copy of content you have already viewed**, so the app is usable at the
  cabin without a signal. This copy is erased when you sign out.

Both are protected by iOS device encryption when your phone has a passcode set. If
your phone has no passcode, iOS does not encrypt app data at rest — please set one.

## Your choices

- **Access or correct your data:** ask a family administrator.
- **Delete your data:** ask a family administrator. Accounts are deactivated rather
  than deleted so that authorship of past content remains accurate; content you
  created can be deleted on request.
- **Stop using the app:** sign out, which erases the local cached copy, and delete
  the app.

There is no in-app account creation, and therefore no in-app account deletion.
Accounts exist only because an administrator created one for you.

## Children

The app is used by one family and may be used by children under the supervision of
their parents. It collects nothing beyond what is listed above, shows no advertising,
and contains no third-party content other than family-posted YouTube links.

## Changes

If this policy changes, the updated version will be posted at the same address and
the date above will change.

## Contact

Questions about this policy, or requests about your data, go to the family
administrators: **szachbagley@gmail.com**.

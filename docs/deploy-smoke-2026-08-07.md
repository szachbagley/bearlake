# Production deployment smoke test — 2026-08-07

Server deployed to Railway (project `bearlake-cabin`, environment `production`)
from `server-dev-plan.md` Phase 8. Base URL:
`https://bearlake-server-production.up.railway.app/api/v1`.

Credentials are redacted from this record; they were handled only in the
terminal session and Railway's encrypted variable store.

## Infrastructure

| Component | Detail |
|---|---|
| API + MySQL | Railway, project `bearlake-cabin`, env `production` (MySQL 9.4, private-only) |
| Node | pinned to 22 (`.node-version`); build `npm run build`, start `npm start` |
| Healthcheck | `/api/v1/health`, wired in `railway.json` |
| S3 bucket | `bearlake-media-prod`, us-east-1 — Block Public Access ON, SSE-S3, CORS GET/PUT/HEAD |
| IAM | user `bearlake-server`, inline policy scoped to `s3:PutObject`/`s3:GetObject` on `bearlake-media-prod/articles/*` only (not root keys) |
| First admin | seeded via the compiled `dist/scripts/seedAdmin.js` through a temporary MySQL TCP proxy, which was then removed |

## Results

```
1.  health                     -> {"ok":true}
2.  admin login (temp pw)      -> mustChangePassword=true, role=admin
3.  gated route before change  -> 403 PASSWORD_CHANGE_REQUIRED
4.  change password            -> mustChangePassword=false
5.  create event (all-day)     -> 201
6.  create announcement        -> 201
7.  create quick tip           -> 201
8.  create category            -> 201
9.  create draft article       -> 201, schemaVersion=1, status=draft

    D42 real S3 round-trip against bearlake-media-prod:
10. presign upload             -> 200, key articles/{articleId}/{uuid}
11. PUT bytes to S3            -> 200 (S3 accepted the signed content-type/length)
12. publish w/ image block     -> 200, status=published
13. presigned GET resolves     -> https://bearlake-media-prod.s3.us-east-1.amazonaws.com/articles/...
14. GET image from S3          -> 200, bytes out == bytes in

    member sees published-only:
15. member lists articles      -> 1 published (draft hidden)
16. member create category     -> 403 FORBIDDEN
```

Every step passed. Step 3's gate check is shown from the post-test verification
run (the initial pass had a shell-quoting glitch on the query string, not a
server fault); it was re-confirmed cleanly after an admin password reset.

## Post-test cleanup

All demo rows created above were deleted, the S3 test object removed (bucket
empty), the smoke member deactivated (users are deactivate-only by design), and
the admin password reset so production starts in the intended first-login state:
one admin with a one-time temporary password that must be changed on first sign-in.

## Deferred item now closed

Plan **D42** (the live-bucket S3 round-trip deferred from Phase 7) is completed
here — steps 10–14 exercised a real presigned PUT and GET against
`bearlake-media-prod`, with S3 enforcing the signed content-type and length.

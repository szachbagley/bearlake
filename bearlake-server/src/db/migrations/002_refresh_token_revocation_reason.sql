-- Why a refresh token was revoked.
--
-- Reuse of a token revoked by ROTATION is evidence of theft and triggers
-- revocation of the user's whole token family. Reuse of one revoked for any
-- other reason — logout, password change, admin reset, deactivation — is just
-- a stale session and must not.
--
-- Without this distinction, a password change signs the user out everywhere,
-- and then the first other device to wake up and refresh presents its revoked
-- token, which looks like theft and destroys the session the user just
-- created. Changing your password would sign you out of the device you
-- changed it on.
--
-- NULL means the token is still live.

ALTER TABLE refresh_tokens
  ADD COLUMN revoked_reason
    ENUM('rotated','logout','password_change','admin_reset','deactivated','theft')
    NULL DEFAULT NULL
    AFTER revoked_at;

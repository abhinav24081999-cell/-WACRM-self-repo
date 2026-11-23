# WACRM access and auth emails

WACRM uses Supabase Auth for sign-in and password reset. The platform
administrator creates customer logins. Team invitations can be accepted
after signing in with an existing or newly provisioned login.

## Releasing secure access

1. Confirm the existing platform administrator's Supabase Auth user ID and
   set `WACRM_PLATFORM_ADMIN_USER_ID` in Vercel's Production environment.
   Set a separate branch-scoped value when reviewing a Preview. Account
   creation on Vercel is restricted to Production.
2. Apply `20261123123000_platform_secure_access.sql` to the Supabase
   project connected to Production. Customer creation and its audit
   record use the same database transaction.
3. In the hosted Supabase project's **Authentication → General
   Configuration**, turn off **Allow new users to sign up** and
   **Allow anonymous sign-ins**. The local CLI config sets these flags
   for local development. The hosted settings must be set separately.
4. Release the application. Verify the existing administrator's sign-in
   and Admin button, password resets, and the hosted Auth settings.
   The Admin form creates a login with an initial password. Verify the
   recipient's email before creating the login and share the password
   privately. Ask the customer to change it in their profile.

The Admin button requires a matching Supabase user ID. Unsetting
`WACRM_PLATFORM_ADMIN_USER_ID` and redeploying disables that entry point
and the provisioning API. The hosted signup setting is independent of
the Vercel deployment and stays in effect if the application is rolled
back.

## What the app does

Every emailed link is asked to return to the app's own origin at
`/auth/callback`, which exchanges the link for a session and then
forwards to the page the flow needs:

| Flow | Started from | Link returns to |
|---|---|---|
| Password reset | `/forgot-password` | `/auth/callback?next=/reset-password` |

"The app's own origin" is the origin the browser loaded the page from
(`window.location.origin`) — `https://crm.example.com` in production,
`http://localhost:3000` in local dev. No environment variable is
involved.

`/auth/callback` accepts both link shapes Supabase can produce — the
default `?code=` (PKCE) and `?token_hash=&type=` from a customised
template — validates `next` so it can only point at a same-origin path,
and redirects with a *relative* `Location`, so it works unchanged
behind Cloudflare Tunnel, nginx, Hostinger, Vercel or any other proxy.

## What Supabase needs

Supabase only honours a requested redirect when it matches its
**Redirect URLs** allow-list. Otherwise it **silently falls back to the
Site URL**, whose default is `http://localhost:3000`. That fallback is
the whole story behind "the confirmation link points at localhost".

### Hosted Supabase (supabase.com)

Dashboard → **Authentication → URL Configuration**:

1. **Site URL** — your production origin, e.g. `https://crm.example.com`.
2. **Redirect URLs** — add a wildcard for every origin the app runs on:

   ```text
   https://crm.example.com/**
   http://localhost:3000/**
   ```

   The `/**` matters: the app's redirect carries a path and a query
   string (`/auth/callback?next=…`), which a bare origin entry does not
   match.

Changes take effect immediately, but an email that was already sent
keeps the link it was sent with — request a fresh one to test.

### Self-hosted Supabase (Docker)

The Studio page under **Authentication → URL Configuration does not
persist settings** on a self-hosted stack; the auth service (GoTrue)
reads them from its environment. In the `.env` next to your
`docker-compose.yml`:

```env
SITE_URL=https://crm.example.com
ADDITIONAL_REDIRECT_URLS=https://crm.example.com/**,http://localhost:3000/**
```

(Older setups name these `GOTRUE_SITE_URL` and `GOTRUE_URI_ALLOW_LIST`.)
Restart the auth container afterwards. A self-hosted stack whose `.env`
still has the example `SITE_URL=http://localhost:3000` produces exactly
the symptom in [issue #595](https://github.com/ArnasDon/wacrm/issues/595).

### Local Supabase CLI (`supabase start`)

`supabase/config.toml` already closes public signup and anonymous access.
To configure email redirects in the local stack, add these keys to the
existing `[auth]` section:

```toml
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/**"]
```

## Opening the link on another device

The default flow is PKCE: the browser that *requested* the email holds
a one-time code verifier in a cookie, and `/auth/callback` needs it to
complete the exchange. Open the link on a different device or browser
and the callback lands on `/login` with a message saying the link
couldn't be used. Two things to know:

- **Email confirmation still succeeded.** Supabase verified the address
  before redirecting; the user can simply sign in.
- **Password reset must be finished in the same browser** it was
  requested from — or request a new link there.

To make links device-independent, switch the Supabase email templates
(**Authentication → Email Templates**) to the token-hash form, which
`/auth/callback` also accepts:

```html
<!-- Confirm signup -->
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Confirm your email</a>

<!-- Reset password -->
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset your password</a>
```

These links are built from the **Site URL**, so that setting must be
your production origin.

## Symptoms → causes

| You see | Likely cause |
|---|---|
| Link in the email is `http://localhost:3000…` in production | Site URL still at its default and/or your origin missing from Redirect URLs (see above). On self-hosted: `SITE_URL` in the Docker `.env`. |
| Link points at the right domain but a 404 | You're on a build older than the one that added `/auth/callback` and `/reset-password`. Update your fork. |
| `/login` says the link expired | Links are single-use and time-limited (Supabase default: 1 hour for recovery). Request a new one. |
| `/login` says the link couldn't be used | Opened in a different browser than the one that requested it (PKCE), or already used. See the section above. |
| Link works on localhost but not through a tunnel/proxy | Should not happen — the callback redirects with a relative `Location`. Check that your proxy forwards the `/auth/callback` path and its query string untouched. |

## Related

- Invite links (`/join/<token>`) are generated by the app, not by
  Supabase — see `NEXT_PUBLIC_SITE_URL` and `ALLOWED_INVITE_HOSTS` in
  `.env.local.example`.
- Sign-in itself (`/login`) never involves an emailed link.

# Sign in to direct ChatGPT with Staf

Staf uses a separate registration for ChatGPT plan usage. It does not import or
refresh official Codex CLI credentials. Shared-instance sign-in and inference
have synthetic test coverage but have not been live verified.

1. Start `staf`. Enter `/auth chatgpt login`, or choose **ChatGPT sign-in** from
   `/settings`.
2. Open the printed URL in your browser. Review the Staf name, account, and
   requested permissions, then complete sign-in.
3. Enter `/auth chatgpt status` to inspect the attempt and local credential status.
4. In `/settings`, select **ChatGPT** and an account-available model. You can also
   enter `/set provider chatgpt` and `/set model MODEL_ID`.
5. Send a chat message and inspect the response. This request uses the account's
   plan permissions. Do not paste credentials into chat.

The equivalent one-shot commands are `staf auth chatgpt login`, `staf auth chatgpt
status`, `staf auth chatgpt cancel`, and `staf auth chatgpt logout`. They accept the
same trailing connection options as chat.

ChatGPT is the displayed provider name. Existing `codex` auth commands remain
aliases, and configuration/API provider IDs remain `codex`; saved agents and
credentials do not need migration.

In the browser, **Settings** offers the same connection for the instance. Open
the sign-in link on the instance host, then return to see progress. A cancelled,
failed, or expired attempt can be retried. The link is held only in the browser
that started it; if a refresh loses it, cancel the pending attempt and start
again. Sign-out requires confirmation; finish active work and sign-in before
signing out. It leaves agent models and unsent drafts unchanged.

Selecting ChatGPT alone does not start sign-in. `/auth chatgpt cancel` cancels the
initiating client's pending attempt. `/auth chatgpt logout` removes local tokens;
it does not revoke the server grant. Manage server-side access in
[ChatGPT Settings](https://chatgpt.com/settings/usage). Status reads the local
record and does not establish server access or refresh a token.

The grant is stored under the instance's data directory in `auth/`, separate
from the bot profile and client pairing credential. The callback runs on the
instance host's loopback interface. The attempt belongs to the initiating paired
client. See the [direct adapter design](direct-responses.md) for the token,
refresh, and cancellation boundaries.

If sign-in fails, retry after checking browser consent and the reported status.
If inference fails, check account access, the selected model, and plan limits.
Failed streams do not commit a completed assistant response. A failed or
interrupted request may still have consumed provider usage.

Earlier direct ChatGPT text generation, a history follow-up, and a clock-tool round
trip were live-tested on 2026-10-26 with an existing Staf grant through the prior
CLI. Those checks do not verify shared-instance sign-in or chat. See
[verification and remaining gaps](direct-responses.md#verification-and-remaining-gaps).

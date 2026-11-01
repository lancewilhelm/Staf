# Sign in to direct Codex with Staf

Staf uses a separate registration for ChatGPT plan usage. It does not import or
refresh official Codex CLI credentials. Shared-instance sign-in and inference
have synthetic test coverage but have not been live verified.

1. Start `staf`. Enter `/auth codex login`, or choose **Codex sign-in** from
   `/settings`.
2. Open the printed URL in your browser. Review the Staf name, account, and
   requested permissions, then complete sign-in.
3. Enter `/auth codex status` to inspect the attempt and local credential status.
4. In `/settings`, select `codex` and an account-available model. You can also
   enter `/set provider codex` and `/set model MODEL_ID`.
5. Send a chat message and inspect the response. This request uses the account's
   plan permissions. Do not paste credentials into chat.

The equivalent one-shot commands are `staf auth codex login`, `staf auth codex
status`, `staf auth codex cancel`, and `staf auth codex logout`. They accept the
same trailing connection options as chat.

Selecting Codex alone does not start sign-in. `/auth codex cancel` cancels the
initiating client's pending attempt. `/auth codex logout` removes local tokens;
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

Earlier direct Codex text generation, a history follow-up, and a clock-tool round
trip were live-tested on 2026-10-26 with an existing Staf grant through the prior
CLI. Those checks do not verify shared-instance sign-in or chat. See
[verification and remaining gaps](direct-responses.md#verification-and-remaining-gaps).

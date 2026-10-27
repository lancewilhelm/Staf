# Sign in to direct Codex with Staf

This guide uses a new Staf registration for ChatGPT plan usage. Existing Codex CLI
credentials are not imported, copied or refreshed by this adapter. The app-server
and CLI exec paths are not the default Codex provider.

1. Start Staf with `pnpm start` (add `--data-dir PATH` for a custom directory).
2. Open `/settings`, choose Provider, choose a scope, select Codex and confirm.
   If no valid local credential record exists, Staf offers **Sign in with ChatGPT**.
   Starting with Codex already selected also offers this setup in an interactive
   terminal. Selecting Codex alone does not start authorization.
3. Choose **Sign in with ChatGPT**. Open the printed authorization URL in your
   browser. Review the Staf name, ChatGPT account, workspace and plan-usage
   permissions before you approve. Return to Staf when the browser reports success.
4. Staf resumes model selection in the same process. Discover an account-available
   model or enter its ID manually, then confirm. Model selection has its own scope;
   choose a remembered model separately if you want it on future launches.
5. Send a message. This uses the ChatGPT plan permission you granted. Credit use
   and limits remain subject to your consent and ChatGPT account settings.

The settings menu also has **Codex sign-in / reconnect**. You may skip sign-in
and enter a model manually, but inference still requires valid credentials.
Settings/auth actions do not generate a model response. Status checks local
records only; expired tokens refresh on the next authenticated request.

In chat, including plain or `TERM=dumb` terminals, use:

```text
/auth codex status
/auth codex login
/auth codex logout
```

These commands use the running chat's data directory. Login prints the full URL
outside the menu so it can be copied even in a narrow terminal. A denied or failed
login returns to chat for retry. Ctrl-C cancels pending browser sign-in and exits
chat; the callback listener and session lock are released. Cancellation reaches
an active token exchange and identity checks. Staf waits for an active callback
to settle before reporting cancellation. If credential replacement has already
started, Staf reports its actual outcome after the write. Login times out after
ten minutes. Successful textual `/auth codex login` returns to chat; open
`/settings` to select a model.

The standalone `pnpm start auth codex login|status|logout [--data-dir PATH]`
commands remain available for scripting or recovery. Use the same data directory
for standalone auth and chat. No separate auth command is needed for normal setup.
Model and reasoning changes apply on the next request, including in resumed chats.

Local logout does not revoke a server grant. Disconnect Staf in
[ChatGPT Settings](https://chatgpt.com/settings/usage) to manage server-side access.
Normal Codex CLI login remains separate. The explicit `auth codex-legacy` alias
only manages the old isolated CLI context. It is not a generation fallback.

## Recover from sign-in or inference failures

- If the browser denies consent, no token exchange occurs and existing credentials
  remain unchanged. Run login again when you want to authorize Staf.
- If registration does not return an issued client ID, sign-in fails without
  saving `dynamic_agent_client` as an account registration.
- If identity, state, nonce, signature or plan scope checks fail, no credential
  record replaces the selected account. Reauthorize the same registered account.
- If refresh is rejected, sign in again. Staf does not race or retry rotating
  refresh tokens automatically. A stale lock needs manual inspection after you
  confirm no Staf auth operation is active.
- If a model or plan limit rejects inference, fix the account/model choice and
  retry the message. Partial or failed streams do not commit conversation output
  or dispatch incomplete tool calls.
- A refusal appears as an assistant reply and remains in saved conversation history.
- Ctrl-C during provider setup prevents generation from starting afterward.
- Ctrl-C cancels the active direct request and exits the chat. A failed turn can
  still have unreported provider consumption. `/usage` never treats that as zero.

Direct `gpt-6-luna` text generation, a history follow-up and a resumed clock-tool
round trip were live-tested on
2026-10-26 using the user's existing Staf grant. This fixed a live stream mismatch:
completed message items arrived before an empty terminal output array. Staf now
retains those items until overall success. Encrypted reasoning replay also
includes the required summary array to avoid HTTP 400 on subsequent turns. OAuth callbacks, signatures, refreshes,
stream failures and cancellation are covered with dummy data, including PTY
menu-to-callback-to-model navigation. See
[verification and remaining gaps](direct-responses.md#verification-and-remaining-gaps)
for the distinction between recorded live checks and offline coverage.

See [the direct adapter explanation](direct-responses.md) for request shape,
cache identity, tool ownership, replay and security limits.

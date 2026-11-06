# Staf MVP user test plan

This is a historical test plan. Steps that select or send to Demo are obsolete.
Demo is no longer a supported provider. For current setup and controlled offline
checks, use [development](development.md) and [usage](usage.md).

Living draft, 2026-10-31. Use this to record what you personally observe; it is not an acceptance report. The [MVP decisions](mvp.md), [first-delivery specification](first-delivery-spec-handoff.md), and [usage guide](usage.md) describe the intended behavior and current preview. The specification was written before parts of the preview existed; check current usage and the running interface before each run. Work is in progress, so recheck command syntax and labels after the current changes land.

On 2026-11-01 the Advanced browser page was retired. Manual browser steps and
the older browser smoke scripts below that refer to its panels are historical
and cannot be run against the current workspace. The corresponding service and
CLI operations remain available. Use the GUI smoke command in the automated
checks section for the current workspace.

Record the commit or working-tree state, platform, date, each test's pass/fail/blocked result, and evidence without codes, tokens, private content, or provider credentials. A skipped test is not a pass. Browser and CLI results should refer to the same IDs and records. The demo provider is deterministic and offline; it does not follow bot instructions or soul and does not prove live provider behavior.

## Disposable offline setup

Use Node 22.16 or later and the project's installed pnpm dependencies. Work in a separate terminal and browser profile. The following creates a new private temporary directory; keep its path until cleanup. Do not point it at existing Staf data or credentials. The server binds loopback only. If port 3210 is occupied, select a free port and use it consistently below.

```sh
umask 077
STAF_TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/staf-mvp.XXXXXX")
printf 'Test directory: %s\n' "$STAF_TEST_DIR"
pnpm run build
node dist/cli.js instance serve "$STAF_TEST_DIR/instance.sqlite" 3210
```

Leave the server running. In another terminal, set `STAF_TEST_DIR` to the printed path, and define these convenient local values:

```sh
STAF_TEST_DIR='/replace/with/the/printed/test/directory'
URL=http://127.0.0.1:3210
CLIENT="$STAF_TEST_DIR/client.json"
```

The host prints a one-time pairing code. Treat it and the client file as secrets. Press Enter in the host terminal to issue a fresh code for each additional client. Never paste a real credential or pairing code into a report. When done, stop the server with Ctrl-C, close the disposable browser profile, and delete only the test directory after checking its printed path. For stopped-data backup and restore, see the separate Docker and native Linux guides below.

## Browser and CLI journey: offline preview

1. Open `http://127.0.0.1:3210/` in the disposable browser profile. Enter the host code and select **Pair**. Expect the bot and approval controls to appear. In the host terminal press Enter for a new code; in the second terminal run the command below, substituting that code locally. Expect `Paired`. Do not reuse a code.

   ```sh
   node dist/cli.js instance pair "$URL" "$CLIENT" CODE
   ```

2. In **New bot defaults**, load the current settings, select demo, and save. In the CLI inspect them with `node dist/cli.js instance defaults "$URL" "$CLIENT"`. Create a bot, change a default, and create another bot; verify the first bot keeps its copied settings and the second has the new defaults. Restore demo before continuing. In the browser enter a bot name and instructions and select **Create bot**. In the CLI run `node dist/cli.js instance bots "$URL" "$CLIENT"`; save the matching ID as `BOT_ID`. Inspect it with `node dist/cli.js instance inspect "$URL" "$CLIENT" "$BOT_ID"`. Expect the same bot and profile in both clients, without a model request. Change its name, instructions and soul in **Bot profile**, then **Save profile**; inspect again and confirm the same ID and updated fields. The demo does not apply those instructions.

3. Send `Hello from browser` in **Chat**. Run `node dist/cli.js instance read "$URL" "$CLIENT" "$BOT_ID"`; expect that message and the demo reply. Send a different message with `node dist/cli.js instance send "$URL" "$CLIENT" "$BOT_ID" 'Hello from CLI'`, then select browser **Refresh**. Expect both messages in one persistent chat. If a submission is uncertain, use the printed command ID with `node dist/cli.js instance status "$URL" "$CLIENT" COMMAND_ID` or browser **Check last command**, rather than resending.

4. In **Activity**, enter `Prepare a brief plan` and select **Start task**. Select the attempt and **Refresh activity** until it finishes. Expect an announcement in chat and actual recorded task events and outcome in Activity. Copy its attempt ID from the detail. Run the commands below and compare IDs, outcome and events with the browser; follow ends on a terminal state.

   ```sh
   node dist/cli.js instance tasks "$URL" "$CLIENT" "$BOT_ID"
   node dist/cli.js instance task "$URL" "$CLIENT" ATTEMPT_ID
   node dist/cli.js instance task-follow "$URL" "$CLIENT" ATTEMPT_ID
   ```

5. Exercise profile conflict: inspect a profile to a JSON file using `node dist/cli.js instance inspect "$URL" "$CLIENT" "$BOT_ID" > "$STAF_TEST_DIR/bot.json"`, change and save the browser profile, then change the stale JSON's name while retaining its revision. Run `node dist/cli.js instance edit "$URL" "$CLIENT" "$BOT_ID" "$STAF_TEST_DIR/bot.json"`. Expect a conflict, not an overwrite. Reinspect before a fresh edit. Archive the idle bot in the browser; expect it absent from the active list. Select **Show archived**, restore it, and confirm its identity and chat survive. An active bot should not be archived.

6. In **Clock approvals**, select instance scope, **Ask every time**, leave **Clock enabled** checked, and **Save settings**. Start the task `What time is it?`; select **Refresh requests**. Expect a pending clock request and a brief chat notice. Approve once; refresh Activity and expect the approval and clock result. Start another clock task and deny it; expect the denied action not to run and the outcome to show the block. Check the same records with:

   ```sh
   node dist/cli.js instance approvals "$URL" "$CLIENT"
   node dist/cli.js instance approval-settings "$URL" "$CLIENT" instance
   ```

   For a separate request, `instance approve "$URL" "$CLIENT" REQUEST_ID` or `instance deny "$URL" "$CLIENT" REQUEST_ID` can decide from the CLI. Test disabled clock with `instance set-approval-settings "$URL" "$CLIENT" instance never-ask false`; a clock request must remain blocked. Restore the default with `instance set-approval-settings "$URL" "$CLIENT" instance ask-for-risky-actions true`. Prefix these abbreviated commands with `node dist/cli.js`. Scope overrides and live permission changes should be checked separately; these controls apply to the clock.

7. Close and reopen the browser, then refresh: expect the same bot, chat and Activity. Stop and restart the instance with the same disposable database, reload the browser and inspect via CLI: completed records and paired clients should persist. To test interruption, first use **Ask every time** and start a clock task; wait until its approval is pending, then restart the server. Expect the unfinished attempt and approval to be interrupted, no automatic rerun, and an explicit **Retry** to create a linked new attempt requiring a new decision. Confirm via CLI `instance task` and `instance approvals`.

8. Stop and replacement require a task that stays active long enough to observe. The normal demo may finish too quickly; do not report that as a failure or proof. In a held task, use `direct task ATTEMPT_ID: focus on the report` and `stop task ATTEMPT_ID` in chat, and verify the same input and state in Activity and the CLI. An ambiguous reference must ask for the full ID. Use the controlled offline browser automation below, or, if a controllable provider is available, start a held task, confirm chat remains usable and a second task is rejected, select **Stop**, and observe stopping until execution settles. Retry the stopped attempt and confirm a new linked attempt and preserved history. In a separate held attempt enter a changed objective and select **Replace with objective above**; confirm the replacement waits for the original to settle and links to it. A late completed result may remain completed. Verify the same records with `instance tasks`, `instance task`, `instance task-stop`, `instance task-retry`, and `instance task-replace` as documented in [usage](usage.md#background-task-preview). Do not assume stop is instantaneous.

9. Inspect **Paired clients** and revoke the disposable CLI client. Its next CLI request should fail; issue a fresh host code and pair again to restore its access. Revoking the current browser should return it to pairing. All paired clients act for the owner, including approval and revocation controls.

## Memory, skills and schedules: offline preview

Continue with the same paired browser and CLI client and disposable instance. These checks use synthetic text and do not require a provider account.

1. In **Memory**, select **Selected bot**, create a short note, and use `node dist/cli.js instance memory-list "$URL" "$CLIENT" "bot:$BOT_ID"` to verify its ID, text and version. Load it in the browser, edit it and verify the new version in the CLI. Delete it and confirm it no longer appears. Create another bot and verify its selected-bot list does not contain the first bot's note.
2. Select **Shared user**, create a different note, and verify it with `node dist/cli.js instance memory-list "$URL" "$CLIENT" user`. Switch bots and confirm both see the shared note. In chat, send `Remember for all bots: I prefer green tea`; confirm the exact proposed text and scope before sending the displayed confirmation command. Verify only one entry exists even if confirmation is repeated. Select the original bot, create a bot-scoped note containing `tea`, then ask `What do you remember about tea?` and verify matching bot entries include scope, ID and version. Ask `Forget the memory about tea`; expect a preview with no mutation. Use the displayed exact ID/version command only after choosing the intended entry, then verify the result in the CLI. An excluded or ambiguous scope must ask for clarification. Deleting active memory does not erase prior transcripts or backups.
3. In **Skills**, import a synthetic name, description, provenance and text, then make it available to the selected bot. Verify the catalog and availability with `node dist/cli.js instance skill-list "$URL" "$CLIENT"` and `node dist/cli.js instance skill-bot-list "$URL" "$CLIENT" "$BOT_ID"`. Disable or remove availability and confirm it disappears from that bot's available list. Natural-language selection requires a tool-capable provider; the offline demo alone cannot prove model selection.
4. In **Recurring schedules**, create a daily UTC schedule for the selected bot with objective `What time is it?`, a time a few minutes ahead, and a five-minute lateness window. Inspect it in the browser and with `node dist/cli.js instance schedule-list "$URL" "$CLIENT"` and `node dist/cli.js instance schedule-inspect "$URL" "$CLIENT" SCHEDULE_ID`. While the instance remains running, wait for the occurrence and compare its linked task and Activity in both clients. Under Ask every time, approve its clock request. Disable, re-enable and revoke it; check each new version and confirm a revoked schedule cannot start future work. Do not reuse a revoked schedule to test another run.
5. Restart the service with the same disposable database. Confirm remaining memory, skill availability, schedule state and prior activity persist. Schedules support UTC clock reads, an explicit canonical public URL, an exact query against a captured local search backend, or an exact scratch command with a captured Docker configuration. Web, search and shell scopes permit one dispatch per occurrence including retries, and each requires separate owner approval. A scheduled web read still requires owner approval, and a redirect to a different URL is blocked. The offline browser check uses fake time and synthetic DNS to verify the exact target and blocked redirect; a disposable loopback search fixture verifies exact query, backend, approval and the one-dispatch cap. A synthetic shell executor checks exact command and configuration, approval and the same cap without running Docker. Missed-run, daylight-saving and busy-task edge cases are covered by synthetic-clock checks rather than waiting for real dates here.

## Web-reading, search and scratch-shell preview

Web reading is disabled by default. In the browser's **Web reading** panel, inspect and change instance, bot, and task permissions; use `node dist/cli.js instance web-permission "$URL" "$CLIENT" instance` and `node dist/cli.js instance web-permission-set "$URL" "$CLIENT" instance false` to inspect and disable the instance boundary. The demo provider does not request pages. The offline Chromium smoke uses a controlled provider and synthetic network to verify that each initial URL and redirect requires a separate exact-target approval before DNS, that denial or revocation stops the next hop, and that CLI journal records contain generic action details. No live site is contacted.

Live web testing requires separate authorization for the selected destination and a tool-capable provider. Before enabling it, read the [web-reading limits](usage.md#public-web-reading) and the browser retention notice; chats, tool calls, source text and backups can retain sensitive information. A query-bearing or credential-bearing request is rejected, but ordinary text can still contain secrets.

Search is a separate, default-off capability. The offline Chromium check configures a disposable loopback backend, checks the exact query and backend shown before approval, verifies one approved request and no request after denial or revocation, and checks untrusted snippet rendering and CLI journal readback. Its browser task-scope check covers permission settings, not an executing task; offline service tests cover task-scoped execution and stop. No external search engine is contacted. For an owner-operated backend and live provider, read [search setup and retention limits](usage.md#search-through-an-owner-configured-backend) first and obtain separate authorization for the real queries and their upstream recipients.

Scratch shell is a separate, default-off capability. The offline browser check uses a synthetic executor to verify exact command, daemon, image and scratch limits before approval; denial and revocation prevent execution. It also checks uncertain-outcome review and CLI readback. The scratch sandbox component was separately exercised with disposable Docker containers, including byte and inode limits and cleanup. A separate opt-in Chromium check used the real Docker executor with a synthetic provider, approved a harmless command, verified its output and cleanup, and confirmed denial created no container. Browser verification did not execute a task-scoped shell action. Read [scratch-shell setup and recovery](usage.md#scratch-only-shell) before configuring a trusted daemon and image. Host workspaces are not mounted. Live model-directed commands require separate authorization.

For isolated installations, use the [Docker Compose guide](docker-installation.md) or the [native Linux guide](native-linux-installation.md) with disposable data. Their stopped-data backup and restore steps are distinct from the local database used above. Live provider sign-in and inference require separate authorization.

## Automated offline checks

Run `pnpm run check` and `pnpm test` for type checking and the repository's offline tests. The browser smoke checks are:

```sh
pnpm run build
node test/browser/gui-smoke.mjs
```

The GUI check exercises pairing, a shared synthetic Codex sign-in, per-bot
models, keyboard chat, draft recovery, task updates, an approval, duplicate bot
names, and retirement of the Advanced page. It uses disposable data and
headless Chromium. Set `CHROME_PATH` if a compatible Chromium is not found.
The older `instance-smoke.mjs` and `docker-smoke.mjs` scripts depend on the
retired page and are retained as historical coverage; they do not validate the
current workspace. These checks do not establish live-provider, LAN, Linux
installation, Docker deployment, or full MVP acceptance.

## Pending full-MVP acceptance

These scenarios are requirements or planned checks, not claims of completed capabilities. Do not run them against real accounts or data merely to fill this checklist. Update steps and expected outcomes when the relevant implementation is ready.

- **Skills:** with separately authorized live inference, request a relevant skill in ordinary language, observe discovery and use, and verify permissions still apply. Offline synthetic selection is covered by the automated checks.
- **Collaboration:** with separately authorized live inference, request help between two bots and inspect the exact sender, recipient and text for each approval, the actual exchanges in Activity, and the requester's final answer. Test denial and both bots' permission boundaries. The offline Chromium check already exercises approval and denial with a controlled provider; the demo provider does not initiate delegation.
- **Schedules:** verify broader scope expansion and live scheduled actions only with separate authorization. The current preview supports UTC clock reads or one exact approved web, search or scratch action, with provisional recurrence and overlap policies; scheduled shell has not been run against Docker.
- **Shell and grants:** verify task-scoped shell execution and real model-directed use only with separate authorization and disposable resources. Reusable grants are implemented behind a disabled-by-default gate and have synthetic and gated browser coverage; the default change is blocked by automatic approval review. No grant may expand permissions or task scope. Web reading and search have separate synthetic coverage above; live services remain unverified.
- **Recovery and backups:** verify a real update and pre-migration backup, restore to a separate disposable host, preserved credentials and records, and recovery from uncertain action outcomes without silently repeating side effects. A stopped Docker volume copy and restore were tested locally with offline demo data.
- **LAN and owner access:** from a separate machine, verify the supported protected transport, pairing, revocation and remote provider setup. Loopback preview is not LAN support; do not expose it as a workaround.
- **Native Linux and Docker:** independently verify native Linux installation, startup after reboot, upgrades, and full cross-host Docker restore. Local Docker persistence, pairing and stopped-volume restore were tested with demo data. Do not alter an existing Hermes installation.
- **Live Codex and OpenRouter:** each provider needs separate authorization for sign-in and live inference before its checks. After authorization, use the documented supported setup path without placing credentials in commands or reports; verify readiness, an actual conversation, tool/cancellation behavior where supported, failure reporting without fallback, and remote setup where applicable. Record costs and unverified steps. Offline demo and mocked tests cannot establish live behavior.

Also repeat task-directed chat, questions and answers, profile snapshots, live policy rechecks, responsive main chat, and uncertain submissions with a controlled provider. The browser automation covers synthetic scenarios; a complete acceptance run must cover the agreed journey and record gaps.

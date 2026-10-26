# MS-768 — Answer link in pastoral-prayer SMS

Turn on `app_config/prayer_request_sms.includeAnswerLinkInSms` so live pastoral-prayer texts include the minted Answer URL next to the reply instructions. Then send **one** link-bearing SMS to Jonathan Harris only.

`includeReplyWebhookInSms` stays as it is. The smoke never sends `replyWebhookUrl`. The form path does not need the inbound webhook: `/a/<token>` is `answerLink`, and a submit writes `people/{personId}/prayer_requests/{serviceDate}` with `prayerRequestSource: form`.

The workflow runs only from **`main` after this change is merged**. It checks out `main`, so a dispatch from the PR branch will not see these scripts.

## Who and which Sunday

Recipient lock, all of these:

- `people/CErA3v4J4hVm0iLfdG9Y`
- name `Jonathan Harris`
- phone `(580) 504-3816` (`+15805043816`)

Preferred service date is the next Sunday **after** the church-local day the workflow runs (`America/Chicago`). Dispatched in the week of Monday 2026-10-26, that Sunday is **2026-11-01**, and the script uses it when he is named on a requesting prayer for `services/2026-11-01`.

If he is not, the dry-run says so and uses the next Sunday through the following 21 days (the Answer link lifetime in `functions/answer-link.js`) where he is a subject. If none exists, the script stops. Do not send. The `services/2099-06-01` fixture is out of range on purpose: a submit there is not this Sunday's prayer box, and a link minted for it would expire in 21 days anyway.

He has to open the link on or before that service date, church time. The link closes at the end of the service day. A submit lands on `people/CErA3v4J4hVm0iLfdG9Y/prayer_requests/{serviceDate}`.

`--commit` mints with `answer-link-door.mintAnswerLink` (`purpose: prayer_request`, `personId` above, `thing` the service date) — the same call `dispatchPrayerAsk` makes. Dry-run prints `serviceDate` and the would-send body with `/a/<token>` and does **not** mint or text. The real `/a/<token>` path is only in the commit job log.

Commit also refuses when:

- `includeAnswerLinkInSms` is not already true (run the flag script first)
- that prayer-request doc already has request text (an elder fill, a reply, or a form answer), because a new submit would not land as a fresh fill

An empty send-state doc (`initialSentDate` only) does not block.

## Order

Read each log before the next step. Flag first, then the URL dry-run, then the one send.

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Flag dry-run | `set-prayer-sms-answer-link.js` | *(empty)* | `false` |
| Flag apply | `set-prayer-sms-answer-link.js` | *(empty)* | `true` |
| URL dry-run | `textbelt-test-send.js` | `--with-url` | `false` |
| URL send | `textbelt-test-send.js` | `--with-url` | `true` |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=set-prayer-sms-answer-link.js \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=set-prayer-sms-answer-link.js \
  -f commit=true
gh workflow run "Prod ops script" --ref main \
  -f script=textbelt-test-send.js \
  -f 'args=--with-url' \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=textbelt-test-send.js \
  -f 'args=--with-url' \
  -f commit=true
```

The flag merge writes only `includeAnswerLinkInSms: true`. The dry-run log should show `includeReplyWebhookInSms` unchanged and `merge=true`. If that line says `true`, stop: the field was already on, and this script does not clear it. The URL smoke still omits `replyWebhookUrl` either way. The URL dry-run log should show `serviceDate`, `answerUrl: (not minted)`, and `replyWebhookUrl: (omitted)`. The send log contains a live Answer URL. Treat that log as sensitive until the service date ends.

After the flag commit, the scheduler and Send Now include Answer links for **every** pastoral-prayer subject, not only this smoke. That is the switch. It does not require a functions deploy if production already runs the `includeAnswerLinkInSms` reader; merging this PR still starts the standing Firebase deploy because every push to `main` does.

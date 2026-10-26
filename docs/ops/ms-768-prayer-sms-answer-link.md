# MS-768 — Answer link in pastoral-prayer SMS

Turn on `app_config/prayer_request_sms.includeAnswerLinkInSms` so live pastoral-prayer texts include the minted Answer URL next to the reply instructions. Then send **one** link-bearing SMS to Jonathan Harris only.

`includeReplyWebhookInSms` stays as it is. The smoke never sends `replyWebhookUrl`. The form path does not need the inbound webhook: `/a/<token>` is `answerLink`, and a submit writes `people/{personId}/prayer_requests/{serviceDate}` with `prayerRequestSource: form`.

The workflow runs only from **`main` after this change is merged**. It checks out `main`, so a dispatch from the PR branch will not see these scripts.

## Who and which service date

Recipient lock, all of these:

- `people/CErA3v4J4hVm0iLfdG9Y`
- name `Jonathan Harris`
- phone `(580) 504-3816` (`+15805043816`)

The script prefers the next Sunday **after** the church-local day the workflow runs (`America/Chicago`) when he is a pastoral-prayer subject on that Sunday, otherwise the next such Sunday inside 21 days (the Answer link lifetime in `functions/answer-link.js`).

Checked against prod on 2026-10-26. He is not a subject on any Sunday through that horizon:

| Sunday | Pastoral prayer subjects |
| --- | --- |
| 2026-11-01 | Josiah Wilks (`2yMtFxJXNMxMk7g7sHWl`), Karley Buchanan (`RnTSLhWK6Fv4Ocdg7sCH`) |
| 2026-11-08 | none |
| 2026-11-15 | none |

`services/2099-06-01` already exists, its pastoral prayer is empty, and this script does not edit it. Do not add him to a live Sunday's pastoral prayer.

The dry-run therefore picks **`2099-06-08`**. That date is a Monday, not a congregational Sunday, and the document was absent. `--commit` creates `services/2099-06-08` only when it is absent: irregular, standard order, and the requesting prayer named Pastoral Prayer lists only Jonathan Harris. If that document already exists and is not this smoke, the script stops and does not edit it. A later commit reuses the doc when it already names only him.

### The rule the form uses

`mayAnswerPrayerRequest` (`functions/prayer-request.js`) accepts this Answer link when all of these hold. `loadPrayerAnswerState` is what the door calls, with `viaAnswerLink: true`:

1. `personId`, `serviceDate`, and church-local `todayDate` are set.
2. `personId` is in `subjectIds`. Those ids are the people named on liturgy elements whose kind is `prayer` and whose `requests` is set. The signed-in notice window is not required on an Answer link.
3. Church-local today is not after `serviceDate`. The service date itself is still open.

On `2099-06-08`, (2) is true only after the ops document exists, because the door reads `services/2099-06-08` rather than the ids printed in the dry-run. (3) stays true for the life of that date. The token is the other clock: `linkExpiryAt` is the earlier of the end of the service date and 21 days after mint. The service date is later, so the link dies 21 days after the send. Open it before then. A submit lands on `people/CErA3v4J4hVm0iLfdG9Y/prayer_requests/2099-06-08` with `prayerRequestSource: form`.

The hourly prayer sender skips a service whose date is further out than the prayer's notice days. Pastoral Prayer's notice list is 5, 3, and 1. `2099-06-08` is past that, and the document names nobody else, so this doc does not text other members. Turning the flag on still adds Answer links to real Sunday sends. That is the switch, separate from this one smoke.

`--commit` mints with `answer-link-door.mintAnswerLink` (`purpose: prayer_request`, `personId` above, `thing` `2099-06-08`) — the same call `dispatchPrayerAsk` makes. Dry-run prints `serviceDate` and the would-send body with `/a/<token>` and does **not** mint, text, or create the service. The real `/a/<token>` path is only in the commit job log.

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

The flag merge writes only `includeAnswerLinkInSms: true`. The dry-run log should show `includeReplyWebhookInSms` unchanged and `merge=true`. If that line says `true`, stop: the field was already on, and this script does not clear it. The URL smoke still omits `replyWebhookUrl` either way. The URL dry-run log should show `serviceDate: 2099-06-08`, `opsService: absent`, `answerUrl: (not minted)`, and `replyWebhookUrl: (omitted)`. The send log contains a live Answer URL. Treat that log as sensitive for the 21 days the token stays open.

After the flag commit, the scheduler and Send Now include Answer links for **every** pastoral-prayer subject, not only this smoke. That is the switch. It does not require a functions deploy if production already runs the `includeAnswerLinkInSms` reader; merging this PR still starts the standing Firebase deploy because every push to `main` does.

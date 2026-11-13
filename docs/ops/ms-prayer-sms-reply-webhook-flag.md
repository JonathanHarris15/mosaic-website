# MS-806 — Pastoral-prayer SMS reply webhook flag

`smsInbound` only receives a text reply when the outbound Textbelt payload includes `replyWebhookUrl`. Unverified keys reject that field, so `app_config/prayer_request_sms.includeReplyWebhookInSms` stays off until the proof below is accepted. While it is off, a template that says "Just reply to this message" invites a reply the church never ingests.

The Answer link (`includeAnswerLinkInSms`) is a separate flag. This script does not write it.

Newest member text wins. `applyReply` and `saveFormAnswer` store the latest reply or form submission on `people/{personId}/prayer_requests/{serviceDate}` and update the generated Shepherding Note in place when that note was not hand-edited. They do not create a second note. An elder-typed request (`prayerRequestSource: elder`) is left alone.

No stored rows move. Empty requests stay empty. Do not invent a reply for someone who already texted while the webhook was off; ask them to use the Answer link.

## 1. Prove outbound still delivers

Only after this change is on **`main`**. The workflow checks out `main`. Recipient lock is Jonathan Harris only (`people/CErA3v4J4hVm0iLfdG9Y`, `(580) 504-3816`). Do not text members.

| `script` | `args` | `commit` |
| --- | --- | --- |
| `textbelt-test-send.js` | `--with-reply-webhook` | `false` |
| `textbelt-test-send.js` | `--with-reply-webhook` | `true` |

Dry-run prints `replyWebhookUrl: https://us-central1-mosaic-hymn-database.cloudfunctions.net/smsInbound` and does not send. Commit sends one SMS with that field and no Answer URL. If Textbelt's response is not a success, stop. Do not run step 2.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=textbelt-test-send.js \
  -f 'args=--with-reply-webhook' \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=textbelt-test-send.js \
  -f 'args=--with-reply-webhook' \
  -f commit=true
```

## 2. Turn the flag on

Only after step 1's commit log shows `success` and a `textId`, and a functions deploy whose log lists `functions:smsInbound` in `targets=` is green. Hosting and Functions deploy on push to `main`. The flag is a separate dispatch. `answerLink` ships the form path. Text replies are `smsInbound`. A green deploy that omits `functions:smsInbound` leaves the previous reply handler in place.

| `script` | `args` | `commit` |
| --- | --- | --- |
| `set-prayer-sms-reply-webhook.js` | *(empty)* | `false` |
| `set-prayer-sms-reply-webhook.js` | *(empty)* | `true` |

The merge writes only `includeReplyWebhookInSms: true`. The dry-run log should show `includeAnswerLinkInSms` unchanged. If that line is `absent` or `false` and prod was already sending Answer links, stop and check you are on the right project before commit.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=set-prayer-sms-reply-webhook.js \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=set-prayer-sms-reply-webhook.js \
  -f commit=true
```

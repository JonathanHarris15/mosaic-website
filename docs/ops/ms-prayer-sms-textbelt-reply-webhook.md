# P0 — pastoral-prayer SMS without Textbelt reply webhook

URL-bearing smoke and the `includeAnswerLinkInSms` flag live in [MS-768 — Answer link in prayer SMS](./ms-768-prayer-sms-answer-link.md). This note stays the no-webhook send. Do not pass `--with-url` here.

Unverified Textbelt keys reject sends when `replyWebhookUrl` is present, even if the SMS body has no `https://` link. Leave `includeReplyWebhookInSms` off until a Jonathan-only send with `--with-reply-webhook` is accepted. That proof and the flag script are in [Reply webhook flag](./ms-prayer-sms-reply-webhook-flag.md). Do not pass `--with-reply-webhook` on this note's smoke. Inbound SMS replies do not route while the flag is off.

## After deploy (functions)

1. **Dry-run Textbelt** (Jonathan Harris only, no webhook):

   | `script` | `args` | `commit` |
   | --- | --- | --- |
   | `textbelt-test-send.js` | *(empty)* | `false` |
   | `textbelt-test-send.js` | *(empty)* | `true` |

2. **Retry failed prayer sends** for 2026-10-25:

   | `script` | `args` | `commit` |
   | --- | --- | --- |
   | `reset-prayer-send-attempt.js` | `--service-date 2026-10-25 --ids yOhdWHurhmFxn7KKfZTv,rtLaPcywYrcNcdQyt1xp` | `false` |
   | `reset-prayer-send-attempt.js` | same | `true` |

`textbelt-test-send.js` with `commit=true` loads `TEXTBELT_KEY` from Secret Manager
in `mosaic-hymn-database` (same secret as Cloud Functions), using the deploy
service account from `GOOGLE_APPLICATION_CREDENTIALS`. Optional override:
`TEXTBELT_KEY` in the environment.

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=textbelt-test-send.js -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=reset-prayer-send-attempt.js \
  -f 'args=--service-date 2026-10-25 --ids yOhdWHurhmFxn7KKfZTv,rtLaPcywYrcNcdQyt1xp' \
  -f commit=false
```

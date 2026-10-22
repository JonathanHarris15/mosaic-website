# P0 — pastoral-prayer SMS without Textbelt reply webhook

Unverified Textbelt keys reject sends when `replyWebhookUrl` is present, even if the SMS body has no `https://` link. Until the church account is verified, `app_config/prayer_request_sms.includeReplyWebhookInSms` stays **false** (default). Inbound SMS replies will not route until that flag is turned on after verification.

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

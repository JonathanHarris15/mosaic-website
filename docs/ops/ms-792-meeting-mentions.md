# MS-792 — legacy `meeting` mention chips

TipTap cross-references used `kind: 'meeting'` before elder documents. The renderer now treats `meeting` as an alias for `elder_document`; stored JSON can be rewritten in prod.

## Prod ops (main only)

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=migrate-meeting-mentions.js \
  -f commit=false
```

Review `documents updated` / `mentions rewritten`, then `commit=true` if non-zero.

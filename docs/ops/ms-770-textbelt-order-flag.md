# MS-770 — hide the Textbelt liturgy order fixture

The live Answer-link test order is `liturgy_orders/textbelt-url-test`. Mark it ops so it stays out of ordinary pickers and the Services table **Orders** filter; do not delete the document.

## GitHub Actions (preferred)

Use workflow **[Prod ops script](./prod-ops-script.md)** on branch **`main`**.

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Dry-run | `set-liturgy-order-flags.js` | `--id textbelt-url-test --ops` | `false` |
| Apply | `set-liturgy-order-flags.js` | `--id textbelt-url-test --ops` | `true` |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=set-liturgy-order-flags.js \
  -f 'args=--id textbelt-url-test --ops' \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=set-liturgy-order-flags.js \
  -f 'args=--id textbelt-url-test --ops' \
  -f commit=true
```

## Local (service account key at repo root)

```bash
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
  --id textbelt-url-test --ops
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
  --id textbelt-url-test --ops --commit
```

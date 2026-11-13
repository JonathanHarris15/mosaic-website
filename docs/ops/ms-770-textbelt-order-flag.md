# MS-770 — hide the Textbelt liturgy order fixture

The live Answer-link test order shows in the Services table as **TEXTBELT URL whitelist test (ops)**. The app loads orders from the default Firestore database, collection `liturgy_orders`, via `LiturgyOrderStore.loadCatalog` (`public/liturgy-order-store.js`); the Services table uses `LiturgyOrderCore.visibleOrders` (`public/service-calendar.js`). Document ids are not always human-readable slugs — use `--list` or `--name-match` before patching.

Mark the order `ops: true` so it stays out of ordinary pickers and the Services table **Orders** filter; do not delete the document.

## GitHub Actions (preferred)

Use workflow **[Prod ops script](./prod-ops-script.md)** on branch **`main`**.

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| List ids | `set-liturgy-order-flags.js` | `--list` | `false` |
| Dry-run | `set-liturgy-order-flags.js` | `--name-match textbelt --ops` | `false` |
| Apply | `set-liturgy-order-flags.js` | `--name-match textbelt --ops` | `true` |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=set-liturgy-order-flags.js \
  -f 'args=--list' \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=set-liturgy-order-flags.js \
  -f 'args=--name-match textbelt --ops' \
  -f commit=false
gh workflow run "Prod ops script" --ref main \
  -f script=set-liturgy-order-flags.js \
  -f 'args=--name-match textbelt --ops' \
  -f commit=true
```

After `--list`, you can pass `--id <document-id>` instead of `--name-match` if you prefer.

## Local (service account key at repo root)

```bash
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod --list
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
  --name-match textbelt --ops
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
  --name-match textbelt --ops --commit
```

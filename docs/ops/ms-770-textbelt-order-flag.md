# MS-770 — hide the Textbelt liturgy order fixture

The live Answer-link test order is `liturgy_orders/textbelt-url-test`. Mark it ops so it stays out of ordinary pickers and the Services table **Orders** filter; do not delete the document.

```bash
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
  --id textbelt-url-test --ops
node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
  --id textbelt-url-test --ops --commit
```

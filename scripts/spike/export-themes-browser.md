# Getting the real themes out, without a service-account key

Two ways. Either produces `scripts/spike/themes.json`.

## Option A — browser console (no credentials needed)

Log into the site as yourself, open any page that loads `auth.js` (the service
builder is fine), open the browser console, and paste this. It downloads
`themes.json` to your Downloads folder — move it into `scripts/spike/`.

```js
(async () => {
  const snap = await db.collection('services').get();
  const byKey = new Map();
  snap.forEach(doc => {
    const text = String(doc.data().theme || '')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (!text) return;
    const key = text.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { text, key, dates: [] });
    byKey.get(key).dates.push(doc.id);
  });
  const themes = [...byKey.values()].sort((a, b) => a.text.localeCompare(b.text));
  themes.forEach(t => t.dates.sort());
  console.log(`${snap.size} services, ${themes.length} distinct themes`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(themes, null, 2)], { type: 'application/json' }));
  a.download = 'themes.json';
  a.click();
})();
```

## Option B — service account key

If you still have the admin SDK key (it used to live at
`scripts/mosaic-hymn-database-firebase-adminsdk-*.json`, gitignored):

```bash
node scripts/spike/export-themes.js --key=path/to/adminsdk.json
```

## Then

```bash
node scripts/spike/analyze-themes.js
```

Add `--test="Some New Theme"` to score a theme that is not in the list yet —
that is the thing the service builder would eventually do live.

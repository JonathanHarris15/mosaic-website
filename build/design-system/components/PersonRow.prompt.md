**PersonRow** — How a person is shown: a face, their name in the reading face, then how to reach them. The name is the largest thing in the row.

```html
<a class="m-person" href="#"><span class="m-avatar">AL</span><span class="m-person__text"><span class="m-person__name">Ada Lowell</span><span class="m-person__meta">Member · North household</span></span></a>
```

Base class `.m-person`, modifiers `.m-person--<variant>`.

- Name, then one line of role or household, then mail and phone in the quiet colour. Do not lead with a tracked label.
- The row tints on hover when it opens a record. It does not lift.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.

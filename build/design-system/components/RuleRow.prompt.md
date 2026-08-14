**RuleRow** — One rule, read back as a sentence in serif, with whatever it is made of underneath.

```html
<li class="m-rule-row"><div class="m-rule-row__line"><span class="material-symbols-outlined m-rule-row__icon">sell</span><span class="m-rule-row__text">Must be tagged "Sound Trained"</span></div></li>
<li class="m-rule-row m-rule-row--private"><div class="m-rule-row__line"><span class="material-symbols-outlined m-rule-row__icon">lock</span><span class="m-rule-row__text">This rule uses a tag an elder keeps private. It still applies — ask an elder if it needs changing.</span></div></li>
```

**state:** `default` · `private` · `unavailable`

Base class `.m-rule-row`, modifiers `.m-rule-row--<variant>`.

- A COLUMN, not a row: the one rule made of many things carries them in __body under the sentence, indented past the icon. A rule naming eleven people must not print them in the sentence as well.
- Three edges, and the difference between the last two is the whole point. --unavailable is red: the rule cannot run and the editor has to act. --private is gold: the rule uses a tag an elder keeps private, it still applies, and there is nothing to fix. Red on a rule nobody can fix reads as 'delete this', and the editor would be deleting a rule an elder still means.
- The sentence is the product's, not the component's. This draws it; roles-manager.js and recurring-events.html decide what it says.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.

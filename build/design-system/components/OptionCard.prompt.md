**OptionCard** — One choice on a form somebody is answering, as a card you tap rather than a radio you aim at.

```html
<label class="m-option"><input type="radio" name="q3"><span class="m-option__mark"></span>Tuesday 7am</label>
<label class="m-option m-option--picked"><input type="radio" name="q3" checked><span class="m-option__mark"></span>Tuesday 7pm<span class="m-option__said">Your answer</span></label>
```

**state:** `default` · `picked`
**lines:** `one` · `many`

Base class `.m-option`, modifiers `.m-option--<variant>`.

- Built for MS-371 — the page a stranger answers a form on, usually on a phone, usually standing up. A native radio is an 18px target next to its label; this is the whole row, 52px tall, which is the difference between answering and giving up.
- NOT a Checkbox. m-check is an editor ticking a setting on a dense admin screen; this is a member choosing between three things they are reading for the first time. Same HTML input underneath, different job and different size.
- --picked is the answer they have chosen. It carries a fill and a heavier border rather than only a dot, because on a phone in sunlight a 10px dot is not an answer to 'which did I pick'.
- __said is the 'Your answer' marker, used when somebody returns to a form they already answered and needs to see what they said before they change it.
- The mark is drawn rather than native so it matches in both themes. The real input is visually hidden but still focusable, so the keyboard and a screen reader get an ordinary radio.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.

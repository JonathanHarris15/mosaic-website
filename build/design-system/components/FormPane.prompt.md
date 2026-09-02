**FormPane** — A titled panel with a head, a body, and a row of badges saying what the thing inside it is.

```html
<div class="f-pane"><div class="f-panehead"><div><span class="m-label m-label--sm">Editing form</span><h2 class="f-panename">Monday gathering</h2></div></div><div class="f-panebody">…</div></div>
```

**part:** `pane` · `head` · `name` · `body` · `badges`

Base class `.f-pane`, modifiers `.f-pane--<variant>`.

- From the MS-360 design. It is the form page's whole shell: the form's name, what it is (public/members, named/anonymous, open/closed) as badges, the actions, then the tabs and the body.
- ⚠ Its shell is the same three declarations m-card-list uses — surface-container-lowest, a hairline, radius-xl. That is not an accident and not yet worth merging: a card LIST is rows, this is a titled container with a head. If a third thing wants the same shell, promote it rather than adding a fourth copy.
- __name is serif because it is the form's own name, the same reason m-row--serif exists.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.

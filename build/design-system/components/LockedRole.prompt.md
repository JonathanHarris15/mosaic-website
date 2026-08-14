**LockedRole** — A Role that cannot be edited, and the one thing about it that can.

```html
<li class="m-locked-role"><span class="material-symbols-outlined m-locked-role__lock">lock</span><span class="m-locked-role__name">Preacher</span><span class="m-unitfield m-unitfield--sm"><input type="number" min="0" step="0.25" value="4" /><span class="m-unitfield__unit">weeks' rest</span></span></li>
```

Base class `.m-locked-role`, modifiers `.m-locked-role--<variant>`.

- The lock is on every row, not only on the card. A row lifted out of its explanation still has to say it is not yours to change.
- The name is --on-surface-variant, one step back from an editable Role's. It is being listed, not offered.
- Exactly one control. The moment a second appears, the surface has stopped reading as locked and the decision behind it (ADR-0016) has been reversed by accident.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.

**QuestionEditor** — A question on a form being built — a row when it is shut, a panel when it is open.

```html
<button class="f-qrow"><span class="f-qnum">1</span><span><span class="f-qtext">Which evening suits you?</span><span class="f-qmeta"><span>Multiple choice</span></span></span></button>
```

**state:** `shut` · `open`
**part:** `row` · `number` · `text` · `meta` · `head` · `option` · `add`

Base class `.f-qrow`, modifiers `.f-qrow--<variant>`.

- The main event of the MS-360 design, and the thing it was asked to have an opinion about. Shut, a question is one row saying its type, its option count and whether it is needed. Open, it is a panel with a left edge in --primary so you can see at a glance which one you are in.
- One open at a time is the PAGE's rule, not this component's — the component only knows how to be shut or open.
- f-add is the dashed 'Add a question' affordance. Dashed because it is not a thing yet; every other button here does something to something that exists.
- The type picker inside an open question is a plain m-select with optgroups. It is built for thirteen types while only three work, because a picker that grows from three loose buttons to thirteen is a redesign and a grouped list that lights up is not.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.

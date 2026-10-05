# Home dashboard — design pull

Source: Claude Design bundle `Mosaic Home Dashboard` (variant **2a, Sunday first**). Cold pull: no `-snapshot.html` and no `-prompt.md` in `docs/design/`.

The canvas chrome (the “2a” badge, the paragraph about Tweaks, the 1280×800 and 390×812 frames) is the design document, not the product. What follows is the screen inside those frames.

Decisions are at the top because there is no ticket. The design wins where it and the previous home disagree. Items marked **kept** are real behaviour the design did not draw; dropping them would have been silent.

## Decisions

1. Sunday is a full-width card at the top (`.dash-sunday`), not a side column. The date is Cinzel. The theme sits under the date in EB Garamond. The other facts are a reading beside it.
2. An editor sees readiness in that card: “Not ready”, “N of M set”, the blank names, and **Fix the blanks**. When every field is set, the same place says **Every field is set** and **Open in Service Editor**. Viewers do not see that column.
3. Place cards stay the real tiles, the real gates, and the saved drag order. On this page the name is Libre Franklin and the medallion is a filled primary plate. Cinzel stays on the wordmark and the Sunday date. Shepherd cards are unchanged.
4. Under the cards, two lines when there is something to say: what you are down for (Commitments) and what is on this week (Calendar). Empty lines are not shown. Sample names in the design are not data.
5. The seal’s rings drift behind the page (`.dash-ambient`). `prefers-reduced-motion` holds them still. The design’s Tweaks speed control is the canvas, not a setting in the app. The motion is the slow speed.
6. The phone home follows the phone frame: Sunday card first, a warning bar when an editor’s Sunday is not ready, then a two-column tile grid without descriptions. The phone keeps its own menu bar, Lucide icons, and the destinations it already has.
7. **Kept:** the swap line (`swaps-notice.js`) still mounts under the Sunday card. The design did not draw it. **Kept:** baptism and pastoral prayer still read in the Sunday card. **Kept:** a signed-out visitor still sees the public Sunday and the public tiles. **Kept:** the phone’s notification ask and the link to the desktop site.

## Real

- Header: menu, seal, “Mosaic Services”, the signed-in name, level, and avatar.
- This Sunday’s date, theme, sermon, preacher, service leader, music leader.
- The Order of Service checklist (blank fields and hymns not linked to the book) and who may fix it (editor, elder, admin, super admin).
- **Fix the blanks** opens the service editor with `validate=true`. **Open in Service Editor** and **Create Service** open it plain.
- Place tiles and their stored keys (`hymn-directory`, `calendar`, `service-calendar`, and the gated cards). Drag-to-reorder saved on the user.
- Irregular services are not scored as unfinished.
- Empty, missing, and failed readings for Sunday.
- Phone home tiles and their gates. Phone navigation into the service editor.

## New

- Sunday-first layout, replacing the side Glance column.
- Readiness as a fraction and a short blank line inside the Sunday card, instead of a banner above the page.
- One primary action in that card: fix the blanks, or open the editor, not both at once.
- Place-card type and medallion on home (sans name, filled plate). Five across from 1100px.
- “Your places” count, and “Drag to rearrange” beside it when the order can be saved.
- Commitments line and this-week line, fed by the real commitment list and the real calendar.
- Ambient rings, including pointer parallax, still under reduced motion.
- Phone: Sunday before the tiles; warning bar instead of an always-on editor button.

## Scaffolding (not built)

- Jonathan, JH, Daniel Okafor, Mark Lindqvist, Hannah Pryor, Sarah, 11 October, Psalm 23, Elders’ Meeting, the nursery cover, “14 of 17”.
- The Tweaks control for motion speed.
- Tile groups (Sunday / People / Tools / System). The frame shows one flat grid.
- Phone tiles the phone does not have (MCP Manager, Printables).

## Dropped, and why

- The top-of-page warning banner. The same words now live in the Sunday card, which is where the design put the one thing that asks for action.
- The phone’s always-visible **Open in Service Editor** button. The phone frame uses the warning bar, and only when the Sunday is not ready. Services remains the way in otherwise.

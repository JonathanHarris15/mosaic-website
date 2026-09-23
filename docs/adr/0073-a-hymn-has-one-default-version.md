# ADR 0073 — A hymn has one default version

**Status:** Accepted
**Date:** 2026-09-23
**Ticket:** MS-661

A hymn in the book can be sung more than one way. Each way is a version: a
name and its sheet-music pages, in the order an editor arranged them. Nothing
on the hymn said which way prints. Every reader — a printable, the service
guide, the music PDF — took the first version in the list and called that the
sheets. An editor who put the new tune second, because that is the order they
wanted to read, silently printed the old one. Moving the new tune to the front
to make it print would have scrambled the order they had just chosen.

**Exactly one version is the default, and that is the one that prints.** An
editor marks it with a star. The star is a flag on that version, not a
reordering: the list stays in the order it was arranged, and a second version
does not become the default just by being added. A hymn that has never been
starred still prints its first version, which is what the book already did, so
nothing already in print changes until somebody stars a different one. A hymn
with no versions prints no pages. Deleting the default makes the next
remaining version the default. There is no per-Sunday choice of version; a
Sunday names a hymn, and the hymn's default is what the sheets are.

The other way was to keep "first in the list" as the only rule and teach
editors that the top version is the one that prints. That needs no flag, and
every reader already does it. It was rejected because the order of the list
is how a person reads the hymn, and the thing that prints is a different
fact. Folding them together is how the star would keep getting lost.

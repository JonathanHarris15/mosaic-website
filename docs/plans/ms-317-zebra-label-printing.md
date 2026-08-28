# MS-317 — Printing a nametag on the Zebra from the kiosk browser

**The question:** how does a page on our https site get a child's nametag out of
the Zebra ZD421 standing next to the Windows kiosk in the foyer?

---

## DECIDED — 2026-08-27

Jono chose **Option 2: render the nametag as HTML and print it through the Zebra
Windows driver already on the kiosk.** No new software in the foyer. Browser Print
stays on the shelf as the fallback if the printed label is not good enough.

**Confirmed label stock: 75mm x 50mm** (about 2.95in x 1.97in - standard Zebra
3x2 stock). Every size in this document was written against a guessed 2in x 3in
and has been corrected to 75mm x 50mm below. Note the shape flipped: the label is
**wider than it is tall**, so the nametag layout is landscape, not portrait.

**Also asked for: no print dialog.** See "Skipping the print dialog". Short
answer - Chrome gets close but not perfect: `--kiosk-printing` auto-clicks the
Print button, so expect a brief flash of the preview window on every label. There
is no way to remove that flash in Chrome.

Open questions 3 (label size) is now answered. The rest still need someone at the
kiosk.

---

## Recommendation

**Try the plain browser print first: an HTML label sized with `@page { size: 75mm
50mm; margin: 0 }`, printed through the Zebra Windows driver that is already on that
machine.** It installs nothing. Chrome enterprise policies pin the printer and the
paper size, and `--kiosk-printing` skips the dialog. If the label comes out
readable and the barcode scans, we are done, and this epic never grows a program we
have to keep alive in a church foyer.

**Fall back to Zebra Browser Print** if the printed label is not good enough, or if
we later decide the page genuinely needs to know the printer is out of labels.
Browser Print sends real ZPL, covers the ZD421, and is the only option that can
report printer status back to the page — but it means installing and babysitting a
tray app, and its last release was February 2023.

**The reason, in one line:** the thing that decides this is not what can reach the
printer — four of the five options can — but what has to keep running on an
unattended machine on a Sunday morning, and only one option has nothing to keep
running.

### Why not Browser Print first, given it prints better?

Because the argument that would have won it turned out to be false. We assumed
Planning Center drives this printer through Zebra Browser Print, which would mean
Browser Print is already installed and working on that machine and we would be
inheriting it, not adding it.

**Planning Center does not use Zebra Browser Print.** They wrote their own local
helper — the "Check-Ins printing app", on localhost ports 8181/8282/8383/8484. So
choosing Browser Print means adding software to the kiosk, and it is software with
no release in three and a half years. What we *do* inherit is the Zebra Windows
driver, which is exactly and only what the browser-print path needs.
— <https://help.planningcenter.com/en/138282-set-up-a-zebra-printer.html>
— <https://help.planningcenter.com/en/138284-external-sites-needed-for-check-ins.html>

### What we give up, stated plainly

Two things, and I think both are worth giving up.

**1. The page learns nothing about the printer.** `window.print()` returns
`undefined`, throws nothing, and `afterprint` fires whether or not a label came
out. Printer off, out of labels, lid open, jammed — the page cannot tell. That
sounds worse than it is: a volunteer is standing at the kiosk and sees a missing
label in about two seconds, and Planning Center — the incumbent, with a bespoke
helper and full device access — still answers "the printer is unhappy" with a test
print button and "unplug it for ten seconds". That is the bar. We can clear it with
a "Print again" button and a "Printer trouble?" help card.

**2. The label is drawn as graphics, not as native ZPL.** The ZD421 head is one bit
per dot at 203 dpi. Web text rendered by Chrome and dithered by the driver will be
softer than text drawn by the printer's own font engine, and a barcode is the part
that could actually fail rather than just look worse. Two things soften it: the
security code is designed to be **typed as well as scanned** on Planning Center's
own labels, so a weak barcode degrades instead of breaking check-out; and if the
barcode is the only casualty we can drop to a bigger, plainer human-readable code.

### The one thing that flips this decision

The printed label itself. Everything above is reasoning; whether a rasterised
nametag looks acceptable and scans is a **twenty-minute test at the kiosk**, not an
argument. The spike below is written to settle it. If the label is poor, go to
Browser Print without hesitation — the ZPL is written and waiting in this document
and is not wasted work.

### Options at a glance

| Option | Installs on kiosk | Something to keep running? | Page learns of failure? | Verdict |
|---|---|---|---|---|
| **2. Driver + `window.print()`** | nothing new | **no** — 4 Chrome settings | **nothing** | **recommended** |
| **1. Zebra Browser Print** | tray app + JRE, + Chrome policy | yes, a tray app | **yes** — `~HQES` status | **fallback** |
| 5. Helper we write | our service, + Chrome policy | yes, and we own the bugs | yes, best of all | last resort |
| 3. Raw TCP 9100 from cloud | a VPN/tunnel on site | yes | in the backend only | dead |
| 4. WebUSB / Web Serial | WinUSB, **replacing** the Zebra driver | no | yes | dead |

---

## The deciding fact: can an https page talk to a local service?

**Yes — but since Chrome 142 the user has to grant a permission first, and on a
kiosk you pre-grant it with an enterprise policy.** This is the single fact that
decides the shape of the whole thing, so here it is in full.

There are two separate rules, and they are often confused.

### Rule 1 — mixed content: not a problem

Browsers block an https page from loading http subresources. But the block has a
carve-out, and the carve-out is written against the **URL being fetched**, not
just against the page's own origin.

W3C Mixed Content, *Should fetching request be blocked as mixed content?*:

> Return **allowed** if one or more of the following conditions are met: … request's
> URL is a potentially trustworthy URL.

— <https://www.w3.org/TR/mixed-content/>

And W3C Secure Contexts, *Is origin potentially trustworthy?*:

> If origin's host matches one of the CIDR notations `127.0.0.0/8` or `::1/128`,
> return "Potentially Trustworthy".
>
> If the user agent conforms to the name resolution rules in
> [let-localhost-be-localhost] and one of the following is true: origin's host is
> "localhost" or "localhost." … then return "Potentially Trustworthy".

— <https://www.w3.org/TR/secure-contexts/>

So `https://our-app.web.app` fetching `http://127.0.0.1:9100` is **not** mixed
content. It never was. Every "you can't call http from https" answer you will find
about Zebra Browser Print is wrong on this point, or is about Safari, which was
stricter.

### Rule 2 — Local Network Access: this *is* the problem

Chrome 142 added a new gate that has nothing to do with mixed content. Any request
from a public-origin page to a loopback or private address now needs the user's
permission.

Chrome's own announcement:

> The Local Network Access permission prompt is launching in Chrome 142.

> …any request *from* the public network *to* a local network or loopback destination.

Loopback explicitly counts — "the IPv4 loopback prefix (`127.0.0.0/8`)" and "the
IPv6 loopback (`::1/128`)".

— <https://developer.chrome.com/blog/local-network-access>
— spec: <https://wicg.github.io/local-network-access/>
— <https://chromestatus.com/feature/5152728072060928>

The prompt reads roughly *"Look for and connect to any device on your local
network."* Granting it also relaxes mixed content for those requests, so the two
rules resolve together.

**Why this matters more than anything else in this document:** a foyer kiosk is
unattended. Nobody is standing there to click "Allow". If that prompt appears on a
Sunday morning, nametags stop.

### The fix, and it is a real one

Chrome ships enterprise policies that pre-grant the permission per site, so no
prompt ever appears:

- `LocalNetworkAccessAllowedForUrls` — "Network requests initiated from websites
  served by matching origins are not subject to Local Network Access checks."
- `LoopbackNetworkAccessAllowedForUrls` — the narrower loopback-only version.
- `LocalNetworkAccessRestrictionsTemporaryOptOut` — the blunt escape hatch.

— <https://chromeenterprise.google/policies/local-network-access-allowed-for-urls/>
— <https://chromeenterprise.google/policies/local-network-allowed-for-urls/>
— <https://chromeenterprise.google/policies/local-network-access-restrictions-temporary-opt-out/>

On a Windows kiosk that is one registry key or one Group Policy setting, set once
at install. It is not a per-visit click.

**Verdict: the https problem is real but solved, and the solution is a one-line
config on the kiosk.** Any option that relies on a local service — Zebra Browser
Print, or a helper we write — must ship with that policy as part of its install,
and must be tested on current Chrome, not on a doc from 2020.

### What Browser Print actually listens on

Zebra's own Browser Print User Guide, *Incompatibilities*:

> Browser Print cannot run when any other program is using the computer's **9100 or
> 9101 ports**. These ports are used for RAW printing; that is, sending commands to
> the printer in a printer language, such as ZPL.

So: **http on 9100, https on 9101.** The install walkthrough in the same guide
shows the browser landing on `https://localhost:9101/ssl_support` with the message
"SSL Certificate has been accepted. Retry connection."

And on the certificate, from the guide's change log for version 1.2.1 (October 2018):

> **Https no longer uses a self signed certificate**, removing the need to accept
> the certificate and removing the "Insecure" warning browsers displayed when using
> the self-signed certificate.

So Zebra does document an https story, it has since 2018, and it is on port 9101.
Older write-ups telling you to enable `chrome://flags/#allow-insecure-localhost`
are describing pre-1.2.1 behaviour.

— <https://www.zebra.com/content/dam/zebra_new_ia/en-us/solutions-verticals/product/Software/Printer%20Software/Link-OS/browser-print/zebra-browser-print-user-guide-v1-3-en-us.pdf>

### Is the ZD421 supported by Browser Print? Yes.

This looked like a killer for a while. The Browser Print User Guide **v1.3** (Jan
2020) lists supported printers model by model — ZD410, ZD420, ZD500, ZD500R,
ZD620, ZQ610, ZQ520, ZQ620, ZT220, ZT410, GX420d, KR403, QLn220, QLn320,
TLP2824+ — and the **ZD421 is not on it**. The ZD421 shipped after that guide.

The **v1.3.2** guide (February 2023) rewrote the list by *series*:

> ZT200 Series; ZT400 Series; ZT500 Series; ZT600 Series
> **ZD400 Series**; ZD500 Series; ZD600 Series
> ZQ300 Series; ZQ500 Series; ZQ600 Series
> ZQ300 Plus Series; ZQ600 Plus Series
> QLn Series; IMZ Series; ZR Series
> G-Series; LP/TLP2824-Z; LP/TLP2844-Z; LP/TLP3844-Z

The ZD421 is a ZD400 Series printer, so it is covered.

— <https://www.zebra.com/content/dam/zebra_dam/en/guide/portfolio/zebra-browser-print-user-guide-v1-3-2-en-us.pdf>

### But: Browser Print has not shipped since February 2023

That v1.3.2 guide is the current one, and its change log ends at 1.3.2, February
2023. So the newest release of this software is roughly three and a half years
old. It is not marked end-of-life, and Zebra still offers it from the support
downloads page, but nothing has been fixed in it for a long time.

The sharp edge: **v1.3.2 predates Chrome 142 by more than two years.** Its
"Browsers" row still says "Chrome 75+". Zebra has not written a word about Local
Network Access. Browser Print itself does not need to change — the permission is
enforced on the browser side, not the service side — but nobody at Zebra has
tested this and there is no fix coming if it does break.

— <https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html>

### Is the Chrome policy permanent, or an escape hatch that expires?

Worth checking, because building on a temporary flag would be building on sand.
There are two policies and only one of them is temporary.

- `LocalNetworkAccessRestrictionsTemporaryOptOut` — **temporary, and dated.**
  Google says it "will be removed after M152", i.e. Chrome 152 on Windows, Mac,
  Linux, Android and ChromeOS drops it. Do not build on this one.
- `LocalNetworkAccessAllowedForUrls` — **the long-term one.** Google's own answer
  to "when will the opt-out be removed" points here: "Long term, the policy
  `LocalNetworkAccessAllowedForUrls` can be used to allowlist URL patterns that
  should be automatically granted the Local Network Access permission as an
  alternative to this temporary opt-out policy."

So: allowlist our own origin with `LocalNetworkAccessAllowedForUrls`. That is the
supported, permanent route, and it is narrow — it grants the permission to our
site only, not to every site the kiosk visits.

— <https://chromeenterprise.google/policies/local-network-access-restrictions-temporary-opt-out/>
— <https://support.google.com/chrome/a/thread/400567740>
— <https://chromeenterprise.google/policies/local-network-access-allowed-for-urls/>

---

## Option 2 — Windows driver + `window.print()`

The coordinator is right to push on this one. Technical reach is not the deciding
question; upkeep is. This option is the only one that installs **nothing new**.

### How it works

We build the nametag as a normal HTML element, size the print page to the label,
hide everything else, and call `window.print()`. Windows' print spooler hands it
to the ZD421's ZDesigner driver, which turns it into dots. It is the same trick
the Service Guide already uses — clone into a hidden layer, print.

The CSS is short and it is real spec, not a hack. CSS Paged Media Level 3 defines:

    size: <length>{1,2} | auto | [ <page-size> || [ portrait | landscape ] ]

Two lengths mean width then height of the page box.
— <https://www.w3.org/TR/css-page-3/>

So:

```css
@page { size: 2in 3in; margin: 0; }

@media print {
  body > * { display: none !important; }
  #label   { display: block !important; }
}
```

Hiding everything but the label with `@media print` is MDN's documented pattern.
— <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing>
— <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Paged_media>

### Does Chrome honour a physical size through a thermal driver?

Half. Chrome will *lay out* the page at 2in × 3in — the `size` descriptor has
worked since Chrome 15. What it will not reliably do is change the **paper size
the print dialog picks and hands to the driver**. There is a long-open Chromium
request, "Respect CSS @page property when selecting paper size", filed on the old
tracker as 238303 and carried over as issue 41010929. It is still open.
— <https://issues.chromium.org/issues/41010929>
— <https://bugs.chromium.org/p/chromium/issues/detail?id=238303>

The consequence: your CSS says 2×3, the driver may still be set to whatever stock
was last selected, and you get a label rendered at the wrong scale or clipped.

The fix is not CSS, it is policy. `PrintingPaperSizeDefault` pins the paper size
Chrome asks for, with a custom size given in **micrometres** — 2in = 50 800 µm,
3in = 76 200 µm:

```json
{"name": "custom", "custom_size": {"width": 50800, "height": 76200}}
```

The policy carries its own warning, and it points straight back at the same weak
link: *"If the page size is unavailable on the printer chosen by the user, this
policy is ignored."* The ZDesigner driver has to expose that stock size.
— <https://chromeenterprise.google/policies/printing-paper-size-default/>

### Skipping the print dialog

Two pieces:

- `--kiosk-printing`. Chromium's own source defines the switch as
  `kKioskModePrinting = "kiosk-printing"` with the comment **"Enable automatically
  pressing the print button in print preview."** So it does not remove print
  preview, it auto-clicks Print in it.
  — <https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_switches.cc>

  Note what that comment implies: preview still opens. There is a long-standing
  Chromium issue (169004 / 40959316) about a roughly one-second flash of the print
  dialog before it auto-submits. On a foyer kiosk that is cosmetic, not fatal, but
  a volunteer will see a flicker on every check-in.

- Pinning the printer. `DefaultPrinterSelection` takes a JSON rule of `idPattern`
  and `namePattern` regexes matched against printer id and name, first match wins.
  That pins the ZD421 queue by name so preview never picks Microsoft Print to PDF.
  — <https://chromeenterprise.google/policies/default-printer-selection/>
  `PrintPreviewUseSystemDefaultPrinter` is the blunter companion: use the OS
  default rather than the most recently used printer.
  — <https://chromeenterprise.google/policies/print-preview-use-system-default-printer/>

So silent printing to a named Zebra at a pinned size is achievable, but it takes
three Chrome policies plus a command-line switch, all set on the kiosk.

### What must stay installed on the kiosk

**Nothing new — the Zebra Windows driver that is already there.** But Chrome must
launch with `--kiosk-printing` and carry three printing policies, and that
configuration is a thing that can be lost.

### Who keeps it running

Nobody, in the good case. There is no service to crash, no tray icon to close, no
port to be stolen, no separate program to update. A Windows update that breaks the
Zebra driver would break Planning Center too, so it is not a risk we are adding.

### How a print failure surfaces

**It does not.** This is the honest cost and it is a big one.

`window.print()` returns `undefined`. It is synchronous, it throws nothing, and
there is no callback or promise.
— <https://developer.mozilla.org/en-US/docs/Web/API/Window/print>

`beforeprint` and `afterprint` are plain lifecycle `Event` objects with no payload
about the outcome. `afterprint` fires whether or not a label came out.
— <https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event>

Printer off, out of labels, lid open, jammed: the page learns **nothing**. Windows
may show a print-queue balloon on a screen nobody is looking at. The volunteer
finds out when a parent asks where the nametag is.

### Print quality

The ZD421 head is a one-bit-per-dot device at 203 dpi. Native ZPL text uses the
printer's own bitmap fonts and its own barcode engine, which are designed for that
grid. Anything going through the Windows GDI print path arrives as a rasterised,
dithered bitmap of anti-aliased web text. At 203 dpi that is visibly softer, and a
barcode rendered as a web image rather than by `^BC` is the part that worries me
most — a dithered barcode can fail to scan where a native one would not.

I want to be careful here. **Zebra does not document this comparison.** Their ZD421
support pages cover driver install mechanics only. The rasterisation argument
follows from how GDI thermal drivers work, not from a Zebra statement, so treat the
severity as **unverified until we print one and look at it**. That is precisely
what the spike is for.
— <https://docs.zebra.com/us/en/printers/desktop/zd421-and-zd621-desktop-printers-user-guide/setup-for-windows/installing-the-windows-printer-drivers.html>

### Zebra's own position

Zebra's *Web Printing Solutions* guide enumerates six supported ways to print to a
Zebra printer from the web: TCP/IP back-end, Cloud Connect, Browser Print,
Enterprise Browser, RhoMobile, URL Schema. **Driver plus `window.print()` is not
one of them.** Every route Zebra blesses sends print jobs as ZPL data, not through
the OS print pipeline. Zebra does not warn against this approach; Zebra simply does
not acknowledge it exists.
— <https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/web-printing-solutions.pdf>

---

## What Planning Center actually does — and the answer is not what we hoped

The hope was: PCO drives this Zebra through Zebra Browser Print, so Browser Print
is already on the foyer machine, and picking it costs us nothing new.

**That hope is wrong. Planning Center does not use Zebra Browser Print.** They
wrote and ship their own.

> Planning Center doesn't have direct access to your computer's hardware. To gain
> access, the Check-Ins app includes the **Check-Ins printing app**, which works as
> a widget that translates Planning Center code to the printer.

— <https://help.planningcenter.com/en/138282-set-up-a-zebra-printer.html>

It is the same *shape* as Browser Print — a local service a page talks to — on
different ports. Their network allowlist doc names them:

> Some ports are required for Check-Ins to connect to the user's computer …
> **8181, 8282, 8383, or 8484** for the Printing App

— <https://help.planningcenter.com/en/138284-external-sites-needed-for-check-ins.html>

So the honest accounting: **choosing Browser Print means adding software to the
kiosk, not inheriting it.** We would remove PCO's helper and install Zebra's.

### The one thing we *do* inherit

The **Zebra Windows driver**. PCO's own setup instructions have you install it and
then check that "Zebra" appears in the computer's printer settings, and they call
USB "the most reliable setup". So the driver is on that machine, it is bound to the
ZD421, and it works — which is exactly what Option 2 needs and nothing more.
— <https://help.planningcenter.com/en/138283-software-and-hardware-for-check-ins.html>

### PCO names our exact printer

Their compatibility table lists **ZD421d / ZD421t as compatible with desktop
(USB)**, and also with Android. So whatever SKU we have is a model PCO ships
against today. (They call out LP2844Z and the ZSB series as *not* compatible.)
— <https://help.planningcenter.com/en/138282-set-up-a-zebra-printer.html>

### Their history is a warning, and it needs reading carefully

In 2017 PCO wrote:

> One of the greatest pain points … has been when a browser, such as Google Chrome,
> has updated itself over the weekend. This sometimes has broken the needed ties
> between your printer and your browser, which breaks any printing abilities, and
> effectively breaks Check-Ins.

— <https://www.planningcenter.com/blog/2017/10/check-ins-for-mac-windows>

and in 2019, on shipping Direct Printing:

> By building the printing process into the Check-Ins application, we can control
> the entire printing process—from the time you open a station to when a label is
> created and sent to the printer

— <https://www.planningcenter.com/blog/2019/03/direct-printing-for-check-ins>

The naive reading is "browser printing doesn't work, don't try it." That reading is
wrong, and getting it wrong would cost us the cheapest option on the table. What
broke in 2015–17 was **browser plugins for hardware access** — NPAPI and Chrome
Apps, which Google removed. `window.print()` is not a plugin; it is a web platform
API that has worked since Netscape and is not going anywhere.

The fair reading is narrower and still worth respecting: **anything that reaches
around the browser to touch hardware is at the mercy of browser releases.** Chrome
142's Local Network Access change is that same story happening again, right now, to
exactly the localhost-helper design PCO chose. It is an argument against local
helpers, not against `window.print()`.

### What their label carries

Every check-in gets "a randomized alpha-numeric tag", unique to that person and
never reused. The security label prints "the current date and time, the security
code, and a barcode for scanning at a manned or roster station" — and the code can
be **scanned or typed**: "type the security code in the search bar on a manned
station." Churches design labels in a drag-and-drop editor with block types
(Person details, Check-in details, Text, Security code, Image, Barcode). No ZPL is
exposed to the user.
— <https://help.planningcenter.com/en/138321-checking-out.html>
— <https://help.planningcenter.com/en/138206-create-custom-labels.html>

That the code is **typeable as well as scannable** matters for us: a barcode that
scans imperfectly degrades, it does not break check-out.

### What their UI tells a volunteer when printing fails

Not much, and notably not a live printer status. Desktop stations have a "Printer
Check" screen (Ctrl+2 on Windows) with a printer dropdown, a label-type dropdown
and a "Send Test Print" button. Mobile has a "Troubleshoot" wizard. The rest of
their guidance is restart the computer, power-cycle the printer.
— <https://help.planningcenter.com/en/138282-set-up-a-zebra-printer.html>

Worth holding on to: **the incumbent product, with a bespoke local helper and full
device access, still solves "the printer is unhappy" with a test-print button and a
power cycle.** That sets the bar for how much we should pay for live status.

---

## Option 1 — Zebra Browser Print

### How it works

A small program runs on the kiosk, in the system tray, listening on **9100 (http)
and 9101 (https)**. Our page loads Zebra's `BrowserPrint.js`, asks the service what
printers it can see, and posts raw ZPL to the chosen one. The service writes the
bytes to the printer over USB or the network. Because we send ZPL, the printer's
own font and barcode engines do the drawing — sharp text, a real barcode.

Zebra's guide on wiring it in:

> Packaged with the Browser Print program … is a directory called "BrowserPrint.js"
> … It is recommended that you include this JavaScript class in your web page

    <script type="text/javascript" src="js/BrowserPrint-[version].min.js"></script>

— Browser Print User Guide v1.3.2, *Integration*

The features list confirms what we need: auto-discovery of USB and network Zebra
printers, two-way communication, a default device set independently of the Windows
default printer, ZPL II, and image printing.

### Printer status back to the page — yes, and this is its best argument

The v1.3.2 *Supported Features* appendix, "Bi-directional Communications":

> `^H` and `~H` ZPL commands (except `^HZA`), and the following Set/Get/Do (SGD)
> commands: `device.languages`, `appl.name`, `device.friendly_name`,
> `device.reset`, `file.dir`, `file.type`, `interface.network.active.ip_addr`,
> `media.speed`, `odometer.media_marker_count1`, `print.tone`

`~HS` (host status) and `~HQES` (host query, error status) are both `~H` commands,
so both are available. That means the page really can ask the printer "are you out
of labels? is the head open?" and get a machine-readable answer. **No other option
here can do that.**

### What must stay installed on the kiosk

**Zebra Browser Print (a Java-based tray app with its own bundled JRE), plus a
Windows startup entry, plus a Chrome `LocalNetworkAccessAllowedForUrls` policy for
our origin.** Three things, and all three must be right on a Sunday morning.

### Who keeps it running

Us. And it is more fragile than it looks:

- It is a tray app, not a Windows service. The guide's own uninstall instructions
  are "right click the icon, select Exit." Anyone can close it. It gets restarted
  by a Startup-folder shortcut the installer adds — a shortcut a cleanup tool or a
  Windows reset can remove.
- It will not start if anything else holds port 9100 or 9101:
  > Browser Print cannot run when any other program is using the computer's 9100 or
  > 9101 ports … Browser Print will display a message stating that it cannot print
  > in the current state.
  A message on the kiosk screen, which nobody reads.
- The site must be on its **Accepted Hosts** list. First run pops "localhost wants
  to access your Zebra Devices. Allow?" — a native dialog. On an unattended kiosk
  that has to be pre-answered or it blocks.
- From v1.3.0 on: "Application now requires all devices to have been 'discovered'
  in order to be used. Websites will no longer be able to specify their own
  devices." So the printer must be discoverable and a default set in the tray app's
  Settings, by hand, at install.

### Updates

There are none. **The current release is 1.3.2, February 2023.** Nothing has
shipped in three and a half years. If Chrome breaks it, we wait — or we stop using
it. Its own docs still say "Chrome 75+", two years before the browser change that
now gates it.

### Licensing and vendoring — a real snag for us

Our rule is: no CDN, no npm at runtime, every third-party library vendored into
`public/vendor/` and checked into the repo. `BrowserPrint.min.js` is a plain script
file, so mechanically it vendors fine.

The problem is the terms. The SDK is **not on npm and not on a public URL** — it is
behind a request form on Zebra's site ("This developer tool for Zebra barcode
printers is available on a request basis. Please complete the brief form to obtain
access"), and the client app shows a Zebra EULA on first run describing itself as
RESTRICTED SOFTWARE with a licence granted to "End-User Customer" for internal
business purposes. That is not an open-source licence, and there is no published
statement that the JS library may be redistributed in a public repo.

**Action if we go this way: read the EULA that ships in the download before
committing the file, and if in doubt keep the repo private for that path or ask
Zebra.** I could not resolve this from public pages — the EULA text is only in the
installer.
— <https://developer.zebra.com/products/printers/browser-print>
— <https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html>

### How a print failure surfaces

**Best of any option.** Three layers:

1. Service not running → our `fetch` to `127.0.0.1:9100` fails outright. The page
   knows immediately and can say "printing service isn't running".
2. Printer not found → discovery returns no device, or the send errors.
3. Printer unhappy → `~HQES` comes back with paper-out / head-open / paused flags,
   and the page can say "the printer is out of labels."

### Windows vs Mac

Both. The guide covers Windows 7/10 and macOS 10.10+, and Zebra now also offers an
Android build. Not our problem today — the kiosk is Windows — but it does not lock
us in.

### One gap I could not close

`developer.zebra.com` refuses automated fetches (HTTP 403), so I could not quote
the exact JavaScript method names from Zebra's own API reference. The names in
common circulation — `BrowserPrint.getDefaultDevice`, `getLocalDevices`,
`device.send`, `device.sendThenReadThenClose` — are **unverified**; they come from
third-party wrappers, not from a page I could read. The full API reference ships
inside the download, in `Documentation\BrowserPrint.js`, per the user guide. Read
it there rather than trusting a blog.

---

## Option 3 — ZPL over raw TCP port 9100

### How it works

Every networked Link-OS printer listens on **TCP 9100** as a raw socket. Open it,
write ZPL bytes, done. No handshake, no protocol. Zebra documents the port and the
`ip.port` SGD command that changes it.
— <https://support.zebra.com/article/000031643>
— <https://docs.zebra.com/us/en/printers/software/zpl-pg/r-sgd-wireless-sgd-wireless-commands/r-sgd-wireless-ip-port.html>

For us that would mean Cloud Functions opening a socket to the printer.

### Why this is not realistic, plainly

**Google's cloud cannot reach a printer inside a church's network.** Cloud
Functions v2 does support outbound TCP through Direct VPC egress — but that only
gets you into *Google's own VPC* and whatever is peered to it via Cloud VPN, Cloud
Interconnect or VPC peering. There is no path from a Cloud Function to an arbitrary
device behind a church's router.
— <https://docs.cloud.google.com/functions/docs/running/direct-vpc>
— <https://docs.cloud.google.com/vpc/docs/serverless-vpc-access>

To make it work we would need a tunnel terminating on site — a VPN box or
Cloudflare Tunnel — which is a bigger piece of installed infrastructure than any
helper program we were trying to avoid. And the church almost certainly has a
dynamic IP and no port forwarding.

Then the security problem. Port 9100 has no authentication. Zebra sells a separate
product, **PrintSecure**, precisely to "configure your printers to use secure
connections … block unauthorized access" — which tells you what the default is.
— <https://www.zebra.com/ap/en/products/software/barcode-printers/link-os/printsecure.html>

Port-forwarding an unauthenticated print socket to the open internet would let
anyone on earth print anything on the children's nametag printer. **Dead path. Do
not pursue.**

### Where it does live on

Not from the cloud — but a helper *on the LAN* (Option 5) can use port 9100
happily, and that is the sane version of this idea.

### How a print failure surfaces

Socket errors would reach Cloud Functions, not the browser, so the page would learn
only what we chose to relay. Moot, given the above.

---

## Option 4 — WebUSB / Web Serial straight from the browser

### How it works, in theory

`navigator.usb.requestDevice()` from a secure context and a user gesture, then
claim the interface and write ZPL. No install at all. It sounds perfect.
— <https://developer.mozilla.org/en-US/docs/Web/API/USB/requestDevice>

### Why it fails on Windows, specifically

Chrome's own documentation states the blocker:

> the basic requirement is that a device should not already have a driver claiming
> the interface the page wants to control

and notes that on Windows, unlike other platforms, a USB device cannot be opened by
a web page unless the **WinUSB** driver is loaded for it.
— <https://developer.chrome.com/docs/capabilities/build-for-webusb>

Microsoft's WinUSB docs spell out what loading it means: `Winusb.sys` is installed
**as the device's function driver**, replacing whatever owns the interface.
— <https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/winusb-installation>

So on our kiosk the sequence is: rip out the Zebra printer driver, put WinUSB in
its place, and the printer disappears from Windows. Planning Center stops printing.
Nothing else on the machine can print to it. **That is a worse install burden than
any helper program, dressed up as "installs nothing".**

The ZD421 gives no way out. Zebra's USB interface page for the ZD421/ZD621
documents plug-and-play USB 2.0 and points at the Windows driver. Zebra does not
mention WebUSB, WinUSB or a WebUSB platform descriptor anywhere.
— <https://docs.zebra.com/us/en/printers/desktop/zd421-and-zd621-desktop-printers-user-guide/c-zd620-420-setup/c-zt4x1-connect-the-printer-to-a-device/t-zd421-zd621-ug-connecting-your-printer-to-a-computer/r-zd620-420-usb-interface.html>

### Web Serial

Only reaches devices that present a serial port — a real one, a USB CDC-ACM
emulation, or Bluetooth SPP. A ZD421 on its USB printer interface is none of those.
You would need Zebra's **optional serial port module** and an actual serial cable.
— <https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API>
— <https://docs.zebra.com/us/en/printers/desktop/zd421-and-zd621-desktop-printers-user-guide/setup/connecting-your-printer-to-a-computer/serial-interface.html>

### Browser support

Chromium only. Not Firefox, not Safari, for WebUSB.
— <https://developer.mozilla.org/en-US/docs/Web/API/USB>

### What must stay installed

A WinUSB driver replacing the Zebra one — and then normal Windows printing is gone.

### How a print failure surfaces

A rejected transfer throws, so in principle the page learns a lot. Irrelevant.
**Dead path.**

---

## Option 5 — a small local helper we write

### How it works

A tiny program on the kiosk listening on localhost. The page POSTs ZPL to it; it
writes the bytes to the printer. Architecturally identical to Browser Print and to
Planning Center's own Printing App — which is a decent sign it is the right shape,
and also a sign of how much work it is, since PCO staff a team on theirs.

Two ways to get raw ZPL to a driver-installed printer on Windows:

**1. The spooler's RAW datatype — the correct way.** `OpenPrinter` →
`StartDocPrinter` with `DOC_INFO_1.pDatatype = "RAW"` → `StartPagePrinter` →
`WritePrinter` → `EndPagePrinter` → `EndDocPrinter` → `ClosePrinter`.
— <https://learn.microsoft.com/en-us/previous-versions/troubleshoot/windows/win32/win32-raw-data-to-printer>
— <https://learn.microsoft.com/en-us/windows/win32/printdocs/startdocprinter>
— <https://learn.microsoft.com/en-us/windows/win32/printdocs/writeprinter>

Microsoft confirms RAW skips rendering entirely:

> RAW data can be sent to a print monitor without further processing. The print
> processor just sends this data back to the spooler by calling WritePrinter

— <https://learn.microsoft.com/en-us/windows-hardware/drivers/print/raw-data-type>

That settles a question worth settling: with the RAW datatype you do **not** need
the ZDesigner driver's Passthrough Mode. RAW bypasses the driver's rendering
whatever the driver is set to.

**2. Copying a file to a shared printer** — `copy /b` to a UNC print share, or
mapping `LPT1:` to it with `net use`. The folklore route. It works, and there is no
Microsoft documentation page endorsing it, only Q&A threads. Treat as
**unverified**. Fine for a one-off test at the kiosk, not something to build on.

**Language.** In .NET there is no supported managed API for raw bytes;
`System.Drawing.Printing` renders through GDI and is documented as unsupported in
services. So it is P/Invoke into `winspool.drv` either way. From Node it is a
native addon or shelling out. Either is a compiled artifact we now build, sign and
ship for Windows.
— <https://learn.microsoft.com/en-us/dotnet/api/system.drawing.printing.printdocument>

### What must stay installed on the kiosk

**A service we wrote and now maintain, plus a Chrome `LocalNetworkAccessAllowedForUrls`
policy.** Same two things as Browser Print, except now we also own the bugs.

### Who keeps it running

Us, forever. Installer, auto-start, crash recovery, updates, code signing (or a
SmartScreen warning on every install), and a Windows-native build in a codebase
that today has no build step at all. **This is the thing the ticket says would blow
up the epic, and the ticket is right.**

### How a print failure surfaces

Genuinely good, which is the temptation. Beyond relaying `~HQES`, the helper can
call `GetPrinter` and read `PRINTER_INFO_2.Status` for
`PRINTER_STATUS_PAPER_OUT`, `PRINTER_STATUS_OFFLINE`, `PRINTER_STATUS_DOOR_OPEN`,
`PRINTER_STATUS_PAPER_JAM`, `PRINTER_STATUS_ERROR`,
`PRINTER_STATUS_USER_INTERVENTION`.
— <https://learn.microsoft.com/en-us/windows/win32/printdocs/printer-info-2>

Caveat: Microsoft makes no promise about how well those flags are populated for a
USB device — that is up to the ZDesigner driver's port monitor, and no Zebra doc
addresses it. **Unverified until tested.**

### Verdict

Only if Browser Print is ruled out on licensing and we still need status. Strictly
more work than Option 1 for a strictly worse maintenance story.

---

## A note on the Capacitor Android path

If the kiosk were an Android tablet instead of a Windows box, this whole document
would shrink. Zebra ships a native Link-OS Android SDK, Planning Center already
lists **ZD421d/421t as Android-compatible**, Browser Print has an Android build,
and Android has no WinUSB problem and no Chrome enterprise policy to set. We
already have a Capacitor 8 shell; a custom plugin wrapping Zebra's Android SDK is a
known, bounded piece of work.

But it means buying a tablet, writing our first custom Capacitor plugin, and moving
the check-in kiosk to a platform where the rest of our desktop app does not run.
Against a Windows machine that already prints these labels today, that is a bigger
change for a smaller gain. **Noted, not recommended, not pursued further.**
---

## ZPL basics — what a nametag actually is

Needed for the fallback, and worth knowing either way. Everything here is from
Zebra's *Programming Guide for ZPL II, ZBI 2, Set-Get-Do, Mirror, WML*, part number
P1099958-001 — <https://cpws.zebra.com/cpws/docs/zpl/zpl-zbi2-pm-en.pdf>. Page
references are the guide's own "ZPL Commands" page numbers.

### The wrapper

- `^XA` — **Start Format**. Opens a label (p.339).
- `^XZ` — **End Format** (p.344). The label prints when the printer sees this.

Everything between the two is one label.

### Placing things

- `^FOx,y` — **Field Origin**. x and y are **dots**, 0–32000, giving the
  **upper-left corner** of the field, measured from the `^LH` label-home point
  (p.176). Not inches. Not millimetres. Dots.
- `^LHx,y` — **Label Home**, the origin all `^FO` coordinates hang off (p.263).
- `^FD` — the field's data, up to 3072 bytes (p.167). `^FS` — **Field Separator**,
  ends the field (p.179).
- `^FBa,b,c,d,e` — **Field Block**, for wrapping and centring text in a box of
  width `a` dots, max `b` lines, justification `d` (L/C/R/J) (p.163).
- `^FWr` — **Field Orientation**, the default rotation for fields that do not set
  their own (p.183).

### Text

- `^CFf,h,w` — **Change Default Font**: font, height and width in dots, for every
  following field until changed (p.131).
- `^Af,o,h,w` — set the font for the **next field only**. `f` is the font letter,
  `o` orientation (N/R/I/B), `h`/`w` height and width in dots. Scalable fonts take
  10–32000 (p.42).
- `^A@` — the same but calling a font by file name, e.g. `E:SWISS721.TTF` (p.44).

### The barcode

- `^BYw,r,h` — module width in dots (1–10, default 2), wide-to-narrow ratio, and
  height (p.126).
- `^BCo,h,f,g,e,m` — **Code 128**. `h` height in dots, `f` = print the
  human-readable line (Y/N), `g` = put it above the bars, `m` = mode (`N`, `A` for
  automatic subset selection) (p.76).
- `^BQa,b,c,d,e` — **QR Code**. Model, magnification, error correction (p.106).

**Use `^BC`, not `^BQ`, for a security code.** Three reasons. A 1-D linear code is
what a cheap desk scanner reads best; a 4-character code is far too small to
justify a QR block; and `^BC`'s `f` parameter prints the **human-readable text
under the bars for free**, so a volunteer can read the code by eye when the scanner
is not to hand. QR needs a camera-class imager and prints no readable text at all.

### Label geometry and media

- `^PWa` — **Print Width** in dots (p.304).
- `^LLy` — **Label Length** in dots (p.264). The guide's own conversion: inches ×
  dots-per-inch. At 203 dpi that is 203.2 dots per inch.
- `^MNa` — **Media Tracking**: `N` continuous, `Y`/`W` web (gap) sensing, `M` black
  mark, `A` auto-detect (p.277). Our labels almost certainly have gaps, so `Y`.
- `^MDa` — **Media Darkness**, a relative adjustment, −30 to 30 (p.271).
  `~SD##` sets an absolute value 00–30, and the guide says the `~SD` value is
  *added to* the `^MD` value (p.307).
- `^PRp,s,b` — **Print Rate**: print, slew and backfeed speed, 1–14 (p.301).
- `^PQq` — **Print Quantity** (p.299).
- `~JC` — force a media-sensor calibration and label-length measurement (p.226).
  Note: there is a `~JC` but **no `^JC`**.
- `^JUS` — save current settings so they survive power-off. It is really the `S`
  parameter of `^JU` Configuration Update (p.249). The idiom is `^XA^JUS^XZ`.

### Asking the printer how it is

This is the capability that makes Browser Print worth considering at all, so it is
worth being precise about which query to use.

**Use `~HQES`, not `~HS`.** The guide contains this trap for `~HS` (p.207):

> When a `~HS` command is sent the printer will not send a response to the host if
> the printer is in one of these conditions: MEDIA OUT, RIBBON OUT, HEAD OPEN,
> REWINDER FULL, HEAD OVER-TEMPERATURE.

In other words `~HS` goes **silent in exactly the situations we want to detect**.
An absent reply is technically information, but it is indistinguishable from a
printer that is unplugged.

`~HQES` — Host Query, Error Status (p.201, tables 14–15) — answers properly:

```
PRINTER STATUS
ERRORS:   1 00000000 0000000B
WARNINGS: 0 00000000 00000000
```

Each line is a flag, then nibbles 16–9, then nibbles 8–1. The last hex digit is an
additive bitmask:

| Bit | Value | Meaning |
|---|---|---|
| 1 | `1` | Media out |
| 2 | `2` | Ribbon out |
| 3 | `4` | Head open |
| 4 | `8` | Cutter fault |

So `B` = 8 + 2 + 1 = cutter fault, ribbon out and media out at once. **"Out of
labels" is bit 1.** That is the message we would put on screen.

Paused state is not in this error table — read it from `~HS` string 1, field `c`,
if we ever need it. `^HH` returns the whole printer configuration as readable text
(p.198), sent as `^XA^HH^XZ`.

Browser Print's supported-features table allows `^H` and `~H` commands (except
`^HZA`), so `~HQES`, `~HS` and `^HH` are all available through it.

### A complete nametag label, 203 dpi

Written for a **2.25 in × 1.25 in** direct-thermal label — 2.25 × 203 = 456 dots
wide, 1.25 × 203 = 254 dots tall. See the open questions: **measure the real stock
before trusting these numbers.**

```zpl
^XA
^PW456
^LL254
^LH0,0
^MNY
^MD0

^FO20,10^A0N,70,65^FDEMMA^FS
^FO20,88^A0N,32,30^FDJOHNSON^FS
^FO20,128^A0N,24,22^FDRoom 12 - Ducklings^FS

^BY2,3,45
^FO20,158^BCN,45,Y,N,N
^FD7X3K^FS

^PQ1
^XZ
```

Every coordinate stays inside the 456 × 254 canvas; the barcode plus its
human-readable line ends around dot 228, leaving about 26 dots of bottom margin. If
a class name can run long, wrap that third field in a `^FB416,1,,C` block rather
than a bare `^FO`.

To ask the printer how it is, send this on its own:

```zpl
~HQES
```

---

## ZD421 specifics

From the ZD421 technical specifications (03/12/2021) —
<https://www.zebra.com/content/dam/zebra_dam/en/tech-specs/zd421-tech-specs-en-us.pdf>
— and the ZD421/ZD621 User Guide —
<https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/product/zd421-zd621-ug-en.pdf>.

### Connectivity, and this matters

- **USB 2.0 and USB Host are standard on every ZD421.** Always there.
- **Ethernet is never standard.** It appears only under "Connectivity Options" as
  "Field-installable 10/100 Ethernet". Same for RS-232 serial, and for the Wi-Fi +
  Bluetooth radio. (The ZD621, by contrast, ships with Ethernet and serial built
  in — so do not read a ZD621 spec sheet and assume it applies.)

**Consequence:** unless someone bought the network module, this printer is a USB
device on the end of a cable, and every option that assumes an IP address —
including all of Option 3 — is moot before we start. **Check this first.**

Model numbers run `ZD4A0nn-xxxxxxEZ`. I could not find a Zebra-published decoder
for that string; reseller breakdowns exist but are **unverified**. Read the label
on the printer and, better, print a configuration label.

### Variants

`ZD421d` direct thermal, `ZD421t` thermal transfer (ribbon roll), `ZD421c` ribbon
cartridge. Nametags are direct thermal, so `ZD421d` is the likely one — and if it
is `d`, "ribbon out" in `~HQES` is not a state we will ever see.

### 203 vs 300 dpi — a real trap

Both exist; 203 dpi (8 dots/mm) is standard, 300 dpi (12 dots/mm) is an option.
**ZPL dot coordinates and font sizes do not rescale between them.** The programming
guide gives different dots-per-inch factors per head — 203.2 at 8 dots/mm, 304.8 at
12 dots/mm (p.264) — and expects you to recompute.

A label laid out for 203 dpi and sent unchanged to a 300 dpi head prints at roughly
two thirds the intended physical size, in the corner. There is **no ZPL command
that auto-rescales a format between resolutions** — a `^JM` dpi-switch command does
not appear anywhere in the guide, so do not rely on one existing.

Practical answer: do not hard-code dots. Compute them from a `DPI` constant, print
a config label to find out which head we have, and set the constant once.

### Media and print area

- Max print width **104 mm (4.09 in)** on the spec sheet; the live docs give per
  model figures of 108 mm direct thermal, 112 mm thermal transfer, 118 mm cartridge.
  Either way a 2 in or 2.25 in label is comfortably inside it.
- Max media roll outside diameter **127 mm (5 in)**; core 12.7 mm or 25.4 mm as
  standard.
- Max print length **991 mm (39 in)**.

### Link-OS, ZPL and port 9100

The ZD421 runs Link-OS, speaks ZPL II and EPL2, and supports SGD (Set-Get-Do)
commands. Zebra's SGD reference confirms the raw print port:

> This printer setting refers to the port number that the TCP print service is
> listening on. Normal TCP communications from the host should be directed to this
> port… Default "9100".

— <https://docs.zebra.com/us/en/printers/software/zpl-pg/r-sgd-wireless-sgd-wireless-commands/r-sgd-wireless-ip-port.html>

Only relevant if the network module is fitted.

---

## The spike — one label, twenty minutes, standing at the kiosk

Two spikes. Do **A** first; it needs no downloads. Only do **B** if A's label is
not good enough.

### Before either: check what is already on that machine (2 minutes)

This tells us whether the ticket's biggest worry is real. At the kiosk:

1. Look at the system tray (bottom right, click the `^` to expand). Is there a
   **Zebra head logo icon**? If yes, Zebra Browser Print is already installed and
   the fallback gets much cheaper.
2. Open a browser tab and go to **`https://localhost:9101/`**. If Browser Print is
   running you get a response, not a connection error.
3. Open **Settings → Bluetooth & devices → Printers & scanners**. Note the exact
   **name** of the Zebra queue — we need it verbatim for `DefaultPrinterSelection`.
   Planning Center's own troubleshooting step is to confirm "Zebra" appears in that
   name.
4. Open **Control Panel → Programs and Features** and look for both "Zebra Browser
   Print" and Planning Center's Check-Ins app.
5. Right-click the Zebra queue → Printer properties → Preferences. Note which
   **label stock sizes** the driver offers, and whether a custom size can be
   entered. This is the thing `PrintingPaperSizeDefault` depends on.
6. Peel one label off the roll and **measure it**, and note whether the roll has
   gaps between labels or a black mark on the back.

### Spike A — HTML label through the existing driver

The spike file is written and ready: **`docs/plans/ms-317-label-spike.html`**,
sized to the real 75mm x 50mm stock. Copy it onto the kiosk (USB stick, email it to
yourself, whatever is easiest) and open it in Chrome. Nothing to edit.

**Run it three ways and compare:**

1. **Plain.** Open in normal Chrome, click Print. In the dialog set Destination to
   the Zebra queue, Paper size to the label stock, Margins to None, and turn off
   "Headers and footers". Print. *This tells us whether the output is acceptable at
   all.*
2. **Trusting the CSS.** Same, but do not touch Paper size — leave whatever Chrome
   picked. If the label comes out right anyway, Chromium issue 41010929 is not
   biting us with this driver and we may not need `PrintingPaperSizeDefault`.
3. **Silent.** Close Chrome completely, then from a Command Prompt:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing "file:///C:/Users/<user>/Desktop/label.html"
   ```

   Click the Print button on the page. It should print with no dialog (expect a
   brief flash of print preview). *This tells us whether unattended printing works.*

**What to look at on the printed label, in order:**

- Is the whole thing on the label, not shifted or clipped? Does label 2 line up the
  same as label 1? (Registration drift is the thing that ruins a run of 60.)
- Is "Amelia" crisp, or grey and fuzzy at the edges?
- Is the security code readable across a foyer?

If those three are fine, **stop, and write the ticket up as done.**

### If it prints at the wrong size

Do not fight it in CSS. Set the paper size by policy. On the kiosk, as
administrator, in `HKLM\SOFTWARE\Policies\Google\Chrome`, add a string value:

- `PrintingPaperSizeDefault` =
  `{"name":"custom","custom_size":{"width":75000,"height":50000}}`
  (micrometres — the stock is 75mm x 50mm, and 1mm = 1000 micrometres)
- `DefaultPrinterSelection` = `{"namePattern":".*ZDesigner.*ZD421.*"}`
  (use the exact queue name from step 3)
- `PrintPreviewUseSystemDefaultPrinter` = `1` (DWORD)

Then restart Chrome and check `chrome://policy` shows them applied. Note the
policy's own caveat: if the printer does not offer that size, the policy is
ignored — which is why step 5 above matters.

### Spike B — Zebra Browser Print (only if A is not good enough)

Budget an hour, not twenty minutes: the SDK is behind a request form.

1. Request and download Browser Print from
   <https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html>.
   **Read the EULA in the installer before we check any of it into the repo.**
2. Run `ZebraBrowserPrintSetup-1.3.X.exe`. Accept the EULA, click OK on the
   certificate notice, click Yes on "localhost wants to access your Zebra Devices".
   Confirm the Zebra icon appears in the tray.
3. Right-click the tray icon → Settings → **Change** → pick the ZD421 → **Set**.
   Without a default device the page gets an undefined printer.
4. Pre-grant the Chrome permission so no prompt appears. As administrator, in
   `HKLM\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls`, add a
   string value `1` = our origin, e.g. `https://<our-app>.web.app`. Restart Chrome
   and confirm at `chrome://policy`.
5. Serve the sample page. Browser Print ships one at
   `C:\Program Files (x86)\Zebra Technologies\Zebra Browser Print\Documentation\Sample`
   — note the guide's warning that it **must be served by a web server, not opened
   as a local file**. Click "Send ZPL Label" and confirm a label comes out.
6. Only then wire it into our page, with the ZPL below.

### The ZPL for the nametag

See the ZD421 / ZPL section below for the label format, the barcode, and the
`~HQES` status query.
---

## Kiosk browser operation, unattended

Three pieces, none of them hard, all of them things that can quietly come undone.

**Launching.** Chrome runs with `--kiosk <url> --kiosk-printing`. Microsoft's own
kiosk mechanism for Windows 11 is **Assigned Access**, which is built around Edge
rather than Chrome
(<https://learn.microsoft.com/en-us/windows/configuration/assigned-access/>). The
usual Chrome recipe — auto-logon to a dedicated Windows account plus a shortcut in
the Startup folder — is not documented by Microsoft or Google as a supported
method. **Unverified but standard practice.** Whatever the current kiosk uses for
Planning Center already solves this; copy it.

**Printing without a dialog.** `--kiosk-printing` plus `DefaultPrinterSelection`
and `PrintingPaperSizeDefault`, as in Option 2. Expect a brief flash of print
preview on every print (Chromium issue 40959316).

**Permissions.** If we end up on a local-service path, the Chrome
`LocalNetworkAccessAllowedForUrls` policy must name our origin, or the kiosk shows
a permission prompt nobody will answer.

**The upkeep warning worth repeating:** every one of these survives a Chrome update
*only if nobody reinstalls Chrome into a fresh profile.* Whoever sets this up should
write down what they did and tape it inside the kiosk cupboard. That is not a joke;
it is the actual failure mode for church tech.

---

## Open questions — only answerable standing at the kiosk

These are the facts I could not get from any document. Numbered so they can become
sub-tasks.

**1. Is Zebra Browser Print already installed?** Expand the system tray and look
for the Zebra head icon; then browse to `https://localhost:9101/` and see whether
anything answers; then check Control Panel → Programs and Features for "Zebra
Browser Print". *Everything I found says it will not be there — Planning Center
ships its own helper on ports 8181/8282/8383/8484 — but thirty seconds settles it,
and if it is there the fallback becomes much cheaper.*

**2. Which ZD421 is it — USB only, or networked?** Ethernet and Wi-Fi are never
standard on a ZD421. Look at the back: is there an RJ-45 socket, or only USB?
Better, print a configuration label (hold the FEED button while powering on, or
send `^XA^HH^XZ`) and read off the model, the interfaces and the **print head
resolution, 203 or 300 dpi**. The dpi answer changes every coordinate in the ZPL.

**3. ~~What label stock is loaded?~~ ANSWERED: 75mm x 50mm, landscape.** Still to
check: do the labels have **gaps** between them
or a **black mark** on the backing? Gap means `^MNY`; black mark means `^MNM`. And
is it a plain nametag or a nametag plus a tear-off parent stub?

**4. What is the Zebra print queue called, exactly?** Settings → Printers &
scanners. We need the literal string for `DefaultPrinterSelection`.

**5. What paper sizes does the driver offer?** Printer properties → Preferences.
Is the label stock size in the list, and can a custom size be typed in? If not,
`PrintingPaperSizeDefault` will be silently ignored and Option 2 gets harder.

**6. Does the printed HTML label actually look acceptable?** Run Spike A. This is
the question the whole recommendation rests on.

**7. Does the barcode scan?** If we have a scanner at the check-out desk, test the
rasterised barcode from Spike A against it. If it fails, the answer is not
necessarily Browser Print — it may be a bigger, plainer, typed-only security code.

**8. What Windows account does the kiosk run as, and can we set machine-level Chrome
policies on it?** All the `HKLM\SOFTWARE\Policies\Google\Chrome` values need
administrator rights once.

**9. What Chrome version is on the kiosk?** If it is 142 or later, Local Network
Access is already enforced — which means we can check right now whether Planning
Center's own printing still works, and that is a live, free experiment in whether
the policy is needed.

---

## Sources

**The https / secure context question**
- W3C Mixed Content — <https://www.w3.org/TR/mixed-content/>
- W3C Secure Contexts — <https://www.w3.org/TR/secure-contexts/>
- Chrome, "New permission prompt for Local Network Access" — <https://developer.chrome.com/blog/local-network-access>
- WICG Local Network Access spec — <https://wicg.github.io/local-network-access/>
- Chrome Platform Status, local network access restrictions — <https://chromestatus.com/feature/5152728072060928>
- `LocalNetworkAccessAllowedForUrls` — <https://chromeenterprise.google/policies/local-network-access-allowed-for-urls/>
- `LoopbackNetworkAllowedForUrls` — <https://chromeenterprise.google/policies/local-network-allowed-for-urls/>
- `LocalNetworkAccessRestrictionsTemporaryOptOut` (removed after M152) — <https://chromeenterprise.google/policies/local-network-access-restrictions-temporary-opt-out/>
- Google's answer on when the opt-out goes — <https://support.google.com/chrome/a/thread/400567740>

**Zebra Browser Print**
- User Guide v1.3.2, February 2023 — <https://www.zebra.com/content/dam/zebra_dam/en/guide/portfolio/zebra-browser-print-user-guide-v1-3-2-en-us.pdf>
- User Guide v1.3, January 2020 — <https://www.zebra.com/content/dam/zebra_new_ia/en-us/solutions-verticals/product/Software/Printer%20Software/Link-OS/browser-print/zebra-browser-print-user-guide-v1-3-en-us.pdf>
- Product page / download (request form) — <https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html>
- Developer portal — <https://developer.zebra.com/products/printers/browser-print>
- Zebra, *Web Printing Solutions* — <https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/web-printing-solutions.pdf>

**ZPL and the ZD421**
- ZPL II / ZBI 2 / Set-Get-Do Programming Guide (P1099958-001) — <https://cpws.zebra.com/cpws/docs/zpl/zpl-zbi2-pm-en.pdf>
- ZD421 technical specifications — <https://www.zebra.com/content/dam/zebra_dam/en/tech-specs/zd421-tech-specs-en-us.pdf>
- ZD421 / ZD621 User Guide — <https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/product/zd421-zd621-ug-en.pdf>
- ZD421 Windows driver install — <https://docs.zebra.com/us/en/printers/desktop/zd421-and-zd621-desktop-printers-user-guide/setup-for-windows/installing-the-windows-printer-drivers.html>
- ZD421 USB interface — <https://docs.zebra.com/us/en/printers/desktop/zd421-and-zd621-desktop-printers-user-guide/c-zd620-420-setup/c-zt4x1-connect-the-printer-to-a-device/t-zd421-zd621-ug-connecting-your-printer-to-a-computer/r-zd620-420-usb-interface.html>
- ZD421 serial interface — <https://docs.zebra.com/us/en/printers/desktop/zd421-and-zd621-desktop-printers-user-guide/setup/connecting-your-printer-to-a-computer/serial-interface.html>
- `ip.port` SGD command (port 9100) — <https://docs.zebra.com/us/en/printers/software/zpl-pg/r-sgd-wireless-sgd-wireless-commands/r-sgd-wireless-ip-port.html>
- Default IP ports on Link-OS printers — <https://support.zebra.com/article/000031643>
- Zebra PrintSecure — <https://www.zebra.com/ap/en/products/software/barcode-printers/link-os/printsecure.html>

**Printing from the browser**
- CSS Paged Media Level 3, `size` — <https://www.w3.org/TR/css-page-3/>
- MDN, paged media — <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Paged_media>
- MDN, printing — <https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing>
- MDN, `window.print()` — <https://developer.mozilla.org/en-US/docs/Web/API/Window/print>
- MDN, `beforeprint` — <https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeprint_event>
- Chromium, "Respect CSS @page property when selecting paper size" — <https://issues.chromium.org/issues/41010929>
- Chromium `chrome_switches.cc` (`kKioskModePrinting`) — <https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_switches.cc>
- `DefaultPrinterSelection` — <https://chromeenterprise.google/policies/default-printer-selection/>
- `PrintingPaperSizeDefault` — <https://chromeenterprise.google/policies/printing-paper-size-default/>
- `PrintPreviewUseSystemDefaultPrinter` — <https://chromeenterprise.google/policies/print-preview-use-system-default-printer/>

**WebUSB / Web Serial**
- Chrome, building a device for WebUSB — <https://developer.chrome.com/docs/capabilities/build-for-webusb>
- Microsoft, WinUSB installation — <https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/winusb-installation>
- MDN, `USB.requestDevice()` — <https://developer.mozilla.org/en-US/docs/Web/API/USB/requestDevice>
- MDN, Web Serial API — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API>

**Raw printing on Windows**
- Send raw data to printers using Win32 — <https://learn.microsoft.com/en-us/previous-versions/troubleshoot/windows/win32/win32-raw-data-to-printer>
- `StartDocPrinter` — <https://learn.microsoft.com/en-us/windows/win32/printdocs/startdocprinter>
- `WritePrinter` — <https://learn.microsoft.com/en-us/windows/win32/printdocs/writeprinter>
- RAW data type — <https://learn.microsoft.com/en-us/windows-hardware/drivers/print/raw-data-type>
- `PRINTER_INFO_2` status flags — <https://learn.microsoft.com/en-us/windows/win32/printdocs/printer-info-2>
- Windows 11 Assigned Access — <https://learn.microsoft.com/en-us/windows/configuration/assigned-access/>

**Cloud egress**
- Direct VPC egress for Cloud Functions — <https://docs.cloud.google.com/functions/docs/running/direct-vpc>
- Serverless VPC Access — <https://docs.cloud.google.com/vpc/docs/serverless-vpc-access>

**Planning Center**
- Set up a Zebra printer — <https://help.planningcenter.com/en/138282-set-up-a-zebra-printer.html>
- Software and hardware for Check-Ins — <https://help.planningcenter.com/en/138283-software-and-hardware-for-check-ins.html>
- External sites needed for Check-Ins — <https://help.planningcenter.com/en/138284-external-sites-needed-for-check-ins.html>
- Create custom labels — <https://help.planningcenter.com/en/138206-create-custom-labels.html>
- Checking out — <https://help.planningcenter.com/en/138321-checking-out.html>
- Check-Ins for Mac and Windows (2017) — <https://www.planningcenter.com/blog/2017/10/check-ins-for-mac-windows>
- Direct Printing for Check-Ins (2019) — <https://www.planningcenter.com/blog/2019/03/direct-printing-for-check-ins>

---

## Things I could not verify

Listed so nobody mistakes them for settled.

- **The exact Browser Print JavaScript method names.** `developer.zebra.com`
  returns 403 to automated fetches. The API reference ships inside the download.
- **Whether we may check `BrowserPrint.min.js` into our repo.** The EULA is only in
  the installer. Read it before vendoring.
- **How much worse a rasterised label looks than native ZPL.** Zebra does not
  document the comparison. The argument follows from how GDI thermal drivers work.
  Spike A settles it.
- **Whether `PRINTER_INFO_2.Status` flags are populated usefully for a USB Zebra.**
  Depends on the ZDesigner port monitor; no Microsoft or Zebra doc addresses it.
- **The `ZD4A0nn-xxxxxxEZ` model-number decoder.** No Zebra-published key found.
  Print a config label instead.
- **A `^JM` command that rescales a format between 203 and 300 dpi.** It does not
  appear in the programming guide at all. Do not rely on it.
- **Any Browser Print release later than v1.3.2 (Feb 2023).** A "v1.3.2.489, Jan
  2025" figure circulates with no primary citation.
- **The Chrome-on-Windows autostart recipe** (auto-logon plus Startup folder).
  Standard practice, not documented by Microsoft or Google.
- **`copy /b` to a UNC print share for raw ZPL.** Works, forum-only, undocumented.

# Meeting write-up: Mosaic Manager financial system (giving, budget, expenditures, reporting)

- **Date:** Saturday, October 10, 2026 (about 66 minutes, starting around 8:58 AM CT)
- **Attendees:** Jonathan Harris; Preston Jacks (church finance and budget lead; "Speaker 1" in the recording); two other participants who are not identified in the recording ("Speaker 3" and "Speaker 4")
- **Source:** Plaud recording `of_446b2660503282a5bda1f5239d366a7f`. The write-up was requested in directive `of_30f2415001225db4555de6a02155696d` on Oct 11.
- **Status:** This is a discovery write-up, not a spec. **Per Jonathan, no tickets should be created from it yet.**

> This summarizes an automated transcript. Small details such as names, amounts, and codes may have been misheard in the recording and should be confirmed with Preston before anything gets built.

## 1. Goals

1. **Replace Planning Center giving.** The church is trying to cancel its Planning Center subscription (about $1,500/yr, roughly $92/mo), and giving is one of the last things keeping it there. Jonathan said replacement is "goal one."
2. **Expand past Planning Center** so that Mosaic Manager also covers the budget, expenditures, and reporting, and Preston's multi-spreadsheet workflow can go away. Preston: "I would love to not recreate this because this is terrible… This takes hours." He estimates he spends about **8 hours per quarter** putting giving in the right buckets and organizing expenditures.
3. Jonathan's approach is to **start from the end products Preston wants** and work backward to the data, rather than copy the current Excel workflow.

Preston described four areas that all feed each other: **giving, budget, expenditures, and reports.**

Context Jonathan mentioned: the longer-term hope is to offer this software to other churches, possibly under the name "Mosaic."

## 2. Cutover plan

- Keep using **Planning Center and the current spreadsheets through the end of 2026**, so the 2026 giving reports stay simple and the data doesn't end up in yet another place.
- **Start using Mosaic Manager in January 2027.** Preston said this gives about three months to build, and Jonathan agreed that was enough time.
- Run **test reports at the end of January and the end of February 2027** to confirm everything works before relying on it fully.
- **Don't delete the existing spreadsheets** in the first week of January.

## 3. Giving: donation intake

### Channels in scope
1. **Physical checks and cash**, entered by hand. Today Preston does this on Sunday mornings in a Planning Center batch called "checks for 2026." For each entry he records the donor name, amount, and fund. He also needs the **date received, check number, and check date** on file for year-end reports. Mosaic Manager does not process checks; Preston deposits them at the bank himself.
2. **Stripe (card and ACH).** Everything that isn't a check or cash comes through Stripe.

### Out of scope for now
- **Wires and donor-advised funds (DAFs).** A few have come in, but both Preston and Jonathan said they don't want to deal with them yet. Tracking physical gifts and Stripe is enough.

### Anonymous giving
- **Cash is the only way to give anonymously.** Every other method requires the giver's name and information. Jonathan said this simplifies things.

### Stripe consolidation
- Stripe shows two connected setups under the same church tax and business identity:
  - the one **Planning Center** created, with its own credentials
  - the one the **Squarespace** website (mosaiccstx.org) created, with separate credentials
- Some people pay through Planning Center links and others through the Squarespace site, which is why money lands in both. Today the QR code leads to a Linktree, then to the giving link.
- **Agreed direction:** clean up what exists now. After that, **Mosaic Manager gets its own Stripe credentials, and all giving goes through it.** **Squarespace should stop taking payments itself and only link to Mosaic Manager.** Preston: "that would be great if we can consolidate."
- Stripe pays out directly to the bank account, and Preston doesn't manage that step.

### Donations vs. registrations
- Two kinds of money come in: **donations** and **event registrations** (registrations currently come through the website). Preston needs to separate them, for example by **payment type**, because today he can't easily filter registrations out. Jonathan noted the new site will handle registrations, and each registration should be able to target a bucket.

## 4. Funds and buckets

- Today there is only a **General Fund**, a single checking account, and no savings account. Preston: "We're just not that sophisticated as a church," but there should be room to grow.
- Add a **Member Benevolence** fund now. This covers members giving toward another member's need, sometimes noted in a check's memo line.
- Support **adding and managing funds** later, such as International Missions or Local Relief.
- Reporting buckets include the general fund, registrations, and funds like benevolence, and staff should be able to add more.

## 5. Reporting

### Current pain
To report today, Preston:
- exports CSVs from **Planning Center**, **Stripe (Planning Center)**, and **Stripe (Squarespace)** and tries to merge them
- checks that what Planning Center shows for Stripe matches what Stripe shows
- **takes out processing fees** by hand (about **2.45% for cards**; ACH is different; Squarespace also charges fees)
- filters out registrations
- tags each gift as coming from a **member or a non-member (external)**
- enters the results into a complicated budget spreadsheet, which produces the report given to members

### What he wants
- **All giving in one place, whatever the source** (Stripe, website, or checks).
- For **any date window** (a month, a quarter, or a custom range), totals for **member vs. external giving, broken down by bucket**.
- **Member tagging done automatically** by matching givers against the member list. Jonathan called this easy.
- Fees handled so that **net and gross** are clear. This is implied by the manual fee-stripping step above.
- **Quarterly reports (Q1–Q4) generated automatically,** plus month-by-month and custom-range reports.
- Member-facing reports show **only top-level categories** (the first digit of the account code). Members don't see line items, and staff expenses aren't broken out.
- Report columns he uses today include quarter-to-date and year-to-date actuals against budget, the difference, the net for QTD and YTD, and **cash in bank** (see §7).
- **Year-end 501(c)(3) contribution statements** generated for every giver, with name, address, **each contribution by date**, and the total. These are what a giver keeps in case of a tax audit. Jonathan: "Document generation is my jam."
- Preston mentioned this as a "later problem": quarterly giving reports he currently gets from the bank side aren't always accurate or don't always match.

## 6. Budget

- Should work like the spreadsheet but online: **add and remove line items**, with **a budget amount for each line item**.
- Line items use **numeric account codes that match QuickBooks** (for example, 25xx under a 2500 parent). Preston keeps the numbers in QuickBooks aligned with the spreadsheet by hand today.
- **Parent categories add up their subcategories automatically.** A parent code such as 2500 is never an actual spending bucket: nothing is posted to it, and its own budget is zero. QuickBooks doesn't roll these up, but the spreadsheet does.
- Jonathan's proposal: **pull the line items (chart of accounts) from QuickBooks**, let Preston set a budget for each in Mosaic Manager, and pull actual spending per line item from QuickBooks.
- **Year-end spending projection** to help plan next year's budget (Preston is about to do this after Q3). A straight-line projection would work, and Jonathan offered a seasonal or time-series projection. **The projection must not fill in the budget automatically**; Preston sets the budget himself.
- Preston has a **"savings" line item** that appears as an expense so the numbers balance, even though there is no savings account yet. The money stays in checking.

## 7. Expenditures (QuickBooks)

- QuickBooks is used mainly for **expenditures**, though it tracks all bank transactions, including incoming money, which Preston loosely reconciles.
- About **250 expenditures per quarter**, most of them **under $100**.
- His current workflow is to review bank transactions in QuickBooks and **assign each one to a category** in the chart of accounts. QuickBooks' AI categorizer gets some right but isn't reliable, so he checks every one. Then he runs an "expenses by category" report and copies the numbers into the spreadsheet.
- **Proposal:** use the **QuickBooks API** (depending on how much it allows) to pull transactions and the chart of accounts, and build **better categorization from vendor history** (for example, "the last 17 times this vendor came up, it was Pastoral Discretion").
  - Flag the transactions it couldn't categorize, or wasn't confident about, for human review.
  - Use a **dollar threshold**: categorize small amounts automatically (around $75–$100 was discussed) and send larger ones for review. Preston still wants to look at the bigger ones himself.
- A third party (an assistant connected to the board) currently enters expenditures into QuickBooks monthly or quarterly and writes checks.

## 8. Cash in bank (manual for now)

- Preston and Sam **don't have access to the bank account**. It was set up while the church was under the Memphis board, and only the board has access. Staff have just the debit card, and the current balance is texted to them by the assistant who has access.
- **Cash in bank should be a field Preston enters by hand** for now. Connecting the bank account directly is a later problem.
- Preston noted the reported numbers don't fully reconcile to the bank. Small items like registration-fee surpluses (for example, $350 collected vs. $322 spent for a study) and pass-through gifts (such as benevolence money that comes in and goes back out) don't appear in the budget, but they do affect the bank balance.

## 9. Recurring commitments and software

- Preston keeps a spreadsheet of **"sending" commitments**: amounts, the months they're paid, and payment links. Examples are **$1,000/yr to the Ortezes** and **$1,000 to 9Marks**. He'd like a section in Mosaic Manager to track these, connected to the budget.
- Jonathan suggested also listing **all recurring bills and autopays**, such as Planning Center (about $1,500/yr, roughly $92/mo), Adobe (thought to be PDF/premium used by Sam), and QuickBooks. Preston said this "would be wonderful."
- If the QuickBooks API allows it, **detect recurring charges automatically**. Preston noted QuickBooks already handles recurring charges fairly well.

## 10. Side request: a church password manager (not part of Mosaic Manager)

- Staff regularly get locked out of shared accounts and end up texting each other (Oliver and Max were named) to get in. A login spreadsheet Preston made when Max was leaving was never used.
- One of the unidentified attendees suggested a **password manager**, and Preston agreed that's where he was headed. This is an **operations or tooling choice for the church, not a Mosaic Manager product feature.**

## 11. Moving banks (separate track)

- Preston and Sam have spent about a year trying to **move the church's banking from Bank of America to a local bank**. A few things have to happen first. This runs in parallel and **should not hold up the January 2027 cutover.**

## 12. Open questions

1. How much of QuickBooks does its API expose (transactions, chart of accounts, recurring charges, editing categories)? Most of §6, §7, and §9 depends on the answer.
2. Stripe cleanup: which existing Stripe setup or account should Mosaic Manager use, and how should historical Planning Center and Squarespace payments be handled?
3. What's the source of truth for **member status** used in member vs. external tagging (Mosaic Manager's people directory)?
4. How should fees be recorded per gift: gross, fee, and net? What are the ACH fee rules?
5. What exact dollar threshold should trigger automatic categorization?
6. How should the year-end statements be formatted and delivered (layout, wording, email vs. print)? What address data do we have for givers?
7. Should 2026 data come over from Planning Center and Stripe, or does Mosaic Manager start fresh on Jan 1, 2027?
8. How should the "savings" line item and pass-through gifts (like benevolence) show up in reports?
9. Should registrations be handled entirely in Mosaic Manager, and what should Squarespace still own?

## 13. Possible future work (not tickets)

> These are listed only to organize the discussion. **Per Jonathan's directive, don't file them as tickets until he says to.**

- Manual check and cash batch entry (received date, check number, check date, fund, donor; cash can be anonymous)
- Stripe integration for Mosaic Manager with its own credentials; Squarespace giving changed to a link to Mosaic Manager
- Fund and bucket management (General, Member Benevolence, plus ones added later); registrations assigned to buckets
- Payment type separating donations from registrations
- Fee capture with net and gross per fund
- Matching givers to the member list automatically (member vs. external)
- Reports by date window (month, quarter, custom) with automatic quarterly reports and a top-level-only view for members
- Year-end 501(c)(3) contribution statement generation
- Budget editor with QuickBooks-style account codes and parent categories that add up their children
- Year-end spending projection (advisory only, never fills in the budget)
- QuickBooks API integration for transactions and chart of accounts, categorization from vendor history, a review queue, and a dollar threshold
- Manual cash-in-bank field
- Tracker for recurring commitments and bills, with automatic detection from QuickBooks
- Cutover checklist: parallel run through Dec 2026, go-live Jan 2027, test reports at the end of Jan and the end of Feb

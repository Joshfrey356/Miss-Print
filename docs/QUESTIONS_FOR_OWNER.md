# Questions for the Owner

These are **not blockers**. The system runs today with sensible placeholders that can be changed. Each answer makes it match Miss Print more closely. The **"Where it goes"** column shows where the answer is entered, usually a settings screen, so no programmer is needed.

Suggested approach: go through sections 1–3 in a first 60-minute sit-down, and the rest over time.

## 1. Money & accounting

| # | Question | Why it matters | Where it goes |
|---|---|---|---|
| 1 | What accounting software do you use (QuickBooks Online, Desktop, something else, none)? | Decides the accounting integration | Phase 3 integration |
| 2 | How do you create invoices today? Who does it, and when (at pickup, at completion, monthly)? | When the "Create invoice" step appears | Workflow |
| 3 | How are invoice numbers assigned today? Should we continue your current numbering? | We can start the INV sequence at your next number | Database setting |
| 4 | How are job numbers assigned today? Do you want to keep a numbering scheme (e.g. continue from your last ticket #)? | Same, for MP-##### | Database setting |
| 5 | What sales tax do you charge (Indiana 7%)? Are any products or services non-taxable (design labor, installation)? | Tax rate and taxable flags per line | Business Rules, pricing |
| 6 | Which customers are tax exempt? Do you keep their certificates on file? | Tax-exempt flag and certificate number | Customer profile |
| 7 | What payment terms do you give (due on receipt, net 30…)? Who gets terms? | Invoice due dates, AR aging | Customer profile |
| 8 | How do you track customer payments today? Which payment methods do you take? | Payment recording | Money |
| 9 | Do you require deposits on large jobs (wraps, building signs)? What percent? | Could add deposit invoices | Future feature |
| 10 | How do you currently know who owes you money? How often do you send reminders, and how? | AR reminders and future automations | Settings → Automations |
| 11 | What does an hour of shop labor cost you, all-in? | Actual job profit | Business Rules |

## 2. Pricing (most important)

| # | Question | Where it goes |
|---|---|---|
| 12 | How do you calculate **banner** pricing? Per sq ft? Different by material (13oz, 15oz, mesh)? Hems/grommets/pockets extra? | Pricing Rules → Banners |
| 13 | How are **vehicle wraps** priced: per sq ft, per vehicle type, or a flat price per make/model? Is design separate? Install per hour or included? | Pricing Rules → Vehicle Wraps |
| 14 | **Business cards, brochures, flyers**: do you have a price sheet by quantity? Paper stock and sides affect price how? | Quantity tiers |
| 15 | **Signs**: how do substrate (ACM, PVC, coroplast), size, lamination and installation combine? | Pricing Rules → Commercial Signs |
| 16 | What is your **minimum charge**? Is it different for walk-ins vs. businesses? | Business Rules |
| 17 | What is your **rush charge**? Same-day vs next-day? | Business Rules |
| 18 | What do you charge for **design** per hour? What about installation? Mileage? | Business Rules |
| 19 | What **gross margin** do you aim for overall, and by product type? | Target margin |
| 20 | Which customers get **special pricing** or discounts? Is it a percent or specific prices per item? | Customer discount (percent today; specific price lists later) |
| 21 | How do you price outsourced work (things you buy from another shop)? What markup? | Business Rules → outsourced markup |
| 22 | When you override a price, what are the usual reasons? | Suggested override reasons |
| 23 | How long should quotes be valid? | Business Rules |

## 3. Locations & workflow

| # | Question | Where it goes |
|---|---|---|
| 24 | What is the Hammond address and phone? Is the Munster address and phone correct? (Public listings show Hammond at 6937 Calumet Ave, 219-933-0833 — possibly outdated.) | Settings → Locations |
| 25 | Which jobs go to Munster vs Hammond? Is it always by product type, or does it vary? | Pricing → category default location |
| 26 | How do jobs physically move between Munster and Hammond? Who carries them and when? | Handoff notes, future scheduling |
| 27 | What are your **hours**? (Listings say Mon–Fri 8:30–5, Sat 9–12.) | Company Profile |
| 28 | How do you track current jobs today (paper tickets, whiteboard, spreadsheet)? What does a job ticket need to show? | Printable job ticket |
| 29 | How do you know what is due each day? | Dashboard / TV mode layout |
| 30 | Which steps do simple repeat jobs skip today? | Workflow defaults per category |
| 31 | Do you want a quality-check step for every job, or only some? | Workflow |
| 32 | How do customers pick up: counter only, or also scheduled? | Fulfillment options |

## 4. Files & proofs

| # | Question |
|---|---|
| 33 | Where are files stored today (a server, Dropbox, Google Drive, designers' computers)? Do old job files need to be imported? |
| 34 | How do customers approve proofs today (email reply, text, in person, signature)? Is a typed name plus a checkbox enough legally for you? |
| 35 | What file requirements do you give customers (bleed, DPI, formats)? |
| 36 | How many proof rounds are included before design time is charged? |

## 5. People & communication

| # | Question |
|---|---|
| 37 | Who are the employees, what does each person do, and at which location? (We'll create real accounts.) |
| 38 | Who should be able to see prices? Margins? Money reports? |
| 39 | How do employees communicate today (texts, calls, notes on tickets)? What falls through the cracks? |
| 40 | Which notifications would actually help, and which would be noise? |
| 41 | Should customers get automatic reminders (quote follow-up, proof reminder, payment reminder)? How many days, and from whom? |

## 6. Customers & sales

| # | Question |
|---|---|
| 42 | Do you have an existing customer list (QuickBooks, Excel, contacts)? Roughly how many active customers? |
| 43 | Which corporate customers reorder the same items (business cards for new employees, safety signs)? These are candidates for approved templates and storefronts. |
| 44 | Which customers require PO numbers? |
| 45 | Do salespeople have assigned accounts? Commission? |

## 7. Reports & goals

| # | Question |
|---|---|
| 46 | Which numbers do you check every week or month today? |
| 47 | Which reports would you want emailed to you automatically? |
| 48 | Which tasks take the most of **your** time each week? |
| 49 | Which mistakes happen most often (wrong quantity, wrong file, missed due date, forgotten invoice)? |
| 50 | What repetitive work do employees hate? |
| 51 | If this software could do only one thing perfectly, what should it be? |

## 8. Inventory & vendors (Phase 2)

| # | Question |
|---|---|
| 52 | Which materials run out and cause delays? What reorder levels make sense? |
| 53 | Who orders materials today, and how (phone, website, rep)? |
| 54 | Do you want purchase orders on paper/PDF, or just tracking? |

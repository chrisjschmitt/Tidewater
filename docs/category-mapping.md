# Category → group mapping

When you import a spreadsheet (Tidewater budget CSV with a blank `Group`, or a Monarch Money transaction export), each **expense subcategory keeps the name from the file**. Tidewater does not invent or rename subcategories. It only decides which of the ten **expense groups** that named line belongs under.

Source of truth in code: `src/lib/categories.ts` (`groupForCategory`, `isInternalCategory`, `looksLikeIncome`, `isEssentialCategory`).

## Pipeline (transaction CSV)

1. Read each row’s **Category** (or Category Name). Blank → `Uncategorized`.
2. **Skip internal movements** (not income, not spending): category equals or starts with any of  
   `transfer`, `credit card payment`, `balance adjustment`, `payment`, `transfers`.
3. Sum amounts **per category** (case-insensitive merge; display name = most common spelling).
4. Divide by the **elapsed month span** between first and last transaction date.
5. Drop lines whose absolute monthly average is under **$1**.
6. If the monthly average is **positive**, or the name looks like income (see below) → **Income** line (no group).
7. Otherwise → **Expense** line:  
   `groupId = groupForCategory(name)`, amount = absolute monthly average, `essential = isEssentialCategory(name)`.

Budget CSV expenses with an explicit `Group` column use that id when it is valid; otherwise they use the same keyword mapping as below.

## How a name becomes a group

1. Lowercase and trim the category name.
2. Walk the groups **in the order listed below**.
3. First group whose keyword list has a term that is a **substring** of the name wins.
4. If nothing matches → **`other`** (*Everything Else*). You can move the line by hand later.

Because order matters, an earlier group can claim a name that would also match a later keyword (for example `life insurance` matches **health** before **financial**’s `insurance`).

## Groups and keywords

| Group id | Display name | Keywords (substring match) |
| --- | --- | --- |
| `home` | Home & Shelter | rent, mortgage, condo fee, property tax, home insurance, electric, hydro, water, gas bill, utilit, internet, cable, phone, mobile, home improvement, home repair, condo repair, furnish, lawn, garden, security, storage, special assessment, housing, home service, maintenance |
| `food` | Food & Groceries | grocer, supermarket, food, coffee shop, market |
| `transport` | Getting Around | gas, fuel, auto, `car ` (space), car repair, car insurance, car payment, parking, toll, transit, transport, rideshare, uber, lyft, taxi, vehicle, bike, ev charg |
| `health` | Health & Wellbeing | health, medical, dental, dentist, pharmac, doctor, therapy, fitness, gym, wellness, weight loss, vision, eye, life insurance, disability |
| `personal` | Personal & Everyday | personal, clothing, shopping, hair, beauty, salon, laundry, dry clean, allowance, cash for spending, electronics, subscription, software, miscellaneous, misc |
| `joy` | Joy & Connection | restaurant, bar, dining, entertainment, recreation, travel, vacation, cruise, lodging, hotel, airfare, flight, tours, entrance fee, trailer, hobby, sport, music, movie, streaming, gift, events, concert, alcohol, liquor |
| `family` | Family & Pets | child, kid, daycare, childcare, school, tuition, education, pet, vet, baby, family |
| `financial` | Financial & Insurance | bank fee, financial fee, fee, insurance, tax, interest charge, loan, debt, legal, accounting, business, advisor |
| `future` | Future & Giving | saving, savings, investment, invest, rrsp, tfsa, resp, retirement, emergency fund, charity, charitable, donation, giving, tithe |
| `other` | Everything Else | *(fallback — no keyword match)* |

## Income name hints

Used when deciding whether a net-positive (or named) bucket is income rather than spending. Match is again a substring of the lowercased category:

paycheck, paycheque, salary, wages, income, bonus, cpp, oas, rif, rrif, pension, dividend, interest, reimbursement, rebate, refund, benefit, child tax, gst

## “Essential” flag

Separate from grouping. Softens slider advice for categories people usually cannot turn off. Substring match on:

rent, mortgage, condo fee, property tax, grocer, utilit, electric, hydro, water, insurance, phone, internet, medical, pharmac, dental, childcare, daycare, tuition, loan, debt, tax

## What this does *not* do

- It does **not** split or merge Monarch categories into new Tidewater subcategory names (beyond case-insensitive merge of the same name).
- It does **not** use merchant names — only the **Category** column (for transactions) or the expense **Name** (for budget CSV auto-group).
- Ambiguous or missing categories land in **Everything Else** until you move them in the group detail UI.

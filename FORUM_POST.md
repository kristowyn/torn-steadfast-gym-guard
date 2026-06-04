Torn Steadfast Gym Guard — Forum Post Draft
=========================================

Hi all,

I've published a small Tampermonkey userscript called **Torn Steadfast Gym Guard** that reads your faction Steadfast bonus from the Torn API and highlights the favoured gym stats on the gym page. It also intercepts TRAIN clicks for non-favoured stats and asks for confirmation so you don't accidentally train the wrong stat.

Features:
- Automatically reads `perks` from the Torn API (Limited/Public key enough)
- Highlights favoured stats and dims others
- Confirm dialog when training a non-favoured stat
- Caches data for 3 hours and refreshes automatically

Install:
Open the raw script URL to install directly in Tampermonkey:

https://raw.githubusercontent.com/kristowyn/torn-steadfast-gym-guard/main/steadfast-gym-guard.user.js

Or see the repository for details: https://github.com/kristowyn/torn-steadfast-gym-guard

Screenshots are included in the repo to show how it appears on the gym page.

Feedback welcome — especially if the React-based intercept stops working after page changes.

— Kristowyn

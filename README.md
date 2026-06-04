# Torn Steadfast Gym Guard

A small Tampermonkey userscript for Torn.com that reads your faction Steadfast bonus from the Torn API and helps you train the right gym stats.

## What it does

Torn factions give a rotating "Steadfast" gym gain bonus to two stats. This script reads your current steadfast bonus from the Torn API and:

- shows a banner on the gym page with the two favoured stats,
- outlines the favoured stat blocks in green,
- dims non-favoured stats,
- intercepts wrong-stat TRAIN clicks and asks for confirmation before allowing them.

This keeps the script working automatically as the steadfast rotation changes.

## How it works

The script uses Torn's `https://api.torn.com/user/?selections=perks&key=KEY` endpoint and reads the user's `faction_perks` array from the Personal Perks data. It parses lines like "Increases speed gym gains by 15%" or "+ 15% speed gym gains" to infer the steadfast bonus.

Favoured stats are the two highest percentages. Ties for second place are included so the script may highlight more than two stats if needed.

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey in your browser.
2. Create a new userscript and paste the contents of `steadfast-gym-guard.user.js` into it.
3. Save and enable the script.
4. Visit `https://www.torn.com/gym.php` to confirm the banner appears.

## Get a Limited API key

1. Log into Torn and go to `Settings → API Keys`.
2. Create a new API key with Limited (Public) access.
3. The script only needs the `perks` selection, so a limited key is sufficient.
4. Enter the key when prompted by the script, or click `change key` in the banner.

## Usage

- Favoured stats are outlined in green.
- Non-favoured stats are dimmed.
- Clicking TRAIN for a non-favoured stat shows a confirmation prompt.
- The script caches your steadfast data for 3 hours and refreshes automatically.
- Click `refresh` in the banner to force a reload immediately.
- Click `change key` to update or remove your API key.

## Privacy

- Your Torn API key is stored with `GM_setValue` in the userscript manager, not in page-readable `localStorage`.
- The key is only sent to `api.torn.com`.
- No other Torn data is stored or shared by this script.

## Troubleshooting

- If no steadfast bonus is detected, the script will show a warning and allow all stats.
- If the API key is invalid or the request fails, the banner will show an error and the last known data may be used.
- The React intercept is the most fragile part: if Torn changes the gym page structure or button handlers, the confirm logic may stop working first.

## Unaffiliated

This script is unaffiliated with Torn.

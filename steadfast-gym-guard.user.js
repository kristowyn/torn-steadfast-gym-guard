// ==UserScript==
// @name         Torn Steadfast Gym Guard
// @namespace    kristowyn.steadfast-gym-guard
// @version      1.0.0
// @description  Reads your faction Steadfast bonus from the Torn API and warns you to train the favoured stats. Blocks a wrong-stat TRAIN click until you confirm.
// @author       Kristowyn [2642842]
// @match        https://www.torn.com/gym.php*
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/kristowyn/torn-steadfast-gym-guard/main/steadfast-gym-guard.user.js
// @updateURL    https://raw.githubusercontent.com/kristowyn/torn-steadfast-gym-guard/main/steadfast-gym-guard.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     * Config
     * ------------------------------------------------------------------ */
    const STATS = ['strength', 'defense', 'speed', 'dexterity'];
    const ABBR = { strength: 'STR', defense: 'DEF', speed: 'SPD', dexterity: 'DEX' };
    const API_BASE = 'https://api.torn.com/user/';
    const CACHE_TTL_MS = 3 * 60 * 60 * 1000;   // re-fetch steadfast if older than 3h (catches rotations)
    const STALE_CHECK_MS = 5 * 60 * 1000;      // how often we check whether the cache is stale
    const KEY_STORE = 'sgg_api_key';
    const CACHE_STORE = 'sgg_cache';           // { steadfast:{stat:pct}, fetchedAt:number }

    /* ------------------------------------------------------------------ *
     * Storage (GM_* with localStorage fallback). Everything is JSON.
     * The API key lives in the userscript manager's storage, NOT in
     * page-readable localStorage, so the page's own JS can't see it.
     * ------------------------------------------------------------------ */
    const store = {
        rawGet(k) {
            return (typeof GM_getValue === 'function')
                ? GM_getValue(k, null)
                : localStorage.getItem('SGG_' + k);
        },
        rawSet(k, v) {
            if (typeof GM_setValue === 'function') GM_setValue(k, v);
            else localStorage.setItem('SGG_' + k, v);
        },
        rawDel(k) {
            if (typeof GM_deleteValue === 'function') GM_deleteValue(k);
            else localStorage.removeItem('SGG_' + k);
        },
        get(k, d) {
            const v = this.rawGet(k);
            if (v == null) return d;
            try { return JSON.parse(v); } catch (e) { return v; }
        },
        set(k, v) { this.rawSet(k, JSON.stringify(v)); },
        del(k) { this.rawDel(k); },
    };

    /* ------------------------------------------------------------------ *
     * Torn API
     * ------------------------------------------------------------------ */
    function apiGet(selections, key) {
        const url = `${API_BASE}?selections=${selections}&key=${encodeURIComponent(key)}&comment=SteadfastGymGuard`;
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 15000,
                    onload: r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); } },
                    onerror: e => reject(e),
                    ontimeout: () => reject(new Error('timeout')),
                });
            } else {
                fetch(url).then(r => r.json()).then(resolve).catch(reject);
            }
        });
    }

    /**
     * Turn the `faction_perks` string array into { stat: percent }.
     * Steadfast is the only faction perk that grants per-stat gym gains,
     * and each relevant line looks like "Increases speed gym gains by 15%"
     * (or the older "+ 15% speed gym gains"). We just need the stat keyword
     * and the number before the % — tolerant to either phrasing.
     */
    function parseSteadfast(factionPerks) {
        const out = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
        if (!Array.isArray(factionPerks)) return out;
        for (const raw of factionPerks) {
            const s = String(raw).toLowerCase();
            if (!s.includes('gym gain')) continue;        // must be a gym-gain line
            const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
            if (!m) continue;
            const pct = parseFloat(m[1]);
            for (const stat of STATS) {
                if (s.includes(stat)) { out[stat] = pct; break; }
            }
        }
        return out;
    }

    /**
     * Favoured = the two highest-percentage stats.
     * Ties for 2nd place are included (so 15/15/10/10 -> [speed, dexterity],
     * and 20/15/10/10 -> the 20 and the 15). Returns [] if there is no
     * steadfast bonus at all.
     */
    function getFavored(steadfast) {
        const ranked = STATS
            .map(st => ({ st, pct: steadfast[st] || 0 }))
            .sort((a, b) => b.pct - a.pct);
        if (ranked[0].pct === 0) return [];
        const cutoff = ranked[1].pct;                     // value of the 2nd-best stat
        return ranked.filter(x => x.pct >= cutoff && x.pct > 0).map(x => x.st);
    }

    /* ------------------------------------------------------------------ *
     * State
     * ------------------------------------------------------------------ */
    let favored = null;     // array of stat names, [] = no steadfast, null = unknown/loading
    let steadfast = null;   // { stat: pct }
    let status = 'init';    // 'nokey' | 'loading' | 'ok' | 'stale' | 'error'
    let statusMsg = '';

    async function loadSteadfast(force) {
        const key = store.get(KEY_STORE, null);
        if (!key) { favored = null; steadfast = null; status = 'nokey'; return; }

        const cache = store.get(CACHE_STORE, null);
        const fresh = cache && (Date.now() - cache.fetchedAt < CACHE_TTL_MS);
        if (!force && fresh) {
            steadfast = cache.steadfast;
            favored = getFavored(steadfast);
            status = 'ok';
            return;
        }

        if (!cache) status = 'loading';
        try {
            const data = await apiGet('perks', key);
            if (data && data.error) {
                statusMsg = (data.error && data.error.error) || 'API error';
                if (cache) { steadfast = cache.steadfast; favored = getFavored(steadfast); status = 'stale'; }
                else { favored = null; steadfast = null; status = 'error'; }
                return;
            }
            const sf = parseSteadfast(data.faction_perks);
            steadfast = sf;
            favored = getFavored(sf);
            status = 'ok';
            statusMsg = '';
            store.set(CACHE_STORE, { steadfast: sf, fetchedAt: Date.now() });
        } catch (e) {
            statusMsg = 'network error';
            if (cache) { steadfast = cache.steadfast; favored = getFavored(steadfast); status = 'stale'; }
            else { favored = null; steadfast = null; status = 'error'; }
        }
    }

    /* ------------------------------------------------------------------ *
     * Click guard — capture phase, runs before React's handler
     * ------------------------------------------------------------------ */
    const bypass = new WeakSet();
    let guardAttached = false;

    function attachGuard() {
        if (guardAttached) return;
        document.addEventListener('click', onTrainClick, true);   // true = capture
        guardAttached = true;
    }

    function onTrainClick(e) {
        const btn = e.target && e.target.closest && e.target.closest('button[aria-label^="Train "]');
        if (!btn) return;

        // We previously approved this exact click — let it reach React.
        if (bypass.has(btn)) { bypass.delete(btn); return; }

        // Fail open: if we don't know the steadfast (no key / loading / error), never block.
        if (!favored || favored.length === 0) return;

        const stat = btn.getAttribute('aria-label').replace(/^Train\s+/i, '').trim().toLowerCase();
        if (favored.includes(stat)) return;   // correct stat — allow

        // Wrong stat: stop the click reaching React, then ask.
        e.preventDefault();
        e.stopImmediatePropagation();

        const favTxt = favored.map(s => `${ABBR[s]} ${steadfast[s]}%`).join(', ');
        const thisPct = (steadfast && steadfast[stat] != null) ? steadfast[stat] : 0;
        const ok = window.confirm(
            '\u26A0 STEADFAST GYM GUARD\n\n' +
            `Your faction steadfast favours: ${favTxt}.\n\n` +
            `You are about to train ${ABBR[stat] || stat.toUpperCase()} ` +
            `(only ${thisPct}% steadfast).\n\n` +
            `Train ${ABBR[stat] || stat.toUpperCase()} anyway?`
        );

        if (ok) {
            bypass.add(btn);
            btn.click();   // re-fire; the guard sees the bypass flag and lets React handle it
        }
    }

    /* ------------------------------------------------------------------ *
     * UI
     * ------------------------------------------------------------------ */
    function injectStyle() {
        if (document.getElementById('sgg-style')) return;
        const css = `
            #sgg-banner{font:12px/1.45 Arial,Helvetica,sans-serif;margin:8px 0;padding:9px 12px;
                border-radius:6px;background:#1d1d1d;border:1px solid #333;color:#cfcfcf;}
            #sgg-banner .sgg-title{font-weight:bold;color:#9bc34a;letter-spacing:.3px;
                text-transform:uppercase;font-size:11px;margin-bottom:3px;}
            #sgg-banner .sgg-body b{color:#9bc34a;}
            #sgg-banner .sgg-warn{color:#e0a030;}
            #sgg-banner .sgg-err{color:#d9534f;}
            #sgg-banner .sgg-meta{color:#7d7d7d;margin-top:5px;font-size:11px;}
            #sgg-banner a.sgg-link{color:#5aa0d0;cursor:pointer;text-decoration:underline;margin-left:10px;}
            #sgg-banner a.sgg-link:first-child{margin-left:0;}
            li.sgg-fav{outline:2px solid rgba(124,179,66,.85)!important;outline-offset:-2px;border-radius:4px;}
            li.sgg-nonfav{opacity:.82;}
            li.sgg-nonfav button[aria-label^="Train "]{filter:grayscale(.35);}
        `;
        const el = document.createElement('style');
        el.id = 'sgg-style';
        el.textContent = css;
        (document.head || document.documentElement).appendChild(el);
    }

    function timeAgo(ts) {
        const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
    }

    function bannerHtml() {
        const links =
            '<a class="sgg-link" data-act="refresh">\u21BB refresh</a>' +
            '<a class="sgg-link" data-act="key">\u2699 change key</a>';

        if (status === 'nokey') {
            return '<div class="sgg-title">Steadfast Gym Guard</div>' +
                '<div class="sgg-body sgg-warn">No API key set \u2014 can\u2019t read your steadfast.</div>' +
                '<div class="sgg-meta"><a class="sgg-link" data-act="key" style="margin-left:0">Set API key</a> ' +
                '(a Limited / Public key is enough)</div>';
        }
        if (status === 'loading' || favored === null) {
            return '<div class="sgg-title">Steadfast Gym Guard</div>' +
                '<div class="sgg-body">Loading steadfast\u2026</div>';
        }
        if (status === 'error') {
            return '<div class="sgg-title">Steadfast Gym Guard</div>' +
                `<div class="sgg-body sgg-err">Couldn\u2019t load steadfast (${statusMsg}).</div>` +
                '<div class="sgg-meta">' + links + '</div>';
        }
        if (favored.length === 0) {
            return '<div class="sgg-title">Steadfast Gym Guard</div>' +
                '<div class="sgg-body sgg-warn">No steadfast bonus detected on your account. ' +
                'Nothing to guard \u2014 all stats allowed.</div>' +
                '<div class="sgg-meta">' + links + '</div>';
        }

        const favTxt = favored.map(s => `<b>${ABBR[s]} ${steadfast[s]}%</b>`).join(' &nbsp; ');
        const cache = store.get(CACHE_STORE, null);
        const when = cache ? timeAgo(cache.fetchedAt) : '';
        const staleNote = status === 'stale'
            ? ` <span class="sgg-warn">(couldn\u2019t refresh: ${statusMsg} \u2014 showing last known)</span>`
            : '';
        return '<div class="sgg-title">Steadfast Gym Guard \u2014 train these</div>' +
            `<div class="sgg-body">${favTxt}</div>` +
            // add non-breaking spaces to separate timestamp from action links
            `<div class="sgg-meta">updated ${when}${staleNote}&nbsp;&nbsp;&nbsp;` + links + '</div>';
    }

    function getGymContainer() {
        return document.querySelector('[class^="gymContent__"], [class*=" gymContent__"]');
    }

    function applyTints() {
        document.querySelectorAll('button[aria-label^="Train "]').forEach(btn => {
            const li = btn.closest('li');
            if (!li) return;
            const stat = btn.getAttribute('aria-label').replace(/^Train\s+/i, '').trim().toLowerCase();
            const wantFav = favored && favored.length > 0 && favored.includes(stat);
            const wantNon = favored && favored.length > 0 && !favored.includes(stat);
            // idempotent: only touch classList when it actually needs to change
            if (li.classList.contains('sgg-fav') !== wantFav) li.classList.toggle('sgg-fav', wantFav);
            if (li.classList.contains('sgg-nonfav') !== wantNon) li.classList.toggle('sgg-nonfav', wantNon);
        });
    }

    function wireBanner(banner) {
        banner.querySelectorAll('a.sgg-link').forEach(a => {
            if (a.dataset.wired) return;
            a.dataset.wired = '1';
            a.addEventListener('click', async (ev) => {
                ev.preventDefault();
                const act = a.getAttribute('data-act');
                if (act === 'refresh') { await loadSteadfast(true); scheduleRender(); }
                else if (act === 'key') { await promptForKey(); }
            });
        });
    }

    function render() {
        const container = getGymContainer();
        if (!container) return;
        injectStyle();

        let banner = document.getElementById('sgg-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'sgg-banner';
            const props = container.querySelector('ul[class^="properties__"], ul[class*=" properties__"]');
            if (props && props.parentNode) props.parentNode.insertBefore(banner, props);
            else container.insertBefore(banner, container.firstChild);
        }

        const html = bannerHtml();
        if (banner.dataset.sig !== html) {   // only rewrite when content changed (avoids observer churn)
            banner.innerHTML = html;
            banner.dataset.sig = html;
            wireBanner(banner);
        }
        applyTints();
    }

    let renderScheduled = false;
    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => { renderScheduled = false; render(); });
    }

    async function promptForKey() {
        const current = store.get(KEY_STORE, '') || '';
        const input = window.prompt(
            'Enter your Torn API key.\n' +
            'A Limited Access (Public) key is enough \u2014 only the "perks" selection is read.\n' +
            'Make one at: Settings \u2192 API Keys.\n\n' +
            'Leave blank and press OK to remove the saved key.',
            current
        );
        if (input === null) return;              // cancelled
        const key = input.trim();
        if (!key) {                               // clear
            store.del(KEY_STORE); store.del(CACHE_STORE);
            favored = null; steadfast = null; status = 'nokey';
            scheduleRender();
            return;
        }
        status = 'loading'; scheduleRender();
        try {
            const data = await apiGet('perks', key);
            if (data && data.error) {
                window.alert('Torn API error: ' + ((data.error && data.error.error) || 'unknown') +
                    '\nThe key was not saved.');
                await loadSteadfast(false); scheduleRender();
                return;
            }
            store.set(KEY_STORE, key);
            const sf = parseSteadfast(data.faction_perks);
            steadfast = sf; favored = getFavored(sf); status = 'ok'; statusMsg = '';
            store.set(CACHE_STORE, { steadfast: sf, fetchedAt: Date.now() });
            scheduleRender();
        } catch (e) {
            window.alert('Could not reach the Torn API. Check your connection and try again.');
            scheduleRender();
        }
    }

    /* ------------------------------------------------------------------ *
     * Boot
     * ------------------------------------------------------------------ */
    function boot() {
        attachGuard();
        loadSteadfast(false).then(scheduleRender);

        // Re-render when React rebuilds the gym page. render() is idempotent,
        // so this won't loop on its own mutations.
        const obs = new MutationObserver(() => { if (getGymContainer()) scheduleRender(); });
        obs.observe(document.body, { childList: true, subtree: true });

        // Safety re-render (cheap, idempotent) for any layout we missed.
        setInterval(scheduleRender, 2000);

        // Periodically refresh steadfast if the cache has gone stale (catches rotations).
        setInterval(async () => {
            if (!store.get(KEY_STORE, null)) return;
            const cache = store.get(CACHE_STORE, null);
            if (!cache || (Date.now() - cache.fetchedAt > CACHE_TTL_MS)) {
                await loadSteadfast(false);
                scheduleRender();
            }
        }, STALE_CHECK_MS);
    }

    boot();
})();

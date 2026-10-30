// Action Queue for Melvor Idle: line up goals, press Start and walk away. It used to be three mods (Action Queue, Skill Trainer
// and Township Task Helper). They're one mod again, in three parts that each keep their own code:
//   1. the queue: the list, the panel, the runner, settings and shop purchases
//   2. training: how to train every skill, safety checks, the planner and the Train window
//   3. Township tasks: the green play buttons on Township tasks, which plan a task and add its steps
// The parts talk through `parts` below. Other mods still reach the queue as mod.api.actionQueue (or window.actionQueue).
export function setup(ctx) {
  const VERSION = "2.1.0";
  const parts = { aq: null, st: null, installed: false };

  // ======================================================================================================================
  // 1. The queue
  // ======================================================================================================================
  (() => {

    const TAG = "[Action Queue]";

    // ---------- small helpers ----------
    const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
    const nm = (o) => String(o?.name ?? o?._name ?? o?._localID ?? o?.id ?? "?");
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = (n) => Number(n).toLocaleString();
    const plural = (n, w, ws = w + "s") => `${num(n)} ${n === 1 ? w : ws}`;
    const aOr = (w) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const icon = (o) => (typeof o?.media === "string" ? `<img class="skill-icon-xs mr-1" src="${esc(o.media)}">` : "");
    const have = (item) => { try { const q = game.bank.getQty(item); return Number.isFinite(q) ? q : null; } catch (e) { return null; } };
    const owned = (item) => have(item) ?? 0;
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { return false; } return true; };
    const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const itemById = (id) => { try { return game.items.getObjectByID(id); } catch (e) { return null; } };
    const skillById = (id) => list(game.skills).find((s) => s.id === id);
    const warnIcon = '<i class="fa fa-exclamation-triangle"></i>&nbsp;';
    const chip = (html, cls = "", title = "") => `<span class="aq-chip ${cls}"${title ? ` title="${esc(title)}"` : ""}><span>${html}</span></span>`;
    const chips = (...c) => `<div class="aq-chips">${c.join("")}</div>`;
    const step = (body) => `<div class="aq-step">${body}</div>`;
    const note = (t) => `<div class="aq-note">${t}</div>`;

    // ---------- settings ----------
    // The switches live in the mod settings menu (ctx.settings), with localStorage as the fallback (userscript use).
    const SETTINGS = {
      autoStart: ["aq-autostart", false, "Automatically start the queue when you add something",
        "When on, adding a goal or task to the queue starts the queue right away. When off, you press Start yourself."],
      autoSell: ["aq-autosell", true, "Automatically sell extras the queue makes",
        "When a step makes more than the task needs (like arrowtips crafted in batches), the extra is sold. It never sells anything you already owned."],
      autoBuy: ["aq-autobuy", false, "Buy from the shop without asking",
        "When on, steps that need feathers, Summoning shards, compost or anything else from the shop buy it right away. When off, the queue asks you before every purchase. Agility obstacles, Slayer tasks and dig site maps always ask."],
      sideJobs: ["aq-sidejobs", true, "Work on other steps while crops grow",
        "When on, a Farming step that is waiting for its crops lets a later step run in the meantime (gathering, or training that uses no materials), and goes back to the crops once they're ready."],
    };
    let section = null;
    try {
      if (ctx?.settings) {
        section = ctx.settings.section("General");
        for (const [name, [, def, label, hint]] of Object.entries(SETTINGS)) section.add({ type: "switch", name, label, hint, default: def });
      }
    } catch (e) { section = null; console.warn(TAG, "could not register settings", e); }
    const Settings = {
      get(name) { try { const v = section?.get(name); if (v !== undefined && v !== null) return !!v; } catch (e) { /* use the fallback */ } const raw = stored(SETTINGS[name][0]); return raw !== null ? raw === "1" : SETTINGS[name][1]; },
      set(name, v) { try { section?.set(name, !!v); } catch (e) { console.warn(TAG, "settings", e); } store(SETTINGS[name][0], v ? "1" : "0"); },
    };

    // shop prices are worked out once a second, since the planner asks for them many times
    const secMemo = { t: 0, m: new Map() };
    const perSec = (key, fn) => {
      const t = Math.floor(Date.now() / 1000);
      if (t !== secMemo.t) Object.assign(secMemo, { t, m: new Map() });
      if (!secMemo.m.has(key)) secMemo.m.set(key, fn());
      return secMemo.m.get(key);
    };
    const MANUAL_NOTE = "The queue can't get this on its own, so it's a step you do yourself";
    const costText = (x) => [...x.cur.map((k) => `${num(k.quantity)} ${nm(k.currency)}`), ...x.items.map((k) => `${num(k.quantity)} ${nm(k.item)}`)].join(" + ") || "free";
    const costsOf = (c) => ({ c, items: c.getItemQuantityArray(), cur: c.getCurrencyQuantityArray() });

    // ---------- the trainer ----------
    // Action Queue runs manual steps and shop purchases itself. Every other step (gathering, crafting, training, fights, Farming)
    // is run through the trainer, which the Skill Trainer mod registers: it knows how to start each action, what counts as
    // progress, when a step is unsafe and how to plan the next batch of a goal. Without it those steps wait with a note.
    let T = null;
    const NO_TRAINER = "this step needs the Skill Trainer mod, which knows how to run it";

    // ---------- the shop ----------
    // Things nothing else makes (feathers, compost, Summoning shards) can come from the shop. Only plain purchases of one item
    // for currency count, and the queue asks you before every purchase unless auto-buy is on.
    let shopIdx = null;
    const shopFor = (item) => {
      if (!shopIdx) {
        shopIdx = new Map();
        for (const p of list(game.shop?.purchases)) { const c = p.contains; if (p.allowQuantityPurchase && c?.items?.length === 1 && Object.keys(c).length === 1 && !p.costs?.items?.length) shopIdx.set(c.items[0].item.id, p); }
      }
      return item ? shopIdx.get(item.id) : undefined;
    };
    const perBuy = (p) => p.contains.items[0].quantity || 1;
    // why you can't buy n of it right now (null when you can)
    const buyIssue = (p, n) => {
      const it = p.contains.items[0].item;
      if (!game.checkRequirements([...(p.unlockRequirements ?? []), ...(p.purchaseRequirements ?? [])])) return `you don't meet the shop's requirements for ${nm(it)} yet`;
      if (game.shop.isPurchaseAtBuyLimit(p)) return `you've reached the shop's buy limit for ${nm(it)}`;
      const c = game.shop.getPurchaseCosts(p, Math.ceil(n / perBuy(p)));
      return c.checkIfOwned() ? null : `you can't afford ${num(n)} ${nm(it)} right now (${costText(costsOf(c))})`;
    };
    // how many of an item you could buy right now (0 when the shop doesn't sell it)
    const canBuy = (item) => perSec(`buy|${item?.id}`, () => {
      try { const p = shopFor(item); return !p || buyIssue(p, 1) ? 0 : perBuy(p) * Math.min(...game.shop.getPurchaseCosts(p, 1).getCurrencyQuantityArray().map((k) => Math.floor((k.currency.amount ?? 0) / k.quantity))); } catch (e) { return 0; }
    });

    // ---------- steps that ask you first ----------
    // An "ask" step stops and asks before it spends anything or changes your game. Action Queue handles shop purchases; other
    // mods add their own kinds (Skill Trainer: Agility obstacles, Slayer tasks, dig site maps, equipment sets) with addAsk.
    // A kind has target, done, cannot, act, turn and optionally pop (the window), skip, auto (no question asked), icon, hint.
    // The answer is kept on the step and the queue carries on.
    const popHtml = (o, rows, foot) => step(`<div class="aq-title">${icon(o)}<b>${esc(nm(o))}</b></div>${rows}`) + note(foot);
    const ASKS = {
      buy: {
        target: (e) => { const it = itemById(e.itemId), p = shopFor(it); return p && { it, p, n: () => Math.max(0, e.qty - owned(it)) }; },
        done: (e, t) => (t.n() <= 0 ? "You have enough" : null),
        // skipping something a recipe needs turns it into a step you do yourself; skipping an optional buy (compost) just
        // carries on without it, and the goal that added it remembers (skipFlag)
        skip: (e, t, parent) => {
          if (e.optional) { if (parent && e.skipFlag) parent[e.skipFlag] = true; return false; }
          Object.assign(e, { kind: "manual", label: `Get ${nm(t.it)}`, note: MANUAL_NOTE }); delete e.what; delete e.answer;
          return true;
        },
        cannot: (e, t) => buyIssue(t.p, t.n()),
        auto: () => Settings.get("autoBuy"),
        act: (e, t) => {
          const n = t.n(), buys = Math.ceil(n / perBuy(t.p)), sh = game.shop, was = sh.buyQuantity, cost = costText(costsOf(sh.getPurchaseCosts(t.p, buys)));
          try { sh.buyQuantity = buys; sh.buyItemOnClick(t.p, true); } finally { sh.buyQuantity = was; }
          return t.n() <= 0 ? `Bought ${num(buys * perBuy(t.p))} for ${cost}` : { block: `the shop didn't sell you ${nm(t.it)} (is your bank full?)` };
        },
        turn: (e, t) => `confirm buying ${nm(t.it)}, or skip it.`,
        pop: (e, t) => {
          const n = t.n(), c = game.shop.getPurchaseCosts(t.p, Math.ceil(n / perBuy(t.p)));
          return { title: "Buy from the shop?", yes: "Buy", html: popHtml(t.it, chips(chip(`Buy ${num(Math.ceil(n / perBuy(t.p)) * perBuy(t.p))}`), chip(`You have ${num(owned(t.it))}`)) + chips(chip("<b>Costs</b>", "lbl"), chip(esc(costText(costsOf(c))))),
            e.optional ? e.skipNote ?? "Skip carries on without it." : "Skip turns this into a step you do yourself.") };
        },
      },
    };
    // the confirm window for an ask step
    const askPop = (e, { title, html, yes }) => SwalLocale.fire({
      title, width: 560, showCancelButton: true, confirmButtonText: yes, cancelButtonText: "Skip", html: `<div class="text-center font-size-sm aq-pop">${html}</div>`,
    })?.then?.((r) => { e.answer = r?.isConfirmed ? "yes" : r?.dismiss === "cancel" ? "skip" : undefined; e.asking = false; Queue.save(); if (e.answer) Runner.start(); });
    const askIcon = (e) => { try { const A = ASKS[e.what], t = A?.target(e); return A?.icon ? A.icon(e, t) : t?.it ?? t; } catch (err) { return null; } };
    ASKS.buy.icon = (e, t) => t?.it;

    // ---------- queue (saved locally, one list per character name) ----------
    // kill fights a monster until you've beaten it enough more times (Township monster tasks),
    // gather and craft run a game action until you have more of an item, skill runs one until it has given enough XP,
    // manual waits for the player, train plans the next batch of steps
    const KINDS = new Set(["gather", "craft", "skill", "manual", "train", "ask", "kill"]);
    const Queue = {
      items: [],
      key: () => `aq-queue:${game.characterName ?? "default"}`,
      load() {
        try { this.items = JSON.parse(stored(this.key()) ?? "[]").filter((e) => KINDS.has(e.kind)); } catch (e) { this.items = []; }
        // the runner never survives a reload, so nothing is "in progress" any more (progress counts are kept)
        for (const e of this.items) { if (["active", "waiting", "blocked"].includes(e.status)) e.status = "pending"; for (const k of ["reason", "ack", "t0", "g0", "asking", "info", "readyAt"]) delete e[k]; }
        updateBadge();
      },
      save() { if (!store(this.key(), JSON.stringify(this.items))) console.warn(TAG, "could not save queue"); updateBadge(); Panel.render(); },
      pos: (id) => Queue.items.findIndex((e) => e.id === id),
      fresh: (entries) => entries.map((e) => ({ ...e, id: uid(), status: "pending" })),
      add(entries, top = false) { this.items = top ? [...this.fresh(entries), ...this.items] : [...this.items, ...this.fresh(entries)]; this.save(); },
      insertBefore(id, entries) { const i = this.pos(id); this.items.splice(i < 0 ? this.items.length : i, 0, ...this.fresh(entries)); this.save(); },
      remove(id) { const gone = this.items.find((e) => e.id === id); this.items = this.items.filter((e) => e.id !== id); if (gone) giveBackGear([gone]); this.save(); },
      move(id, dir) { const i = this.pos(id), j = i + dir; if (i >= 0 && j >= 0 && j < this.items.length) { [this.items[i], this.items[j]] = [this.items[j], this.items[i]]; this.save(); } },
      toTop(id) { const i = this.pos(id); if (i > 0) { this.items.unshift(...this.items.splice(i, 1)); this.save(); } },
      clearDone() { this.items = this.items.filter((e) => e.status !== "done"); this.save(); },
      clear() { Runner.stop(); this.items = []; this.save(); },
    };
    // a goal that switched your equipment set switches it back when it's stopped or removed, not only when it's done
    // (starting it again plans the switch again, and still remembers which set was yours)
    const giveBackGear = (entries) => {
      for (const e of entries) {
        if (e.kind !== "train" || e.wasSet === undefined || e.status === "done") continue;
        try { T?.trainFinished?.(e); } catch (err) { console.warn(TAG, "switching your equipment set back", err); }
        // its switch step runs again next time, so the goal doesn't carry on without the right weapon
        for (const x of Queue.items) if (x.kind === "ask" && x.what === "equip" && x.parent === e.id && x.status === "done") { x.status = "pending"; delete x.sold; delete x.answer; }
      }
    };
    const updateBadge = () => {
      const b = document.querySelector("#aq-queue-btn .aq-count"), n = Queue.items.filter((e) => e.status !== "done").length;
      if (b) { b.textContent = n ? String(n) : ""; b.style.display = n ? "block" : "none"; }
    };

    // ---------- time estimates (base speeds; the active entry switches to its measured speed after a few seconds) ----------
    const estimateMs = (e) => {
      if (e.kind === "manual" || e.kind === "ask" || e.status === "done") return 0;
      const r = T?.estimate?.(e);
      if (!r) return null;
      if (r.total !== undefined) return r.total;
      const units = Math.max(0, e.qty - Runner.gained(e));
      if (units <= 0) return 0;
      let per = e.unitMs > 0 ? e.unitMs : r.per;
      if (Runner.state === "running" && Runner.activeId === e.id && e.t0 !== undefined) {
        const dt = Date.now() - e.t0, dg = Runner.gained(e) - e.g0;
        if (dt > 10000 && dg > 0) per = dt / dg;
      }
      return isFinite(per) ? units * per : null;
    };
    const fmtDur = (ms) => { if (!isFinite(ms)) return "an unknown time"; const m = Math.round(ms / 60000); return m < 1 ? "under 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
    const fmtClock = (ms) => {
      const d = new Date(Date.now() + ms), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
    };


    // ---------- runner: takes entries from the top of the list, one at a time ----------
    const Runner = {
      state: "idle", // idle | running | paused
      message: "", activeId: null, activeActor: null,
      focusId: null, // "Do this first": run this entry now without moving it in the list
      elapsed: 0, lastTick: null, // running time since the queue was started (for the progress bar)
      setState(s, msg = "") { this.state = s; this.message = msg; Panel.render(); },
      eta() {
        const r = { ms: 0, unknown: 0, manual: 0 };
        for (const e of Queue.items.filter((x) => x.status !== "done")) {
          const t = e.kind === "manual" ? null : estimateMs(e);
          if (e.kind === "manual") r.manual++; else if (t === null) r.unknown++; else r.ms += t;
        }
        return r;
      },
      current() {
        const f = this.focusId && Queue.items.find((e) => e.id === this.focusId && e.status !== "done");
        if (!f) this.focusId = null;
        const top = f || Queue.items.find((e) => e.status !== "done");
        return this.sideJob(top) ?? top;
      },
      // while a step waits for something on a timer (Farming crops), a later step that doesn't depend on it runs, as long as
      // the trainer says it's a good fit (gathering, or training that uses no materials). The waiting step comes back first
      // as soon as it's ready.
      sideJob(top) {
        if (!(top?.readyAt > Date.now()) || this.state !== "running" || !Settings.get("sideJobs") || !T?.sideJobOk) return null;
        return Queue.items.slice(Queue.items.indexOf(top) + 1).find((e) => e.status !== "done" && e.status !== "blocked" && T.sideJobOk(e)) ?? null;
      },
      doFirst(id) {
        const e = Queue.items.find((x) => x.id === id);
        if (!e || e.status === "done") return;
        this.focusId = id;
        if (e.status === "blocked" || e.status === "waiting") e.status = "pending";
        if (this.state === "running") { this.step(); Panel.render(); } else this.start();
      },
      // what a step counts: what the trainer says (XP, kills), otherwise how many of its item you own
      value: (e) => T?.value?.(e) ?? owned(itemById(e.itemId)),
      gained(e) { return e.kind === "train" ? Math.floor(skillById(e.skillId)?.xp ?? 0) : e.startQty === undefined ? 0 : Math.max(0, this.value(e) - e.startQty); },
      // what runs a step in the game: the skill, or combat for a fight
      actorOf: (e) => T?.actor?.(e) ?? skillById(e.skillId) ?? null,
      halt(actor = this.activeActor) { try { if (actor && game.activeAction === actor) game.stopActiveAction(); } catch (e) { console.warn(TAG, e); } try { T?.halt?.(); } catch (e) { console.warn(TAG, e); } },
      release() { this.activeId = null; this.activeActor = null; },
      leave() {
        if (this.activeId === null) return;
        const prev = Queue.items.find((e) => e.id === this.activeId);
        if (prev?.status === "active") prev.status = "pending";
        this.halt(); this.release();
      },
      start() {
        const cur = this.current();
        if (!cur) return this.setState("idle", "Nothing to run: the queue is empty or finished.");
        if (cur.kind === "manual" && cur.status === "waiting") cur.ack = true;
        if (cur.kind === "ask") cur.asking = false;
        if (this.state === "idle") this.elapsed = 0;
        Object.assign(this, { state: "running", message: "" }).step();
        Panel.render();
      },
      // keep = you started something yourself: leave it running, just let the trainer put your settings back (attack style, prayers)
      pause(msg = "Paused", keep = false) { if (this.state === "running") { if (keep) { try { T?.halt?.(); } catch (e) { console.warn(TAG, e); } } else this.halt(); this.setState("paused", msg); } },
      stop() {
        this.halt();
        const cur = Queue.items.find((e) => e.id === this.activeId);
        if (cur && cur.status !== "done") { cur.status = "pending"; delete cur.startQty; delete cur.reason; }
        // a manual step that was waiting for you goes back to pending, so pressing Start later doesn't count it as done
        for (const e of Queue.items) if (e.status === "waiting") e.status = "pending";
        giveBackGear(Queue.items);
        this.release();
        Object.assign(this, { focusId: null, elapsed: 0, state: "idle", message: "Stopped" });
        Queue.save();
      },
      block(entry, reason) {
        Object.assign(entry, { status: "blocked", reason });
        this.halt(); this.release(); Queue.save();
        this.setState("paused", `Stopped at "${entry.label}": ${reason}. Fix it, then press Start.`);
      },
      // auto-sell: what a gather or craft step made beyond what it needed is sold (sellAll: everything it made). Never
      // anything you owned before the step started.
      sellExtra(entry) {
        try {
          if ((!Settings.get("autoSell") && !entry.sellAll) || (entry.kind !== "craft" && entry.kind !== "gather") || entry.startQty === undefined) return;
          const item = itemById(entry.itemId), bi = item?.sellsFor?.quantity > 0 && game.bank.items.get(item);
          if (!bi || bi.locked) return;
          const extra = Math.min(bi.quantity, bi.quantity - entry.startQty - (entry.sellAll ? 0 : entry.qty));
          if (!(extra >= 1)) return;
          const price = game.bank.getItemSalePrice(item, extra);
          game.bank.processItemSale(item, extra);
          entry.sold = `Sold ${num(extra)}${entry.sellAll ? "" : " extra"} for ${num(price)} ${nm(item.sellsFor.currency)}`;
        } catch (e) { console.warn(TAG, "auto-sell", e); }
      },
      finish(entry) { this.sellExtra(entry); entry.status = "done"; delete entry.reason; this.halt(this.actorOf(entry)); this.release(); Queue.save(); },
      wait(msg) { this.message = msg; Panel.render(); },
      step() {
        if (this.state !== "running") { this.lastTick = null; return; }
        const nowT = Date.now();
        if (this.lastTick) this.elapsed += Math.min(nowT - this.lastTick, 5000);
        this.lastTick = nowT;
        for (let guard = 0; guard < 100; guard++) {
          const cur = this.current();
          if (!cur) { this.leave(); return this.setState("idle", "Queue finished"); }

          // a goal (train to a level or an XP amount) never runs itself: the trainer works out the next batch of steps, they
          // go above it, and it comes back when they're done
          if (cur.kind === "train") {
            const sk = skillById(cur.skillId);
            if (!sk || sk.level >= cur.targetLevel || (cur.targetXp !== undefined && (sk.xp ?? 0) >= cur.targetXp)) { this.finish(cur); try { T?.trainFinished?.(cur); } catch (e) { console.warn(TAG, e); } continue; }
            if (!T?.plan) return this.block(cur, NO_TRAINER);
            const xpNow = Math.floor(sk.xp ?? 0);
            cur.stall = cur.lastXp !== undefined && xpNow <= cur.lastXp ? (cur.stall ?? 0) + 1 : 0;
            cur.lastXp = xpNow;
            if (cur.stall >= 2) return this.block(cur, "training isn't giving any XP, so the plan stopped. Check the steps above it");
            const nb = T.plan(cur);
            if (!nb.ok) return this.block(cur, nb.reason);
            cur.now = nb.note; if (nb.to !== undefined) cur.afterLevel = nb.to;
            Queue.insertBefore(cur.id, nb.entries);
            continue;
          }

          // an ask step asks you (or waits for you), then does it or skips it
          if (cur.kind === "ask") {
            const A = ASKS[cur.what], t = A?.target(cur), parent = Queue.items.find((x) => x.id === cur.parent);
            this.leave();
            if (!A) return this.block(cur, NO_TRAINER);
            if (!t) return this.block(cur, "this wasn't found in your game version");
            const did = A.done(cur, t);
            if (did) { cur.sold = did; this.finish(cur); continue; }
            if (cur.answer === "skip") {
              T?.changed?.();
              if (A.skip?.(cur, t, parent)) { cur.status = "pending"; Queue.save(); continue; }
              cur.sold = "Skipped"; this.finish(cur); continue;
            }
            const no = A.cannot?.(cur, t);
            if (no) return this.block(cur, no);
            if (cur.answer === "yes" || A.auto?.(cur)) {
              const r = A.act(cur, t, parent);
              secMemo.m.clear(); T?.changed?.(); // your bank, gear or task just changed
              if (r?.block) return this.block(cur, r.block);
              cur.sold = r; this.finish(cur); continue;
            }
            cur.status = "waiting";
            cur.info = `waiting for you: ${A.turn(cur, t)}`;
            Queue.save();
            // no window to answer: keep checking until you've done it
            if (!A.pop) { if (!cur.told) { cur.told = true; tellPlayer(`Action Queue: ${A.turn(cur, t)}`, skillById(cur.skillId)); } return Panel.render(); }
            if (!cur.asking) { cur.asking = true; askPop(cur, A.pop(cur, t)); }
            return this.setState("paused", `Your turn: ${A.turn(cur, t)}`);
          }
          if (cur.kind !== "manual" && !T) return this.block(cur, NO_TRAINER);

          // a different entry is now on top (we just started, or something was added above): switch to it
          if (this.activeId !== cur.id) {
            this.leave();
            Object.assign(this, { activeId: cur.id, activeActor: this.actorOf(cur) });
            cur.status = "active"; delete cur.reason;
            if (cur.kind !== "manual" && cur.startQty === undefined) cur.startQty = this.value(cur);
            Queue.save();
            if (cur.kind !== "manual" && !T.ticks?.(cur)) {
              const r = T.start(cur);
              // a step with no materials is handled below: it adds the steps to get them
              if (!r.ok && !r.noMaterials) return r.transient ? this.wait(r.reason) : this.block(cur, r.reason);
            }
            Object.assign(cur, { t0: Date.now(), g0: this.gained(cur) });
          }

          const got = this.value(cur);
          if (cur.kind === "manual") {
            if (got >= cur.qty || cur.ack) { this.finish(cur); continue; }
            cur.status = "waiting";
            this.release(); Queue.save();
            return this.setState("paused", `Your turn: ${cur.label} x${num(cur.qty)} (you have ${num(got)}). Do it, then press Start.`);
          }
          const us = cur.untilLevel && skillById(cur.untilSkill ?? cur.skillId);
          if (us && (us.level >= cur.untilLevel || (cur.untilXp && (us.xp ?? 0) >= cur.untilXp))) { this.finish(cur); continue; }
          if (got - (cur.startQty ?? 0) >= cur.qty) { this.finish(cur); continue; }

          // a step on a timer (Farming) has no action to run: the trainer plants, waits and harvests
          const tk = T.tick?.(cur);
          if (tk) {
            if (tk.block) return this.block(cur, tk.block);
            Object.assign(cur, { info: tk.note, readyAt: tk.readyIn > 0 ? Date.now() + tk.readyIn : undefined });
            return Panel.render();
          }
          // food, runes, ammo and prayer points can run out mid-step: stop before it isn't safe any more
          const chk = T.check?.(cur);
          if (chk && !chk.noMaterials) return this.block(cur, chk.why);
          if (!chk && T.running(cur)) return Panel.render();
          // something else started, or you picked another fight yourself
          if (T.foreign(cur)) return this.pause("Paused: something else started running.", true);

          // nothing is running and the target isn't reached: the game stopped it (materials, etc.) so try again once
          const r = chk ? { ok: false, reason: chk.why, noMaterials: true } : T.start(cur);
          if (r.ok) return Panel.render();
          if (r.transient) return this.wait(r.reason);
          const made = this.gained(cur), of = `(${num(made)} of ${num(cur.qty)} done)`;
          if (!r.noMaterials || !T.restock) return this.block(cur, `${r.reason} ${of}`);
          cur.restockStall = cur.restockMade !== undefined && made <= cur.restockMade ? (cur.restockStall ?? 0) + 1 : 0;
          cur.restockMade = made;
          const rs = T.restock(cur);
          if (!rs.ok || cur.restockStall >= 2) return this.block(cur, `${rs.ok ? "it keeps running out of materials without making more" : rs.reason} ${of}`);
          cur.restocks = (cur.restocks ?? 0) + 1;
          Queue.insertBefore(cur.id, rs.entries);
          this.message = cur.kind === "skill" ? `Short of materials for ${rs.name}: getting enough for ${plural(rs.crafts, "more try", "more tries")}` : `Short of materials for ${nm(itemById(cur.itemId))}: getting ${num(rs.remaining)} more worth`;
        }
      },
    };

    // ---------- duplicates and messages ----------
    const entryKey = (e) => `${e.kind}|${e.itemId ?? e.skillId ?? ""}|${e.actionId ?? e.forced ?? ""}|${e.targetXp ?? ""}`;
    const queuedKeys = () => new Set(Queue.items.filter((x) => x.status !== "done").map(entryKey));
    const dupHtml = (entries) => {
      const keys = queuedKeys(), dups = entries.filter((e) => keys.has(entryKey(e))), all = dups.length === entries.length;
      if (!dups.length) return "";
      return step(chips(chip(`${warnIcon}${all ? "This task is already in your queue" : `${dups.length} of ${entries.length} steps are already in your queue`}`, "warn")) +
        chips(...dups.map((e) => chip(esc(e.label)))) + note(all ? "Adding it again does nothing." : "Those steps will be skipped, the rest are added."));
    };
    // shown with the icon of the skill it's about, or the one the queue is on
    const tellPlayer = (msg, skill) => {
      const e = Queue.items.find((x) => x.status !== "done" && x.skillId);
      try { notifyPlayer(skill ?? (e && skillById(e.skillId)) ?? list(game.skills)[0], msg, "info"); } catch (err) { console.log(TAG, msg); }
    };
    const addUnique = (entries, top, skill) => {
      const seen = queuedKeys(), fresh = [], skipped = [];
      for (const e of entries) { const k = entryKey(e); if (seen.has(k)) skipped.push(e.label); else { seen.add(k); fresh.push(e); } }
      if (fresh.length) Queue.add(fresh, top);
      if (skipped.length) tellPlayer(fresh.length ? `${skipped.length} step${skipped.length === 1 ? " was" : "s were"} already in the queue and skipped: ${skipped.join(", ")}` : "That task is already in your queue.", skill);
      return fresh.length;
    };

    // ---------- floating panel ----------
    const POS_KEY = "aq-panel-pos";
    const toggleSetting = (name) => { Settings.set(name, !Settings.get(name)); Panel.last = ""; Panel.render(); };
    const ACTS = {
      close: () => Panel.close(), up: (id) => Queue.move(id, -1), down: (id) => Queue.move(id, 1), top: (id) => Queue.toTop(id), remove: (id) => Queue.remove(id),
      clear: () => Queue.clear(), cleardone: () => Queue.clearDone(), start: () => Runner.start(), pause: () => Runner.pause("Paused"), stop: () => Runner.stop(),
      first: (id) => Runner.doFirst(id), autostart: () => toggleSetting("autoStart"), autosell: () => toggleSetting("autoSell"), autobuy: () => toggleSetting("autoBuy"),
    };
    const small = (cls, html) => `<br><small class="${cls}">${html}</small>`;
    const Panel = {
      el: null, last: "",
      place(x, y) {
        x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - (this.el.offsetWidth || 350))); y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 48));
        Object.assign(this.el.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto", maxHeight: `min(70vh, ${Math.max(160, window.innerHeight - y - 8)}px)` });
      },
      ensure() {
        if (this.el) return this.el;
        document.getElementById("aq-queue-panel")?.remove();
        const el = (this.el = document.createElement("div"));
        el.id = "aq-queue-panel";
        let drag = null;
        el.addEventListener("pointerdown", (ev) => {
          if (!ev.target.closest("[data-drag]") || ev.target.closest("[data-act]")) return;
          const r = el.getBoundingClientRect();
          drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
          try { el.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ } ev.preventDefault();
        });
        el.addEventListener("pointermove", (ev) => { if (drag) this.place(ev.clientX - drag.dx, ev.clientY - drag.dy); });
        const endDrag = () => { if (!drag) return; drag = null; const r = el.getBoundingClientRect(); store(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); };
        for (const t of ["pointerup", "pointercancel"]) el.addEventListener(t, endDrag);
        el.addEventListener("click", (ev) => { const a = ev.target.closest("[data-act]"); if (a && !a.disabled) { ev.preventDefault(); ACTS[a.dataset.act]?.(a.dataset.id); } });
        window.addEventListener("resize", () => { if (el.style.left) { const r = el.getBoundingClientRect(); this.place(r.left, r.top); } });
        document.body.appendChild(el);
        try { const p = JSON.parse(stored(POS_KEY) ?? "null"); if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) this.place(p.x, p.y); } catch (e) { /* default position */ }
        return el;
      },
      row(e) {
        const isTrain = e.kind === "train", manual = e.kind === "manual", done = e.status === "done";
        const issue = !done && !manual && e.kind !== "ask" ? T?.issue?.(e) ?? null : null;
        const lead = done ? '<i class="fa fa-check text-success mr-2"></i>' : e.status === "active" ? '<i class="fa fa-play text-success mr-2"></i>'
          : e.status === "blocked" || e.status === "waiting" || issue ? '<i class="fa fa-exclamation-triangle text-warning mr-2"></i>'
          : '<i class="fa fa-circle mr-2" style="opacity:.25;font-size:8px;vertical-align:middle"></i>';
        const showProgress = !manual && !done && e.startQty !== undefined && (e.status === "active" || e.status === "blocked" || Runner.gained(e) > 0);
        const xpUnit = e.kind === "skill" ? " XP" : "";
        const amount = e.kind === "ask" ? (e.what === "buy" ? `x${num(e.qty)}` : "") : isTrain ? (e.xpGoal ? `${num(Math.floor(skillById(e.skillId)?.xp ?? 0))} / ${num(e.targetXp)} XP` : `Level ${skillById(e.skillId)?.level ?? 0} / ${e.targetLevel}`) : showProgress ? `${num(Runner.gained(e))} / ${num(e.qty)}${xpUnit}` : e.kind === "skill" ? `${num(e.qty)} XP` : `x${num(e.qty)}`;
        const btn = (act, ic, title, cls = "text-white-50") => `<a data-act="${act}" data-id="${esc(e.id)}" class="pointer-enabled ${cls} ml-2" title="${title}"><i class="fa ${ic}"></i></a>`;
        const sub = done && e.sold ? small("text-muted", esc(e.sold)) : e.reason ? small("text-warning", esc(e.reason))
          : issue ? small("text-warning", `<i class="fa fa-exclamation-triangle"></i> ${esc(issue)}`)
          : isTrain && e.now && !done ? small("text-muted", `now: ${esc(e.now)}`)
          : manual && !done ? small("text-muted", `do this yourself${e.status === "waiting" ? " (waiting for you)" : ""}`)
          : e.info && !done && (e.kind !== "ask" || e.status === "waiting") ? small("text-muted", esc(e.info))
          : e.kind === "ask" && !done ? small("text-muted", ASKS[e.what]?.hint?.(e) ?? (e.what === "buy" && Settings.get("autoBuy") ? "buys it without asking" : e.optional ? "optional, asks you first" : "asks you first")) : "";
        return `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07);${done ? "opacity:.5" : ""}" ${manual ? `title="${esc(e.note ?? "")}"` : ""}>` +
          `<div style="flex:1;min-width:0">${lead}${icon(isTrain ? skillById(e.skillId) : e.kind === "ask" ? askIcon(e) : e.kind === "skill" || e.kind === "kill" ? T?.icon?.(e) ?? skillById(e.skillId) : itemById(e.itemId))}<span class="${manual ? "text-muted font-italic" : ""}" style="${done ? "text-decoration:line-through" : ""}">${esc(e.label)}</span> <b>${amount}</b>` +
          `${Runner.focusId === e.id ? ' <span class="badge badge-success">first</span>' : ""}${sub}</div>` +
          (done ? btn("remove", "fa-times", "Remove") : btn("first", "fa-play-circle", "Do this first (keeps its place in the list)", "text-success") +
            btn("top", "fa-angle-double-up", "Move to top") + btn("up", "fa-arrow-up", "Move up") + btn("down", "fa-arrow-down", "Move down") + btn("remove", "fa-times", "Remove")) + `</div>`;
      },
      render() {
        if (!this.el) return;
        const q = Queue.items, pending = q.filter((e) => e.status !== "done").length, running = Runner.state === "running", eta = Runner.eta(), total = Runner.elapsed + eta.ms;
        const pct = pending === 0 ? (q.length ? 100 : 0) : total > 0 ? Math.min(99, Math.round((Runner.elapsed / total) * 100)) : 0;
        const status = running ? `Running: ${Runner.current()?.label ?? ""}` : Runner.message || (Runner.state === "paused" ? "Paused" : pending ? "Ready" : "Idle");
        const etaText = pending === 0 ? (q.length ? "All done" : "Queue is empty") : `${fmtDur(eta.ms)} left &middot; done around ${fmtClock(eta.ms)}` +
          (eta.manual ? ` <span class="text-muted">(+ ${eta.manual} manual step${eta.manual === 1 ? "" : "s"})</span>` : "") + (eta.unknown ? ` <span class="text-muted">(some steps can't be estimated)</span>` : "");
        const b = (act, label, ic, cls, disabled) => `<button class="btn btn-sm ${cls}" data-act="${act}" ${disabled ? "disabled" : ""} style="padding:2px 10px"><i class="fa ${ic} mr-1"></i>${label}</button>`;
        const as = Settings.get("autoStart"), sl = Settings.get("autoSell"), ab = Settings.get("autoBuy");
        const html =
          `<div data-drag class="aq-ph" title="Drag to move"><i class="fa fa-grip-vertical mr-2" style="opacity:.4"></i>` +
          `<a data-act="autostart" class="pointer-enabled mr-2" title="Auto-start: ${as ? "On" : "Off"}" style="font-size:19px;line-height:1;${as ? "color:#30c78d" : "opacity:.45"}"><i class="fa ${as ? "fa-toggle-on" : "fa-toggle-off"}"></i></a>` +
          `<a data-act="autosell" class="pointer-enabled mr-2" title="Auto-sell extras: ${sl ? "On" : "Off"}" style="font-size:15px;line-height:1;${sl ? "color:#e5ae67" : "opacity:.45"}"><i class="fa fa-dollar-sign"></i></a>` +
          `<a data-act="autobuy" class="pointer-enabled mr-2" title="Buy from the shop without asking: ${ab ? "On" : "Off"}" style="font-size:14px;line-height:1;${ab ? "color:#4fc3f7" : "opacity:.45"}"><i class="fa fa-shopping-cart"></i></a>` +
          `<b style="flex:1">Action Queue</b><span class="text-muted mr-2">${plural(pending, "action")} left</span><a data-act="close" class="pointer-enabled text-white" title="Close"><i class="fa fa-times"></i></a></div>` +
          `<div data-list style="overflow:auto;padding:4px 10px;flex:1">` +
          (q.length ? q.map((e) => this.row(e)).join("") : `<div class="text-muted py-3 text-center">Nothing queued yet.<br>Skill Trainer and Township Task Helper add their steps here.</div>`) +
          `</div><div class="aq-pf"><div class="aq-bar"><div style="width:${pct}%"></div><span>${pct}%</span></div>` +
          `<div style="margin-top:6px"><small class="${Runner.state === "paused" ? "text-warning" : running ? "text-success" : "text-muted"}">${esc(status)}</small></div>` +
          `<div style="margin-bottom:8px"><small>${etaText}</small></div>` +
          `<div class="aq-btns">${b("start", Runner.state === "paused" ? "Resume" : "Start", "fa-play", "btn-success", running || pending === 0)}${b("pause", "Pause", "fa-pause", "btn-warning", !running)}${b("stop", "Stop", "fa-stop", "btn-danger", Runner.state === "idle")}</div>` +
          `<div class="aq-btns" style="margin-top:6px">${b("cleardone", "Clear Queue", "fa-check", "btn-secondary", !q.some((e) => e.status === "done"))}${b("clear", "Clear All", "fa-trash", "btn-outline-danger", q.length === 0)}</div></div>`;
        if (html === this.last) return;
        const top = this.el.querySelector("[data-list]")?.scrollTop ?? 0;
        this.el.innerHTML = this.last = html;
        const box = this.el.querySelector("[data-list]"); if (box) box.scrollTop = top;
      },
      open() { this.ensure().style.display = "flex"; this.last = ""; this.render(); },
      close() { if (this.el) this.el.style.display = "none"; },
      toggle() { this.ensure(); this.el.style.display === "flex" ? this.close() : this.open(); },
    };

    // ---------- minibar buttons (bottom-right menu), sized like their neighbours ----------
    const mountButton = () => {
      const bar = document.getElementById("skill-footer-minibar");
      if (!bar) return;
      const mk = (id, title, html, onClick, before) => {
        let b = document.getElementById(id);
        if (b) return b;
        bar.insertBefore((b = Object.assign(document.createElement("button"), { id, title, className: "btn btn-sm btn-light", innerHTML: html })), before ?? null);
        b.addEventListener("click", () => { try { onClick(); } catch (e) { console.warn(TAG, e); } b.blur(); });
        return b;
      };
      const iconHtml = (fa, size) => `<i class="fa ${fa} text-dark aq-ico" style="font-size:${size}px"></i>`;
      const q = mk("aq-queue-btn", "Action Queue", iconHtml("fa-list-ol", 17) + '<span class="aq-count"></span>', () => Panel.toggle());
      updateBadge();
      sizeLike(q);
    };
    // other mods' minibar buttons go next to the queue button, sized like their neighbours
    const sizeLike = (b) => {
      const bar = document.getElementById("skill-footer-minibar"), ref = bar && [...bar.children].find((c) => !c.id?.startsWith("aq-") && !c.id?.startsWith("mst-") && !c.id?.startsWith("mbd-") && c.offsetWidth > 0);
      if (ref) Object.assign(b.style, { width: ref.offsetWidth + "px", height: ref.offsetHeight + "px" });
    };
    const addButton = (id, title, fa, size, onClick) => {
      const bar = document.getElementById("skill-footer-minibar");
      if (!bar) return null;
      let b = document.getElementById(id);
      if (!b) {
        bar.insertBefore((b = Object.assign(document.createElement("button"), { id, title, className: "btn btn-sm btn-light", innerHTML: `<i class="fa ${fa} text-dark aq-ico" style="font-size:${size}px"></i>` })), document.getElementById("aq-queue-btn"));
        b.addEventListener("click", () => { try { onClick(); } catch (e) { console.warn(TAG, e); } b.blur(); });
      }
      sizeLike(b);
      return b;
    };

    // ---------- install ----------
    const CSS = `
      .aq-pop{text-align:center} .aq-note{margin-top:8px;font-size:12px;opacity:.7}
      .aq-step{background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.3);border-radius:8px;padding:8px 10px;margin:0 0 8px}
      .aq-stepno{font-size:12px;font-weight:600;opacity:.7;margin-bottom:2px} .aq-title{font-size:15px;margin:2px 0 6px}
      .aq-chips{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px;margin-top:4px}
      .aq-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 9px;border-radius:11px;background:rgba(127,127,127,.22);font-size:12px;line-height:20px}
      .aq-chip img,.aq-title img.skill-icon-xs{width:18px;height:18px;margin:0 3px 0 0;vertical-align:middle}
      .aq-chip.ok{background:rgba(48,199,141,.25);color:#2fb67a} .aq-chip.warn{background:rgba(229,174,103,.25);color:#c98a2b}
      .aq-chip.lbl{background:transparent;padding-left:0;opacity:.85} .aq-chip>span{display:inline;line-height:20px} .aq-chip small{opacity:.8;font-size:.8em}
      .aq-form{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;align-items:center;text-align:left;margin:0 0 10px}
      .aq-form label{margin:0;font-size:13px;opacity:.85} .aq-form select,.aq-form input[type=number]{width:100%}
      .aq-swal .swal2-actions{display:flex;justify-content:center;align-items:center;gap:5px;flex-wrap:nowrap;margin:1em auto 0}
      .aq-swal .swal2-actions :is(.swal2-deny,.swal2-cancel,.swal2-confirm){height:36px!important;padding:0 16px!important;font-size:14px!important;line-height:1!important;box-sizing:border-box!important;
        display:inline-flex!important;align-items:center!important;justify-content:center!important;box-shadow:none!important;outline:none!important;margin:0!important}
      .aq-swal .swal2-deny{order:1} .aq-swal .swal2-cancel{order:2} .aq-swal .swal2-confirm{order:3;min-width:84px!important}
      #aq-queue-panel{position:fixed;right:68px;bottom:16px;width:min(350px,calc(100% - 16px));max-height:70vh;display:none;flex-direction:column;z-index:1050;background:rgba(28,32,41,.98);color:#fff;
        border:1px solid rgba(255,255,255,.15);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:13px}
      .aq-ph{display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);cursor:move;user-select:none;touch-action:none}
      .aq-pf{padding:10px;border-top:1px solid rgba(255,255,255,.12);text-align:center} .aq-btns{display:flex;justify-content:center;gap:6px}
      .aq-bar{position:relative;height:16px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden} .aq-bar>div{height:100%;background:#30c78d;transition:width .8s}
      .aq-bar>span{position:absolute;left:0;right:0;top:0;line-height:16px;font-size:11px;font-weight:600;text-shadow:0 0 3px rgba(0,0,0,.7)}
      #aq-queue-btn{position:relative} .aq-ico{display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;vertical-align:middle}
      @media (max-width:440px){#aq-queue-panel{right:8px}}
    .aq-count{display:none;position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#17a2b8;color:#fff;font-size:10px;font-weight:600;line-height:17px;text-align:center}`;
    const install = () => {
      document.getElementById("aq-style")?.remove();
      document.head.appendChild(Object.assign(document.createElement("style"), { id: "aq-style", textContent: CSS }));
      Queue.load(); mountButton();
      clearInterval(window.__aqTimer);
      window.__aqTimer = setInterval(mountButton, 2000); // the game can rebuild the menu; put the button back if it vanishes
      clearInterval(window.__aqRunTimer);
      window.__aqRunTimer = setInterval(() => { try { Runner.step(); } catch (e) { console.warn(TAG, "runner", e); } }, 1000);
      console.log(TAG, "installed", VERSION);
      parts.installed = true;
    };

    // ---------- what other mods can use ----------
    // Mods reach this as mod.api.actionQueue (or window.actionQueue when pasted into the console).
    const ui = { list, nm, esc, num, plural, aOr, icon, chip, chips, step, note, warnIcon, fmtDur, fmtClock, costText, costsOf, popHtml, MANUAL_NOTE };
    const API = {
      version: VERSION, ui, settings: Settings,
      queue: { items: () => Queue.items, add: (entries, top = false, skill) => addUnique(entries, top, skill), dupHtml, remove: (id) => Queue.remove(id) },
      runner: { start: () => Runner.start(), pause: (m) => Runner.pause(m), stop: () => Runner.stop(), gained: (e) => Runner.gained(e), get state() { return Runner.state; } },
      panel: { open: () => Panel.open(), close: () => Panel.close() },
      shop: { for: shopFor, perBuy, issue: buyIssue, canBuy },
      // Skill Trainer registers itself here; see "the trainer" above
      setTrainer: (t) => { if (T?.builtIn && !t?.builtIn) return void console.warn(TAG, "ignored a trainer from another mod, Skill Trainer is part of Action Queue now"); T = t; Panel.last = ""; Panel.render(); },
      // a function, not a getter: the game copies this object for mod.api, and a getter would be read once at load
      hasTrainer: () => !!T,
      addAsk: (what, def) => { if (what && def?.target && what !== "buy" && !(ASKS[what]?.builtIn && !def.builtIn)) ASKS[what] = def; },
      addButton, tell: tellPlayer,
      // for testing
      _dev: { Queue, Runner, Panel, secMemo },
    };
    try { ctx?.api?.(API); } catch (e) { console.warn(TAG, "could not register the mod API", e); }
    window.actionQueue = API;
    parts.aq = API;
    const ready = () => typeof game !== "undefined" && list(game?.skills).length > 0 && typeof SwalLocale !== "undefined" && document.getElementById("skill-footer-minibar");
    if (ready()) install();
    else { const timer = setInterval(() => { if (ready()) { clearInterval(timer); install(); } }, 500); }
  })();

  // ======================================================================================================================
  // 2. Training (was the Skill Trainer mod)
  // ======================================================================================================================
  (() => {

    const TAG = "[Skill Trainer]";
    // the queue part above holds the queue, its panel and settings, and runs the steps through the trainer below
    let A = null;
    const aq = () => parts.aq;

    // ---------- small helpers ----------
    const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
    const nm = (o) => String(o?.name ?? o?._name ?? o?._localID ?? o?.id ?? "?");
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = (n) => Number(n).toLocaleString();
    const plural = (n, w, ws = w + "s") => `${num(n)} ${n === 1 ? w : ws}`;
    const aOr = (w) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;
    const icon = (o) => (typeof o?.media === "string" ? `<img class="skill-icon-xs mr-1" src="${esc(o.media)}">` : "");
    const have = (item) => { try { const q = game.bank.getQty(item); return Number.isFinite(q) ? q : null; } catch (e) { return null; } };
    const owned = (item) => have(item) ?? 0;
    const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { return false; } return true; };
    const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const itemById = (id) => { try { return game.items.getObjectByID(id); } catch (e) { return null; } };
    const skillById = (id) => list(game.skills).find((s) => s.id === id);
    const lvl = (a) => a.level ?? 1;
    const fail = (reason, extra) => ({ ok: false, reason, ...extra });
    const warnIcon = '<i class="fa fa-exclamation-triangle"></i>&nbsp;';
    const chip = (html, cls = "", title = "") => `<span class="aq-chip ${cls}"${title ? ` title="${esc(title)}"` : ""}><span>${html}</span></span>`;
    const chips = (...c) => `<div class="aq-chips">${c.join("")}</div>`;
    const step = (body) => `<div class="aq-step">${body}</div>`;
    const note = (t) => `<div class="aq-note">${t}</div>`;

    // ---------- settings ----------
    // Skill Trainer's own switch lives in the mod settings menu (ctx.settings), with localStorage as the fallback. The queue's
    // switches (auto-start, auto-sell, auto-buy, crops) live in Action Queue.
    const SETTINGS = {
      preferMastery: ["mst-mastery", false, "Prefer mastery XP when training a skill",
        "When on, the planner counts the mastery XP a method gives next to the skill XP, and sticks with a method longer so its mastery keeps growing. When off, it only looks at skill XP per hour."],
    };
    let section = null;
    try {
      if (ctx?.settings) {
        section = ctx.settings.section("Training");
        for (const [name, [, def, label, hint]] of Object.entries(SETTINGS)) section.add({ type: "switch", name, label, hint, default: def });
      }
    } catch (e) { section = null; console.warn(TAG, "could not register settings", e); }
    const Settings = {
      get(name) { try { const v = section?.get(name); if (v !== undefined && v !== null) return !!v; } catch (e) { /* use the fallback */ } const raw = stored(SETTINGS[name][0]); return raw !== null ? raw === "1" : SETTINGS[name][1]; },
      set(name, v) { try { section?.set(name, !!v); } catch (e) { console.warn(TAG, "settings", e); } store(SETTINGS[name][0], v ? "1" : "0"); },
    };
    const mastery = () => Settings.get("preferMastery");

    // ---------- skills and their methods ----------
    // The skills the queue can run on its own. Anything else a recipe needs (herbs, feathers, monster drops) becomes a step the
    // player does themselves, unless the bank already holds enough of it.
    const COMBAT = new Set(["Attack", "Strength", "Defence", "Hitpoints", "Ranged", "Magic", "Prayer", "Slayer"].map((s) => "melvorD:" + s));
    const TRAINABLE = new Set(["Woodcutting", "Mining", "Fishing", "Cooking", "Smithing", "Fletching", "Crafting", "Runecrafting", "Herblore",
      "Firemaking", "Thieving", "Summoning", "Astrology", "Agility", "Farming"].map((s) => "melvorD:" + s).concat("melvorItA:Harvesting", "melvorAoD:Archaeology", "melvorAoD:Cartography", ...COMBAT));
    const isTrainable = (s) => !!s && TRAINABLE.has(s.id);
    const MAGIC = "melvorD:Magic", FARMING = "melvorD:Farming", MELVOR = "melvorD:Melvor";
    // skills that only count as a source for things no other skill makes (Bone Offering makes Bones, Farming grows trees)
    const EXTRA = new Set([MAGIC, FARMING]);
    // actions from another realm only count once that realm is unlocked and they give normal XP
    const realmOk = (a) => !a.realm || a.realm.id === MELVOR || (a.realm.isUnlocked === true && (a.baseExperience ?? 0) > 0);
    const MANUAL_NOTE = "The queue can't get this on its own, so it's a step you do yourself";
    const fmtDur = (ms) => { if (!isFinite(ms)) return "an unknown time"; const m = Math.round(ms / 60000); return m < 1 ? "under 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
    const intervalMs = (skill, a) => a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
    // Cooking burns some food: costs are used every attempt, but the product and the XP only come from the ones that work.
    const succ = (skill, a) => { try { const c = skill?.id === "melvorD:Cooking" ? Number(skill.getRecipeSuccessChance(a)) : 100; if (c > 0 && c < 100) return Math.max(0.05, c / 100); } catch (e) { /* never fails */ } return 1; };
    const baseCosts = (a) => (Array.isArray(a.itemCosts) ? a.itemCosts : []);
    const NO_COSTS = [{ costs: [], mult: 1 }];
    // a hit the player takes while away is safe when auto eat starts above the biggest hit and there is food to eat
    const NM = () => (typeof numberMultiplier === "number" ? numberMultiplier : 10);
    const player = () => game.combat?.player;
    const resistance = () => Number(player()?.stats.getResistance?.(game.normalDamage)) || 0;
    // a hit you take while away is safe when auto eat starts above the biggest hit and there is food to eat.
    // A few pieces of food stay in reserve, so the step stops before the last one is gone.
    // mode "self": you said you'll stay and eat yourself for this fight, so only food and a hit that kills from full HP count.
    // mode "noAuto": the "Fights don't need auto eat" setting is on, so anything that can't take half your HP is fine.
    const takeSafety = (max, mode = null) => {
      try {
        const pl = player(), slot = pl.food.slots[pl.food.selectedSlot], hp = pl.stats.maxHitpoints, eat = Number(pl.autoEatThreshold) || 0;
        const noFood = !slot?.item || !(slot.quantity > 0) || slot.item.id === "melvorD:Empty_Food";
        if (mode === "self") {
          if (noFood) return { ok: false, hard: true, why: "you have no food equipped" };
          if (max >= hp) return { ok: false, hard: true, why: `it can hit for ${num(max)}, more than your ${num(hp)} HP, so it could kill you in one hit even if you eat` };
          return { ok: true, self: true };
        }
        if (!(max > 0)) return { ok: true };
        if (max * 2 >= hp) return { ok: false, why: `it can hit for ${num(max)} against your ${num(hp)} HP` };
        if (mode === "noAuto") return { ok: true };
        if (noFood) return { ok: false, why: "you have no food equipped" };
        if (slot.quantity < 3) return { ok: false, why: "you're almost out of food" };
        if (eat <= 0) return { ok: false, why: "auto eat is off, so nothing eats your food while the queue runs" };
        if (eat < max) return { ok: false, why: `auto eat starts at ${num(Math.round(eat))} HP but it can hit for ${num(max)}` };
        return { ok: true };
      } catch (e) { return { ok: false, why: "your combat stats couldn't be read" }; }
    };
    // numbers the planner asks for many times (fights, the shop, your bones) are worked out once a second
    const secMemo = { t: 0, m: new Map() };
    const perSec = (key, fn) => {
      const t = Math.floor(Date.now() / 1000);
      if (t !== secMemo.t) Object.assign(secMemo, { t, m: new Map() });
      if (!secMemo.m.has(key)) secMemo.m.set(key, fn());
      return secMemo.m.get(key);
    };
    const costText = (x) => [...x.cur.map((k) => `${num(k.quantity)} ${nm(k.currency)}`), ...x.items.map((k) => `${num(k.quantity)} ${nm(k.item)}`)].join(" + ") || "free";
    const costsOf = (c) => ({ c, items: c.getItemQuantityArray(), cur: c.getCurrencyQuantityArray() });
    const hitSafety = (maxHit, realm) => takeSafety(Math.floor((Number(maxHit) || 0) * NM() * (1 - (!realm || realm.id === MELVOR ? resistance() : 0) / 100)));
    // A method is one way to train: what an attempt costs (options, the first is used), what it makes (product, qty), how long it
    // takes (ms), the XP it gives, the share of attempts that work (succ) and how to start it. Most come straight from an action.
    const method = (skill, a, over = {}) => Object.defineProperties({
      id: a.id, skill, a, name: nm(a), xp: a.baseExperience ?? 0,
      get level() { return lvl(a); }, get media() { return a.media ?? this.product?.media; }, get product() { return a.product ?? null; }, get qty() { return a.baseQuantity ?? 1; },
      get options() { return (a.alternativeCosts?.length ? a.alternativeCosts.map((o) => ({ costs: o.itemCosts ?? [], mult: o.quantityMultiplier ?? 1 })) : NO_COSTS).map((o) => ({ costs: [...baseCosts(a), ...o.costs].filter((k) => k?.item), mult: o.mult })); },
      get succ() { return succ(skill, a); }, get ms() { return intervalMs(skill, a); },
      start: (e) => (STARTERS[skill.id] ?? startCraft)(skill, a, e),
    }, Object.getOwnPropertyDescriptors(over));
    const nonShardQty = (skill, a, item) => {
      try { const cost = item.sellsFor?.currency?.id === "melvorItA:AbyssalPieces" ? Summoning.recipeAPCost : Summoning.recipeGPCost; return skill.modifyNonShardItemCost(item, cost / Math.max(20, item.sellsFor?.quantity ?? 0), a); } catch (e) { return 1; }
    };
    // spells that only take runes and set items, and Superheat (ores into a bar). Spells that destroy an item you pick are left out.
    const magicMethods = (skill) => {
      const runes = (sp) => { try { return game.combat.player.getRuneCosts(sp); } catch (e) { return sp.runesRequired ?? []; } };
      const cast = (sp, bar) => () => { skill.selectSpellOnClick(sp); if (bar) skill.selectBarOnClick(bar); if (!skill.isActive) skill.castButtonOnClick(); };
      const bars = list(game.smithing?.actions).filter((r) => r.category?.id === "melvorD:Bars" && realmOk(r) && r.product);
      return list(skill.actions).filter(realmOk).flatMap((sp) => {
        const t = sp.specialCost?.type, fixed = sp.fixedItemCosts ?? [], base = { qty: sp.productionRatio ?? 1, ms: skill.baseInterval ?? 2000, succ: 1 };
        if (t === -5 && sp.produces && typeof sp.produces === "object")
          return [method(skill, sp, { ...base, product: sp.produces, get options() { return [{ costs: [...runes(sp), ...fixed], mult: 1 }]; }, start: cast(sp) })];
        // spells that use up an item you pick (Just Learning, Item Alchemy): cast them on whatever the queue can get the
        // quickest, so the item counts as part of the work. Alchemy turns it into GP as well.
        if (t === -1) return [method(skill, sp, {
          ...base, own: true, product: typeof sp.produces === "object" ? sp.produces : null,
          get pick() { return perSec(`alt|${sp.id}`, () => altFeed(skill, sp)); },
          get name() { const p = this.pick; return p ? `${nm(sp)} (${nm(p.item)}${p.gp ? `, ${num(Math.round(p.gp))} GP each` : ""})` : nm(sp); },
          get media() { return this.pick?.item.media ?? sp.media; },
          get options() { const it = this.pick?.item; return [{ costs: [...(it ? [{ item: it, quantity: sp.specialCost.quantity ?? 1 }] : []), ...runes(sp), ...fixed], mult: 1 }]; },
          need: () => (perSec(`alt|${sp.id}`, () => altFeed(skill, sp)) ? null : "there's nothing the queue can get to cast it on"),
          start: () => { const it = altFeed(skill, sp)?.item; if (!it) return fail("there's nothing the queue can get to cast it on"); skill.selectSpellOnClick(sp); skill.selectItemOnClick(it); if (!skill.isActive) skill.castButtonOnClick(); },
        })];
        if (t !== -3 && t !== -4) return [];
        return bars.map((r) => method(skill, sp, {
          ...base, id: `${sp.id}|${r.id}`, name: `${nm(sp)} (${nm(r.product)})`, media: r.product.media, product: r.product, own: true, start: cast(sp, r),
          need: (lv) => (levelIn(game.smithing, lv) >= lvl(r) ? null : `needs Smithing level ${lvl(r)}`),
          get options() { return [{ costs: [...r.itemCosts.filter((k) => t === -3 || k.item.id !== "melvorD:Coal_Ore").map((k) => ({ item: k.item, quantity: k.quantity * (sp.specialCost.quantity ?? 1) })), ...runes(sp), ...fixed], mult: 1 }]; },
        }));
      });
    };
    // the item an "any item" spell is cast on: one the queue can gather or make, with the most XP per hour counting the time to
    // get it (for alchemy, the one that makes the most GP among the fastest). It never picks items only the shop, monsters or you can get.
    const altFeed = (skill, sp) => {
      const out = [], castMs = skill.baseInterval ?? 2000, q = sp.specialCost?.quantity ?? 1, prod = typeof sp.produces === "object" ? sp.produces : null;
      const alch = typeof sp.produces !== "object" && sp.produces === -1;
      for (const id of new Set([...index().gatherers.keys(), ...index().crafters.keys()])) {
        const item = itemById(id);
        if (!item || item === prod || !(item.sellsFor?.quantity > 0) || item.sellsFor.currency?.id !== "melvorD:GP") continue;
        const t = makeTime(item, q);
        if (!isFinite(t.ms)) continue;
        let gp = 0;
        if (alch) { try { gp = Number(skill.getAlchemyGP(item, sp.productionRatio ?? 0)) || 0; } catch (e) { gp = item.sellsFor.quantity * (sp.productionRatio ?? 0); } }
        out.push({ item, ms: castMs + t.ms, gp });
      }
      // anything within 10% of the fastest counts as just as good, and then the one that makes the most GP wins
      const fast = Math.min(...out.map((x) => x.ms));
      return out.filter((x) => x.ms <= fast * 1.1).sort((a, b) => b.gp - a.gp || a.ms - b.ms)[0] ?? null;
    };
    // what is special about each skill's actions; skills not listed use their actions as they are
    const SKILLS = {
      "melvorD:Herblore": (s, a) => method(s, a, { get product() { return a.product ?? a.potions?.[Math.min(a.potions.length - 1, Math.max(0, s.getPotionTier?.(a) ?? 0))] ?? null; }, get qty() { return a.product ? a.baseQuantity ?? 1 : 1; } }),
      "melvorD:Firemaking": (s, a) => method(s, a, { product: null, name: nm(a.log ?? a), media: a.log?.media, options: [{ costs: a.log ? [{ item: a.log, quantity: 1 }] : [], mult: 1 }] }),
      "melvorD:Thieving": (s, a) => method(s, a, {
        product: null, options: NO_COSTS, safe: () => hitSafety(a.maxHit, a.realm),
        get succ() { return Math.min(1, Math.max(0.01, (Number(s.getNPCSuccessRate?.(a)) || 100) / 100)); },
        // a failed attempt stuns you, unless you avoid the stun
        get ms() { return (s.baseInterval ?? 3000) + (1 - this.succ) * (1 - (Number(s.stunAvoidanceChance) || 0) / 100) * (s.baseStunInterval ?? 3000); },
        start: () => (a.area ? s.startThieving(a.area, a) : fail("no thieving area found for this target")),
      }),
      "melvorD:Astrology": (s, a) => method(s, a, { product: null, options: NO_COSTS, get ms() { return Number(s.getConstellationInterval?.(a)) || intervalMs(s, a); }, start: () => s.studyConstellationOnClick(a) }),
      "melvorItA:Harvesting": (s, a) => method(s, a, { product: null, options: NO_COSTS, start: () => s.onVeinClick(a) }),
      "melvorD:Summoning": (s, a) => method(s, a, {
        get options() { const shards = baseCosts(a).filter((k) => k?.item), alts = a.nonShardItemCosts ?? []; return alts.length ? alts.map((item) => ({ costs: [...shards, { item, quantity: nonShardQty(s, a, item) }], mult: 1 })) : [{ costs: shards, mult: 1 }]; },
        start: (e) => { s.selectRecipeOnClick(a); s.selectNonShardCostOnClick?.(e.altIndex ?? 0); if (!s.isActive) s.createButtonOnClick(); },
      }),
    };
    // ---------- Farming: plant, wait for the crop to grow, harvest ----------
    // Farming has no action to start. Crops grow on real-time timers, so a Farming step plants what it needs on the plots
    // you've unlocked, with seeds you own, waits, and harvests. One planting is one attempt; plots grow side by side.
    const PLOT = { empty: 1, growing: 2, grown: 3, dead: 4 };
    const openPlots = (f, r) => { let p = []; try { p = [...(f.getPlotsForCategory(r.category) ?? [])]; } catch (e) { /* use the list */ } return (p.length ? p : list(f.plots).filter((x) => x.category === r.category)).filter((x) => x.state !== 0); };
    const growMs = (f, r) => { try { return f.modifyInterval(r.baseInterval, r) || r.baseInterval; } catch (e) { return r.baseInterval; } };
    const seedCost = (f, r) => { try { return f.getRecipeSeedCost(r); } catch (e) { return r.seedCost?.quantity ?? 1; } };
    // without compost a crop only grows about half the time, and a dead crop gives nothing. Compost you own goes on a plot
    // before it's planted (Weird Gloop and other kinds are left for you to use).
    const COMPOST = "melvorD:Compost";
    const compostPer = () => { const c = itemById(COMPOST); return c?.compostValue > 0 ? Math.ceil(100 / c.compostValue) : Infinity; };
    const cropChance = (f, r, level = owned(itemById(COMPOST)) >= compostPer() ? 100 : 0) => { try { return Math.min(1, Math.max(0.05, f.getPlotGrowthChance({ compostLevel: level, plantedRecipe: r }) / 100)); } catch (e) { return 1; } };
    const compostPlot = (f, p) => {
      const c = itemById(COMPOST), n = c?.compostValue > 0 ? Math.ceil((100 - (p.compostLevel ?? 0)) / c.compostValue) : 0;
      if (n > 0 && owned(c) >= n) try { f.compostPlot(p, c, n); } catch (e) { console.warn(TAG, "compost", e); }
    };
    const farmTick = (f, r, e) => {
      const plots = openPlots(f, r), mine = (p) => p.plantedRecipe === r, m = methodById(f, r.id);
      if (!plots.length) return { block: `you haven't unlocked any ${nm(r.category)} plots yet` };
      for (const p of plots) if (mine(p) && p.state === PLOT.dead) f.clearDeadPlot(p);
      for (const p of plots) if (mine(p) && p.state === PLOT.grown) f.harvestPlot(p);
      const left = e.qty - A.runner.gained(e), growing = plots.filter((p) => mine(p) && p.state === PLOT.growing).length;
      if (left <= 0) return {};
      const want = Math.ceil(left / Math.max(1e-9, e.kind === "skill" ? m.xp * m.succ : Math.max(1, m.qty) * m.succ)) - growing;
      if (want > 0) {
        const empty = plots.filter((p) => p.state === PLOT.empty), cost = seedCost(f, r), seeds = owned(r.seedCost.item);
        const n = Math.min(want, empty.length, Math.floor(seeds / cost)), timers = new Map();
        // the game starts one growth timer per planting time, the same way its own Plant All button does
        for (const p of empty.slice(0, n)) { compostPlot(f, p); const t = f.plantPlot(p, r); if (t > 0 && p.state === PLOT.growing) timers.set(t, [...(timers.get(t) ?? []), p]); }
        timers.forEach((ps, t) => f.createGrowthTimer(ps, t));
        if (n === 0 && !growing) return { block: empty.length ? `needs ${cost} ${nm(r.seedCost.item)} to plant ${nm(r)} and you have ${seeds}` : `all your ${nm(r.category)} plots are busy with other crops. Harvest or clear them` };
      }
      const now = plots.filter((p) => mine(p) && p.state === PLOT.growing);
      if (!now.length) return {};
      const times = now.map((p) => { try { return f.getPlotGrowthTime(p); } catch (err) { return 0; } });
      return { note: `waiting for ${nm(r)} to grow: ${plural(now.length, "plot")} planted, ready in ${fmtDur(Math.max(...times))}`, readyIn: Math.min(...times) };
    };
    SKILLS[FARMING] = (s, r) => method(s, r, {
      get options() { return [{ costs: r.seedCost?.item ? [{ item: r.seedCost.item, quantity: seedCost(s, r) }] : [], mult: 1 }]; },
      get succ() { return cropChance(s, r); },
      // XP per planting: base XP when planted (for some kinds), then base XP per crop (or once) when a grown crop is harvested.
      // The planner counts xp x succ as the average, so the planting part is divided back out.
      get xp() { const b = r.baseExperience ?? 0; return (r.category?.giveXPOnPlant ? b / this.succ : 0) + b * (r.category?.scaleXPWithQuantity ? r.baseQuantity ?? 1 : 1); },
      get ms() { const n = openPlots(s, r).length; return n ? growMs(s, r) / n : Infinity; },
      need: () => (openPlots(s, r).length ? null : `needs an unlocked ${nm(r.category)} plot`),
      tick: (e) => farmTick(s, r, e), start: () => fail("Farming steps plant and harvest instead"),
    });
    // Archaeology digs at sites that have a map with charges and tools picked. An Archaeology goal with no map offers to make
    // one in Cartography (you confirm it), and picks the tools for you.
    const ARCH = "melvorAoD:Archaeology";
    SKILLS[ARCH] = (s, site) => method(s, site, {
      product: null, options: NO_COSTS, get xp() { return s.getBaseSkillXPForDigSite?.(site) ?? 0; }, get ms() { return s.getDigSiteInterval?.(site) ?? intervalMs(s, site); },
      need: () => (s.canExcavate?.(site) ? null : `needs a map for ${nm(site)} with charges, and your tools picked (maps come from Cartography)`),
      check: () => (site.selectedMap?.charges > 0 ? null : { why: `the ${nm(site)} map is out of charges` }), start: () => s.startDigging(site),
    });
    // every tool goes on a site that has a map but no tools picked yet
    const pickTools = (site) => { const ar = game.archaeology; if (site.selectedMap && !site.selectedTools?.length) for (const t of list(ar.tools)) try { ar.setToolAsActive(site, t); } catch (e) { /* tool not available */ } };
    // the dig site to make a map for: found on the map, open at your level, room for another map, best XP first
    const mapSite = () => {
      const ar = game.archaeology, sites = list(ar?.actions).filter((x) => realmOk(x) && lvl(x) <= ar.level && x.maps.length < (x.getMaxMaps?.() ?? 1));
      const found = sites.filter((x) => x.poi?.isDiscovered).sort((a, b) => xpRate(methodById(ar, b.id)) - xpRate(methodById(ar, a.id)));
      return { site: found[0] ?? null, hidden: sites.length > 0 && !found.length };
    };
    // Agility runs the course you've built; a lap gives the XP of every obstacle. The course builder below fills empty slots.
    const AGILITY = "melvorD:Agility";
    const agilityMethods = (s) => {
      const built = () => [...(s.activeCourse?.builtObstacles?.values?.() ?? [])];
      return [method(s, { id: "agility:course", name: "Run your course", media: s.media }, {
        product: null, options: NO_COSTS, level: 1, noMastery: true,
        get xp() { return built().reduce((t, o) => t + (o.baseExperience ?? 0), 0); },
        get ms() { const o = built(); return o.length ? o.reduce((t, x) => t + (s.getObstacleInterval?.(x) ?? x.baseInterval ?? 3000), 0) : Infinity; },
        need: () => (s.activeCourse?.builtObstacles?.has?.(0) ? null : "build at least the first obstacle of your Agility course"),
        start: () => s.startAgilityOnClick(),
      })];
    };
    // ---------- Agility course builder ----------
    // For each empty slot you've unlocked: the obstacle with the most XP per second of lap time that meets its requirements, has no
    // negative bonus, costs GP you have and items you own or the queue can gather. Nothing is built until you confirm it,
    // obstacles you built are never replaced, and a slot you skip stays empty for that goal.
    const buildCosts = (o) => costsOf(game.agility.getObstacleBuildCosts(o));
    const agilityPicks = (skip = []) => {
      const ag = game.agility, course = ag?.activeCourse, picks = [];
      (course?.obstacleSlots ?? []).forEach((slot, i) => {
        if (!ag.isSlotUnlocked(slot) || course.builtObstacles.has(i) || skip.includes(i)) return;
        const ok = list(ag.actions).filter((o) => o.category === i && (o.realm?.id ?? MELVOR) === (course.realm?.id ?? MELVOR) && game.checkRequirements(o.skillRequirements ?? []) && !(o.modifiers ?? []).some((v) => v.isNegative)).map((o) => ({ o, slot: i, ...buildCosts(o), xpSec: (o.baseExperience ?? 0) / ((ag.getObstacleInterval?.(o) ?? o.baseInterval) / 1000) }))
          .filter((x) => x.cur.every((k) => (k.currency.amount ?? 0) >= k.quantity) && x.items.every((k) => owned(k.item) >= k.quantity || isFinite(makeTime(k.item, k.quantity).ms)));
        const best = ok.sort((a, b) => b.xpSec - a.xpSec)[0];
        if (best) picks.push(best);
      });
      return picks;
    };
    // the queue steps for a set of picks: gather the items, then a build step each (it asks you first)
    const buildSteps = (picks, parent) => picks.flatMap((x) => [...(materialSteps(x.items, 1, parent) ?? []),
      { kind: "ask", what: "build", skillId: AGILITY, actionId: x.o.id, slot: x.slot, qty: 1, parent, label: `Agility: build ${nm(x.o)}` }]);

    // Cartography trains by making paper from logs, or by surveying the hexes in range of where you stand on the map
    const surveyHex = (s) => {
      try {
        const map = s.activeMap;
        return map.getHexesInRange(map.playerPosition, map.surveyRange).filter((h) => !h.isFullySurveyed && (h.cartographyLevel ?? 1) <= s.level && game.checkRequirements(h.requirements ?? []))
          .sort((a, b) => (b.cartographyLevel ?? 0) - (a.cartographyLevel ?? 0))[0] ?? null;
      } catch (e) { return null; }
    };
    const cartographyMethods = (s) => [...list(s.paperRecipes).filter(realmOk).map((r) => method(s, r, {
      get options() { return [{ costs: (r.costs?.items ?? []).filter((k) => k?.item), mult: 1 }]; },
      get ms() { return s.getPaperMakingInterval?.(r) ?? s.BASE_PAPER_MAKING_INTERVAL ?? 5000; },
      start: () => { s.selectPaperRecipeOnClick(r); if (!s.isActive) s.makePaperOnClick(); },
    })), method(s, { id: "cartography:survey", name: "Survey the map", media: s.media }, {
      product: null, options: NO_COSTS, level: 1, noMastery: true,
      get xp() { const h = surveyHex(s); return h ? Number(s.getSkillXPForHexSurveyAction?.(h)) || (h.cartographyLevel ?? 1) * 2.6 : 0; },
      get ms() { return s.surveyInterval ?? 5000; },
      need: () => (surveyHex(s) ? null : "there's nothing left to survey in range of where you are on the map. Move somewhere new first"),
      start: () => { const h = surveyHex(s); if (!h) return fail("nothing left to survey nearby"); s.autoSurveyOnClick(h); },
    })];
    const WHOLE = { [MAGIC]: (s) => magicMethods(s), "melvorD:Agility": agilityMethods, "melvorAoD:Cartography": cartographyMethods };

    // ---------- combat ----------
    // A fight trains the skill your attack style gives XP in: 4 XP per point of damage (split on Longrange and Defensive), and
    // 1.33 Hitpoints XP on top. Prayer XP comes from an active prayer, Slayer XP from Slayer areas (half the monster's HP) and
    // your Slayer task (its full HP). Only fights that are safe while you're away are used, with the gear you have on.
    const PRAYER = "melvorD:Prayer", SLAYER = "melvorD:Slayer", HITPOINTS = "melvorD:Hitpoints";
    const STYLES = { "melvorD:Attack": { melee: "Stab" }, "melvorD:Strength": { melee: "Slash" }, "melvorD:Defence": { melee: "Block", ranged: "Longrange", magic: "Defensive" },
      "melvorD:Ranged": { ranged: "Accurate" }, "melvorD:Magic": { magic: "Magic" } };
    const WEAPON = { "melvorD:Attack": "melee", "melvorD:Strength": "melee", "melvorD:Ranged": "ranged", "melvorD:Magic": "magic" };
    const RESPAWN_MS = 3000;
    const mstat = (m, key) => (m.equipmentStats ?? []).find((x) => x.key === key && (key !== "resistance" || !x.damageType || x.damageType === game.normalDamage))?.value ?? 0;
    // the style that trains this skill with the weapon you have on (null if that weapon can't); your own style for the rest.
    // A ranged or magic style that already gives full XP in the skill (Rapid, say) is kept.
    const styleFor = (skill) => {
      const pl = player(), type = pl.attackType, cur = pl.attackStyles[type], want = STYLES[skill.id];
      if (!want) return cur;
      if (!want[type]) return null;
      if (skill.id !== "melvorD:Defence" && cur?.experienceGain?.some((g) => g.skill === skill && g.ratio >= 4)) return cur;
      return game.attackStyles.getObjectByID("melvorD:" + want[type]) ?? null;
    };
    // the prayer that gives the most Prayer XP that you can use
    const bestPrayer = () => list(game.prayers).filter((p) => !p.isAbyssal && !p.isUnholy && p.pointsPerPlayer > 0 && lvl(p) <= (game.prayer?.level ?? 1))
      .sort((a, b) => b.pointsPerPlayer - a.pointsPerPlayer)[0] ?? null;
    const onTask = (m) => { const t = game.combat.slayerTask; return t?.monster === m && t.killsLeft > 0; };
    // Prayer points run out: the cheapest bones in your bank (by sale price per point) are buried for more
    const bones = () => perSec("bones", () => list(game.items).filter((it) => it.prayerPoints > 0 && owned(it) > 0 && !game.bank.items.get(it)?.locked)
      .sort((a, b) => (a.sellsFor?.quantity ?? 0) / a.prayerPoints - (b.sellsFor?.quantity ?? 0) / b.prayerPoints)[0] ?? null);
    const buryBones = () => {
      const b = bones();
      if (!b) return false;
      try { game.bank.buryItemOnClick(b, Math.max(1, Math.ceil(100 / (Number(game.bank.getPrayerPointsPerBone?.(b)) || b.prayerPoints)))); } catch (e) { console.warn(TAG, "burying bones", e); }
      secMemo.m.delete("bones");
      return player().prayerPoints > 0;
    };
    // the weapon type an equipment set fights with, and another set that fits a skill (-1 if none)
    const weaponOf = (set) => { const w = set?.equipment?.equippedItems?.["melvorD:Weapon"]?.item; return !w || w.id === "melvorD:Empty_Equipment" ? "melee" : w.attackType ?? "melee"; };
    const weaponGap = (skill) => !!WEAPON[skill.id] && player()?.attackType !== WEAPON[skill.id];
    const setFor = (skill) => { const pl = player(); return (pl.equipmentSets ?? []).findIndex((s, i) => i !== pl.selectedEquipmentSet && weaponOf(s) === WEAPON[skill.id]); };
    // a monster's biggest normal hit before the combat triangle and your damage reduction (null if it can't be worked out)
    const monsterHit = (m, type) => {
      const lv = m.levels ?? {}, sp = m.selectedSpell;
      if (type === "melee") return Character.calculateStandardMaxHit(lv.Strength ?? 1, mstat(m, "meleeStrengthBonus"));
      if (type === "ranged") return Character.calculateStandardMaxHit(lv.Ranged ?? 1, mstat(m, "rangedStrengthBonus"));
      if (!sp) return null;
      return sp.spellbook?.allowDamageModifiers === false ? Math.round(NM() * sp.maxHit) : Math.floor(NM() * sp.maxHit * (1 + mstat(m, "magicDamageBonus") / 100) * (1 + ((lv.Magic ?? 1) + 1) / 200));
    };
    // the hardest single hit you can take from a monster: special attacks included, and the combat triangle and your damage
    // reduction counted the way that is worst for you. Specials based on anything else can't be worked out, so they count as unsafe.
    const maxTaken = (m) => {
      const pt = player().attackType, tri = game.combat.combatTriangle, dm = tri?.damageModifier ?? {}, rm = tri?.reductionModifier ?? {};
      let worst = 0;
      for (const t of m.attackType === "random" ? ["melee", "ranged", "magic"] : [m.attackType]) {
        const base = monsterHit(m, t);
        if (base === null) return null;
        let hit = base;
        for (const sp of m.specialAttacks ?? []) for (const d of sp.attack?.damage ?? []) {
          if (d.maxRoll === "MaxHit" && (d.character ?? "Attacker") === "Attacker") hit = Math.max(hit, (base * (d.maxPercent ?? 100)) / 100);
          else if (d.maxRoll === "Fixed") hit = Math.max(hit, (d.maxPercent ?? 0) * NM());
          else return null;
        }
        const tf = Math.max(dm[t]?.[pt] ?? 1, dm[pt]?.[t] ?? 1), rf = Math.min(1, rm[pt]?.[t] ?? 1, rm[t]?.[pt] ?? 1);
        worst = Math.max(worst, hit * tf * (1 - (resistance() * rf) / 100));
      }
      return Math.ceil(worst);
    };
    // how many attacks a kill takes, and how long it takes with the time until the next monster appears
    const killStats = (m) => {
      const st = player().stats, pt = player().attackType, lv = m.levels ?? {}, tri = game.combat.combatTriangle?.damageModifier ?? {};
      const level = pt === "magic" ? Math.floor((lv.Defence ?? 1) * 0.3 + (lv.Magic ?? 1) * 0.7) : lv.Defence ?? 1;
      const ev = Character.calculateStandardStat({ effectiveLevel: level, bonus: mstat(m, `${pt}DefenceBonus`) }), acc = st.accuracy;
      const hit = !(acc > 0) ? 0 : acc < ev ? (0.5 * acc) / ev : 1 - (0.5 * ev) / acc;
      const dmg = hit * ((st.minHit + st.maxHit) / 2) * (tri[pt]?.[m.attackType] ?? 1) * (1 - mstat(m, "resistance") / 100);
      const attacks = dmg > 0 ? Math.ceil(((lv.Hitpoints ?? 1) * NM()) / dmg) : Infinity;
      return { attacks, ms: attacks * st.attackInterval + RESPAWN_MS };
    };
    const xpPerKill = (skill, m, area) => {
      const hp = m.levels?.Hitpoints ?? 1;
      if (skill.id === HITPOINTS) return hp * 1.33;
      if (skill.id === SLAYER) return (game.slayerAreas.allObjects.includes(area) ? hp / 2 : 0) + (onTask(m) ? hp : 0);
      if (skill.id === PRAYER) return (hp * (bestPrayer()?.pointsPerPlayer ?? 0)) / 3;
      return hp * (styleFor(skill)?.experienceGain?.find((g) => g.skill === skill)?.ratio ?? 0);
    };
    // why this fight can't be used right now (null when it can)
    const fightNeed = (skill, m, area) => {
      const pl = player(), type = pl.attackType;
      if (WEAPON[skill.id] && WEAPON[skill.id] !== type) return `needs a ${WEAPON[skill.id]} weapon equipped (yours fights with ${type})`;
      if (!game.checkRequirements(area.entryRequirements ?? [])) return `${nm(area)} has requirements you don't meet yet`;
      if (type === "magic" && !(pl.spellSelection.attack && pl.canUseCombatSpell(pl.spellSelection.attack))) return "needs a combat spell you can cast selected in Combat";
      if (type === "ranged" && !(pl.equipment.equippedItems["melvorD:Quiver"]?.quantity > 0)) return "needs ammo in your quiver";
      if (skill.id === PRAYER && !bestPrayer()) return "needs a prayer you can use";
      if (skill.id === PRAYER && !(pl.prayerPoints > 0) && !bones()) return "needs prayer points, or bones in your bank to bury";
      return null;
    };
    // checked every second while a fight runs: runes, ammo and prayer points can run out
    const fightCheck = (skill) => {
      const pl = player(), sp = pl.spellSelection.attack;
      if (skill.id === PRAYER && !(pl.prayerPoints > 0) && !buryBones()) return { why: "out of prayer points, with no bones left to bury" };
      if (pl.attackType === "ranged" && !(pl.equipment.equippedItems["melvorD:Quiver"]?.quantity > 0)) return { why: "out of ammo" };
      if (pl.attackType === "magic" && sp && !pl.getRuneCosts(sp).every((k) => owned(k.item) >= k.quantity)) return { why: "out of runes", noMaterials: true };
      return null;
    };
    // The queue sets the attack style (and the prayer, for Prayer) for a fight and puts yours back when the step ends.
    let savedCombat = null;
    const restoreCombat = () => {
      const s = savedCombat, pl = player();
      savedCombat = null;
      if (!s || !pl) return;
      try {
        if (pl.attackStyles[s.type] !== s.style) pl.setAttackStyle(s.type, s.style);
        for (const p of [...pl.activePrayers]) if (!s.prayers.includes(p)) pl.togglePrayer(p);
        for (const p of s.prayers) if (!pl.activePrayers.has(p)) pl.togglePrayer(p);
      } catch (e) { console.warn(TAG, "restoring combat settings", e); }
    };
    // an Attack, Strength, Ranged or Magic goal can switch to another equipment set; it switches back when the goal is done
    const restoreSet = (e) => {
      const pl = player();
      if (e.wasSet === undefined || !pl || pl.selectedEquipmentSet === e.wasSet || game.activeAction === game.combat) return;
      try { pl.changeEquipmentSet(e.wasSet); } catch (err) { console.warn(TAG, "switching your equipment set back", err); }
    };
    const kills = (id) => { try { return game.stats.monsterKillCount(game.monsters.getObjectByID(id)) ?? 0; } catch (e) { return 0; } };
    // the fight a kill or drop step uses: any combat area or Slayer area the monster is in (null for dungeons)
    const fightId = (m) => { const a = [...list(game.combatAreas), ...list(game.slayerAreas)].find((x) => (x.monsters ?? []).includes(m)); return a ? `fight:${a.id}:${m.id}` : null; };
    // dungeons, strongholds and abyssal depths are run room by room from the start, so you're "on" a boss there from the
    // first room until it's down (the game starts the next run by itself when it ends)
    const isRun = (area) => !!area && ["dungeons", "strongholds", "abyssDepths"].some((k) => list(game[k]).includes(area));
    const fighting = (m, area) => game.activeAction === game.combat && (isRun(area) ? game.combat.selectedArea === area : game.combat.selectedMonster === m);
    const startFight = (skill, m, area) => {
      const pl = player(), style = styleFor(skill), pr = skill.id === PRAYER && bestPrayer();
      if (game.activeAction && !fighting(m, area)) game.stopActiveAction();
      savedCombat ??= { type: pl.attackType, style: pl.attackStyles[pl.attackType], prayers: [...pl.activePrayers] };
      if (style && pl.attackStyles[pl.attackType] !== style) pl.setAttackStyle(pl.attackType, style);
      if (pr && !(pl.prayerPoints > 0)) buryBones();
      if (pr && !pl.activePrayers.has(pr)) pl.togglePrayer(pr);
      if (!fighting(m, area)) game.combat.selectMonster(m, area);
    };
    const fightMethods = (skill) => [...list(game.combatAreas), ...list(game.slayerAreas)].filter(realmOk).flatMap((area) => (area.monsters ?? []).filter((m) => realmOk(m) && m.levels).map((m) => {
      const run = isRun(area);
      // in a run, every room counts: the hardest hit of any monster in it, and the time to clear it for each kill of this one
      const ev = () => perSec(`${skill.id}|${area.id}|${m.id}`, () => {
        if (!run) return { ...killStats(m), xp: xpPerKill(skill, m, area), hit: maxTaken(m) };
        const ms = area.monsters, hits = [...new Set(ms)].map(maxTaken), per = ms.filter((x) => x === m).length || 1;
        return { ...killStats(m), ms: ms.reduce((t, x) => t + killStats(x).ms, 0) / per, xp: xpPerKill(skill, m, area), hit: hits.includes(null) ? null : Math.max(...hits) };
      });
      return method(skill, m, {
        id: `fight:${area.id}:${m.id}`, name: `Fight ${nm(m)}${game.slayerAreas.allObjects.includes(area) ? ` (${nm(area)})` : ""}`, media: m.media, product: null, level: 1, succ: 1,
        actor: game.combat, noMastery: true, cap: () => (skill.id === SLAYER && !game.slayerAreas.allObjects.includes(area) ? game.combat.slayerTask.killsLeft : Infinity),
        get xp() { return ev().xp; }, get ms() { return ev().ms; },
        // a combat spell uses runes on every cast
        get options() { const pl = player(), sp = pl.spellSelection.attack; return pl.attackType === "magic" && sp ? [{ costs: pl.getRuneCosts(sp).map((k) => ({ item: k.item, quantity: k.quantity * ev().attacks })), mult: 1 }] : NO_COSTS; },
        dungeon: run, // a Township task can send you here, but training goals don't (their XP numbers would be off)
        need: () => fightNeed(skill, m, area), check: () => fightCheck(skill), active: () => fighting(m, area), start: () => startFight(skill, m, area),
        // e is the queue step: a fight you said you'd eat yourself for skips the auto eat check
        safe: (e) => {
          const hit = ev().hit, mode = e?.selfEat ? "self" : parts.noAutoEat?.() ? "noAuto" : null;
          if (hit === null && mode !== "self") return { ok: false, why: `${nm(m)} has special attacks whose damage can't be worked out` };
          return takeSafety(hit ?? 0, mode);
        },
      });
    }));
    const methodCache = new Map();
    const methodsOf = (skill) => {
      if (!skill) return [];
      if (!methodCache.has(skill.id)) {
        const own = WHOLE[skill.id] ? WHOLE[skill.id](skill) : list(skill.actions).filter(realmOk).map((a) => (SKILLS[skill.id] ?? method)(skill, a));
        methodCache.set(skill.id, COMBAT.has(skill.id) ? [...own, ...fightMethods(skill)] : own);
      }
      return methodCache.get(skill.id);
    };
    const methodById = (skill, id) => methodsOf(skill).find((m) => m.id === id);
    const perAttempt = (m, opt = m.options[0]) => Math.max(1, m.qty * opt.mult) * m.succ;
    const xpRate = (m) => (m.ms > 0 ? ((m.xp * m.succ) / m.ms) * 3600000 : 0);
    // where each item comes from. Magic only makes what no other skill makes, so bars still come from Smithing.
    let idx = null;
    const index = () => {
      if (idx) return idx;
      idx = { crafters: new Map(), gatherers: new Map() };
      const add = (m) => { const map = m.options[0].costs.length ? idx.crafters : idx.gatherers; map.set(m.product.id, [...(map.get(m.product.id) ?? []), { skill: m.skill, a: m }]); };
      const skills = list(game.skills).filter(isTrainable), known = (id) => idx.crafters.has(id) || idx.gatherers.has(id);
      for (const m of skills.filter((s) => !EXTRA.has(s.id)).flatMap(methodsOf)) if (m.product) add(m);
      for (const m of skills.filter((s) => EXTRA.has(s.id)).flatMap(methodsOf).filter((m) => m.product && !m.own && !known(m.product.id))) add(m);
      return idx;
    };
    // an extra source only counts once you can use it (the level, an unlocked plot); until then the item is a step you do yourself
    const usable = (x) => (x && EXTRA.has(x.skill.id) && (x.a.level > x.skill.level || x.a.need?.()) ? undefined : x);
    const crafter = (id) => usable(index().crafters.get(id)?.[0]);
    const gatherer = (id) => usable(index().gatherers.get(id)?.[0]);

    // ---------- breaking an item down into steps ----------
    // Crafts break down into their materials. Parents come before children, so what the bank already holds is used first.
    const buildRows = (item, qty, fresh = false) => rowsFor([[item, qty]], fresh);
    const rowsFor = (targets, fresh = false) => {
      const nodes = new Map(), roots = new Set(targets.map(([it]) => it.id));
      const explode = (it, depth, path) => {
        const n = nodes.get(it.id) ?? { item: it, depth }, c = crafter(it.id);
        nodes.set(it.id, Object.assign(n, { depth: Math.max(n.depth, depth) }));
        if (!c || path.has(it.id) || depth > 12) return;
        n.recipe = { c, opt: c.a.options[0] };
        path.add(it.id); for (const k of n.recipe.opt.costs) explode(k.item, depth + 1, path); path.delete(it.id);
      };
      for (const [it] of targets) explode(it, 0, new Set());
      const demand = new Map(targets.map(([it, q]) => [it.id, q])), rows = [];
      for (const n of [...nodes.values()].sort((a, b) => a.depth - b.depth)) {
        const need = demand.get(n.item.id) ?? 0;
        if (need <= 0) continue;
        n.fresh = fresh && roots.has(n.item.id);
        Object.assign(n, { need, qty: Math.max(0, need - (n.fresh ? 0 : owned(n.item))) });
        if (n.recipe) {
          const { c, opt } = n.recipe;
          n.recipe.crafts = Math.ceil(n.qty / perAttempt(c.a, opt));
          if (n.qty > 0) for (const k of opt.costs) demand.set(k.item.id, (demand.get(k.item.id) ?? 0) + k.quantity * n.recipe.crafts);
        }
        if (n.qty > 0) rows.push(n);
      }
      return rows.sort((a, b) => b.depth - a.depth || nm(a.item).localeCompare(nm(b.item)));
    };
    const lvlChip = (skill, a) => (skill && lvl(a) > skill.level ? chip(`${warnIcon}Needs ${esc(nm(skill))} level ${a.level} (you have ${skill.level})`, "warn") : "");
    // the easiest way to gather an item the player can't gather yet (null if they can, or if no skill gathers it)
    const gatherBlock = (id) => {
      const opts = (index().gatherers.get(id) ?? []).filter((x) => !EXTRA.has(x.skill.id));
      if (!opts.length || opts.some((x) => lvl(x.a) <= x.skill.level)) return null;
      return opts.reduce((m, x) => (lvl(x.a) - x.skill.level < lvl(m.a) - m.skill.level ? x : m));
    };
    const itemMissing = (item, qty, fresh) => {
      const out = new Map();
      for (const n of buildRows(item, qty, fresh)) {
        const x = n.recipe ? n.recipe.c : gatherBlock(n.item.id);
        if (x && lvl(x.a) > x.skill.level) out.set(`${x.a.level} ${nm(x.skill)}|${nm(n.item)}`, { text: `${x.a.level} ${nm(x.skill)}`, forName: nm(n.item) });
      }
      return [...out.values()];
    };
    const missingHtml = (miss) => step(miss.map((x) => chips(chip(`${warnIcon}Warning: ${esc(x.text)} required for ${esc(x.forName)}`, "warn"))).join("") + note("You can't queue this until you meet the requirements."));
    const itemSection = (rows) => {
      if (!rows.length) return step(chips(chip(`<i class="fa fa-check"></i> You already have enough in your bank`, "ok")));
      return rows.map((n, i) => {
        const o = have(n.item);
        const haveChip = o === null || n.fresh ? "" : chip(`You have ${num(o)} of ${num(n.need)} needed`);
        let title, body;
        if (n.recipe) {
          const { c, opt, crafts } = n.recipe;
          const alts = (index().crafters.get(n.item.id)?.length ?? 1) - 1 + c.a.options.length - 1;
          const uses = opt.costs.map((x) => chip(`${icon(x.item)}${num(x.quantity * crafts)} ${esc(nm(x.item))}`));
          title = `${icon(c.skill)}<b>${esc(nm(c.skill))}</b>: make ${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
          body = chips(chip(`Level ${lvl(c.a)}`), chip(plural(crafts, "craft")), haveChip, alts > 0 ? chip(plural(alts, "other option")) : "") +
            (uses.length ? chips(chip("<b>Uses</b>", "lbl"), ...uses) : "") + (lvlChip(c.skill, c.a) ? chips(lvlChip(c.skill, c.a)) : "");
        } else {
          const g = (index().gatherers.get(n.item.id) ?? []).filter(usable), lb = gatherBlock(n.item.id);
          title = `${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
          body = chips(haveChip) + (g.length
            ? chips(chip(`<i class="fa fa-hand-paper"></i> <b>Gather</b>`, "lbl"), ...g.slice(0, 3).map((x) => chip(`${esc(nm(x.skill))}: ${esc(nm(x.a))} (Lv ${lvl(x.a)})`))) + (lb ? chips(lvlChip(lb.skill, lb.a)) : "")
            : shopOnly(n.item) ? chips(chip(`<i class="fa fa-shopping-cart"></i> <b>Buy</b>`, "lbl"), chip(`From the shop for ${esc(costText(costsOf(game.shop.getPurchaseCosts(shopFor(n.item), Math.ceil(n.qty / perBuy(shopFor(n.item)))))))}`), chip(A.settings.get("autoBuy") ? "Bought without asking" : "Asks you first", "ok"))
            : chips(chip(MANUAL_NOTE, "warn")));
        }
        return step(`<div class="aq-stepno">Step ${i + 1}</div><div class="aq-title">${title}</div>${body}`);
      }).join("");
    };
    // ways to get an item that other mods know about: fn(item, qty) returns a step (or nothing)
    const SOURCES = [];
    // Queue entries: "kind" is what the runner does; qty is how many MORE of the item to end up with
    // (for "manual" entries it is how many you should own).
    const toEntries = (rows) => rows.map((n) => {
      const base = { itemId: n.item.id, qty: n.qty }, c = n.recipe?.c, g = !c && gatherer(n.item.id);
      if (c) return { ...base, kind: "craft", skillId: c.skill.id, actionId: c.a.id, altIndex: 0, label: `${nm(c.skill)}: make ${nm(n.item)}` };
      if (g) return { ...base, kind: "gather", skillId: g.skill.id, actionId: g.a.id, label: `${nm(g.skill)}: gather ${nm(n.item)}` };
      for (const fn of SOURCES) { const x = fn(n.item, n.qty); if (x) return { ...base, ...x }; }
      // qty for a buy step is how many you should own, like a manual step
      if (shopOnly(n.item)) return { ...base, qty: owned(n.item) + n.qty, kind: "ask", what: "buy", label: `Buy ${nm(n.item)}` };
      return { ...base, qty: n.need ?? n.qty, kind: "manual", label: `Get ${nm(n.item)}`, note: MANUAL_NOTE };
    });
    // the steps that get the missing materials for `crafts` more attempts; null if the queue can't get one of them
    const materialSteps = (costs, crafts, parent) => {
      const targets = costs.map((k) => [k.item, k.quantity * crafts - owned(k.item)]).filter(([, n]) => n > 0);
      const entries = targets.length ? toEntries(rowsFor(targets, true)) : [];
      if (entries.some((x) => x.kind === "manual")) return null;
      for (const x of entries) x.parent = parent;
      return entries;
    };

    // ---------- the shop (Action Queue buys; Skill Trainer plans with it) ----------
    const shopFor = (item) => A?.shop.for(item);
    const perBuy = (p) => A.shop.perBuy(p);
    // things only the shop sells (feathers, compost, Summoning shards): the plan buys them, and Action Queue asks you first
    // unless auto-buy is on
    const shopOnly = (item) => !!shopFor(item) && !crafter(item.id) && !gatherer(item.id);
    const buyLeft = (item) => (shopOnly(item) ? A.shop.canBuy(item) : 0);

    // ---------- Slayer tasks ----------
    // A Slayer goal with no task asks you about rolling one: the cheapest tier you have the Slayer level for and can pay for,
    // as long as some of its monsters are safe for you to fight while you're away
    const slayerTier = () => {
      const st = game.combat.slayerTask, sl = skillById(SLAYER)?.level ?? 1;
      for (const c of list(st?.categories)) {
        if ((c.realm?.id ?? MELVOR) !== MELVOR || (c.level ?? 1) > sl || !st.getRollCosts(c).checkIfOwned()) continue;
        const mons = st.getMonsterSelection(c), safe = mons.filter((m) => { const h = maxTaken(m); return h !== null && takeSafety(h).ok; });
        if (safe.length) return { c, mons, safe };
      }
      return null;
    };
    const hasTask = () => { const t = game.combat.slayerTask; return !!t?.monster && t.killsLeft > 0; };

    // ---------- steps that ask you first ----------
    // Action Queue runs "ask" steps; these are the kinds Skill Trainer adds (it registers them when it installs): building an
    // Agility obstacle, rolling a Slayer task, making a dig site map, and switching equipment sets (no question asked, or it
    // waits for you to equip the right weapon).
    const popHtml = (o, rows, foot) => step(`<div class="aq-title">${icon(o)}<b>${esc(nm(o))}</b></div>${rows}`) + note(foot);
    const ASKS = {
      build: {
        target: (e) => list(game.agility?.actions).find((x) => x.id === e.actionId),
        done: (e, o) => { const there = o.course?.builtObstacles?.get(o.category) ?? game.agility.activeCourse.builtObstacles.get(o.category); return there ? (there === o ? "Already built" : `Slot already has ${nm(there)}`) : null; },
        skip: (e, o, parent) => { if (parent) parent.noBuild = [...(parent.noBuild ?? []), o.category]; },
        cannot: (e, o) => (game.agility.getObstacleBuildCosts(o).checkIfOwned() ? null : `you can't pay for ${nm(o)} right now (${costText(buildCosts(o))})`),
        act: (e, o) => { game.agility.buildObstacle(o); return "Built"; },
        turn: (e, o) => `confirm building ${nm(o)}, or skip it.`,
        pop: (e, o) => {
          const slot = game.agility.activeCourse.obstacleSlots[o.category], mods = (o.modifiers ?? []).map((v) => { try { return v.getDescription().description; } catch (err) { return ""; } }).filter(Boolean);
          return { title: "Build an Agility obstacle?", yes: "Build", html: popHtml(o, chips(chip(`Slot ${o.category + 1} (Agility level ${slot?.level ?? 1})`), chip(`${num(o.baseExperience ?? 0)} XP per lap`), chip(`${num((o.baseInterval ?? 0) / 1000)} s`)) +
            chips(chip("<b>Costs</b>", "lbl"), chip(esc(costText(buildCosts(o))))) + (mods.length ? chips(chip("<b>Bonuses</b>", "lbl"), ...mods.map((d) => chip(esc(d), "ok"))) : ""),
            "Building can't be undone. Skip leaves this slot empty for this goal.") };
        },
      },
      slayer: {
        icon: () => skillById(SLAYER),
        target: (e) => list(game.combat.slayerTask?.categories).find((c) => c.id === e.actionId),
        done: () => (hasTask() ? `Task: ${nm(game.combat.slayerTask.monster)} x${num(game.combat.slayerTask.killsLeft)}` : null),
        skip: (e, c, parent) => { if (parent) parent.noTask = true; },
        cannot: (e, c) => { const k = game.combat.slayerTask.getRollCosts(c); return k.checkIfOwned() ? null : `you can't pay for ${aOr(nm(c))} task right now (${costText(costsOf(k))})`; },
        act: (e, c) => {
          const st = game.combat.slayerTask;
          st.selectTask(c, true, true, true);
          // the game starts the task a second later; start it now so the plan can count it
          if (st.monster && !(st.killsLeft > 0)) { st.taskTimer?.stop?.(); st.setTask(); }
          return hasTask() ? `Task: ${nm(st.monster)} x${num(st.killsLeft)}` : { block: `the game didn't give you ${aOr(nm(c))} task` };
        },
        turn: (e, c) => `confirm rolling ${aOr(nm(c))} Slayer task, or skip it.`,
        pop: (e, c) => {
          const t = slayerTier(), k = game.combat.slayerTask.getRollCosts(c), n = t?.c === c ? t : { mons: [], safe: [] };
          return { title: "Roll a Slayer task?", yes: "Roll", html: popHtml(c, chips(chip(`Costs ${esc(costText(costsOf(k)))}`), chip(`${n.safe.length} of ${n.mons.length} monsters are safe for you`, n.safe.length ? "ok" : "warn")),
            "The task is random. If you get a monster that isn't safe while you're away, the queue skips it and uses a safe Slayer area if there is one. Skip doesn't ask again for this goal.") };
        },
      },
      map: {
        target: (e) => list(game.archaeology?.actions).find((x) => x.id === e.actionId),
        done: (e, s) => { pickTools(s); return game.archaeology.canExcavate(s) ? "Map ready" : null; },
        skip: (e, s, parent) => { if (parent) parent.noMap = true; },
        cannot: (e, s) => { const k = game.cartography.getMapCreationCosts(s); return !s.poi?.isDiscovered ? `you haven't found ${nm(s)} on the map yet` : k.checkIfOwned() ? null : `you don't have what ${aOr(nm(s))} map takes (${costText(costsOf(k))})`; },
        act: (e, s) => {
          game.cartography.createNewMapForDigSite(s);
          if (!(s.selectedMap?.charges > 0) && s.maps.length) try { s.selectedMapIndex = s.maps.length - 1; } catch (err) { /* the game picks it */ }
          pickTools(s);
          return game.archaeology.canExcavate(s) ? "Map made" : { block: `the map for ${nm(s)} couldn't be made or picked. Pick it in Archaeology, then press Start` };
        },
        turn: (e, s) => `confirm making a map for ${nm(s)}, or skip it.`,
        pop: (e, s) => ({ title: "Make a dig site map?", yes: "Make map", html: popHtml(s, chips(chip(`Archaeology level ${lvl(s)}`), chip("<b>Costs</b>", "lbl"), chip(esc(costText(costsOf(game.cartography.getMapCreationCosts(s)))))),
          "Uses up the materials. The queue picks all your tools for the site too. Skip doesn't ask again for this goal.") }),
      },
      // set: another equipment set to switch to (no question asked), or -1 to wait for you
      equip: {
        target: (e) => skillById(e.skillId),
        done: (e, s) => (weaponGap(s) ? null : e.set >= 0 ? `Switched to equipment set ${e.set + 1}` : "Done"),
        auto: (e) => e.set >= 0,
        hint: (e) => (e.set >= 0 ? "switches your equipment set" : "waits for you to equip it"),
        act: (e, s, parent) => {
          const pl = player();
          if (game.activeAction === game.combat) game.stopActiveAction();
          if (parent && parent.wasSet === undefined) parent.wasSet = pl.selectedEquipmentSet;
          try { pl.changeEquipmentSet(e.set); } catch (err) { /* checked below */ }
          return weaponGap(s) ? { block: `equipment set ${e.set + 1} doesn't fight with a ${WEAPON[s.id]} weapon` } : `Switched to equipment set ${e.set + 1}`;
        },
        turn: (e, s) => `equip a ${WEAPON[s.id]} weapon${WEAPON[s.id] === "ranged" ? " and ammo" : ""}. The queue carries on once you do.`,
      },
    };

    // ---------- starting actions in the game ----------
    // Uses the game's own click handlers, in the same order its buttons use them. A starter returns a failure or nothing.
    const STARTERS = {
      "melvorD:Woodcutting": (s, a) => { s.activeTrees.clear(); s.selectTree(a); },
      "melvorD:Mining": (s, a) => {
        if (a.isRespawning) return fail("waiting for the rock to respawn", { transient: true });
        if (!s.canMineOre(a)) return fail("can't mine this yet (level, mastery or shop unlock)");
        s.selectedRock = undefined; s.onRockClick(a);
      },
      "melvorD:Fishing": (s, a) => {
        const area = list(s.areas).find((ar) => (ar.fish ?? []).includes(a));
        if (!area) return fail("no fishing area found for this fish");
        s.onAreaFishSelection(area, a); s.onAreaStartButtonClick(area);
      },
      "melvorD:Cooking": (s, a) => { s.onRecipeSelectionClick(a); s.onActiveCookButtonClick(a.category); },
      "melvorD:Firemaking": (s, a) => { s.selectLog(a); if (!s.isActive) s.burnLog(); },
    };
    const startCraft = (s, a, e) => {
      if (typeof s.selectRecipeOnClick !== "function" || typeof s.createButtonOnClick !== "function") return fail(`automating ${nm(s)} isn't supported yet`);
      s.selectRecipeOnClick(a);
      if (a.alternativeCosts?.length && typeof s.selectAltRecipeOnClick === "function") s.selectAltRecipeOnClick(e.altIndex ?? 0);
      if (!s.isActive) s.createButtonOnClick();
    };
    const startAction = (e) => {
      const skill = skillById(e.skillId), m = methodById(skill, e.actionId), safety = m?.safe?.(e);
      if (!m) return fail(e.kind === "kill" ? "this monster is in a dungeon or special area, so fight it yourself, then press Start" : "this action wasn't found in your game version");
      if (m.level > skill.level) return fail(`needs ${nm(skill)} level ${m.level}`);
      if (m.need?.()) return fail(m.need());
      if (safety && !safety.ok) return fail(`not safe while you're away: ${safety.why}`);
      if (safety?.self && game.activeAction !== m.actor) A.tell(`${e.label.replace(/ \(you eat yourself\)$/, "")}: the queue isn't waiting for auto eat in this fight, so keep an eye on your HP and eat.`, skillById(HITPOINTS));
      const chk = m.check?.();
      if (chk) return fail(chk.why, { noMaterials: !!chk.noMaterials });
      try {
        if (game.activeAction && game.activeAction !== (m.actor ?? skill)) game.stopActiveAction();
        if (!m.actor && skill.isActive && skill.stop() === false) return fail("couldn't stop the current activity");
        const r = m.start(e);
        if (r) return r;
      } catch (err) { return fail("error: " + err.message); }
      if (m.active ? m.active() : skill.isActive) return { ok: true };
      const costly = (m.options[e.altIndex ?? 0] ?? m.options[0]).costs.length > 0 && e.kind !== "gather";
      return fail(costly ? "not enough materials (or level too low)" : "the game wouldn't start it", { noMaterials: costly && m.level <= skill.level });
    };

    // A craft step ran out of ingredients before it made enough (Cooking burns food, Smithing and others can come up short):
    // work out what is still missing and the steps that get it
    const restockCraft = (e) => {
      const m = methodById(skillById(e.skillId), e.actionId), item = itemById(e.itemId), name = e.kind === "skill" ? m?.name : nm(item);
      if (!m || (e.kind !== "skill" && !item)) return fail("this action wasn't found in your game version");
      const opt = m.options[e.altIndex ?? 0] ?? m.options[0], remaining = e.qty - A.runner.gained(e);
      const crafts = Math.max(1, Math.ceil(remaining / (e.kind === "skill" ? Math.max(1e-9, m.xp * m.succ) : perAttempt(m, opt))));
      const entries = materialSteps(opt.costs, crafts, e.parent ?? e.id);
      if (!entries) return fail(`${name} needs something the queue can't get on its own`);
      return entries.length ? { ok: true, entries, remaining, crafts, name } : fail("not enough materials (or level too low)");
    };

    // ---------- train a skill ----------
    // Two goals: make an amount of an item, or train to a level. A level goal never farms blindly: every method is ranked
    // by XP per hour of ALL the work it takes (gathering its materials included), and the plan only switches method when a
    // clearly better one opens up. The queue plans one batch at a time, so it always uses your real level and bank.
    const levelIn = (skill, lv) => (lv?.has(skill.id) ? lv.get(skill.id) : skill.level);
    const xpAt = (l) => { try { return exp.level_to_xp(l); } catch (e) { return 0; } };
    const levelCap = (s) => (s.level >= 99 ? 120 : 99);
    // keep the current method unless another is at least 10% faster (25% with "prefer mastery XP"), so plans don't split into tiny batches
    const switchGain = () => (mastery() ? 1.25 : 1.1);

    // time (ms) to get n of an item from scratch with things the queue can do itself; Infinity if it can't.
    // Also returns the XP those steps give in `skillId` (smelting bars trains Smithing too).
    const makeTime = (item, n, lv, skillId, seen = new Set(), depth = 0) => {
      if (!(n > 0)) return { ms: 0, xp: 0 };
      const NO = { ms: Infinity, xp: 0 }, c = crafter(item.id), g = !c && gatherer(item.id), x = c || g;
      // buying from the shop takes no time (you still confirm each purchase)
      if (!x) return buyLeft(item) >= n ? { ms: 0, xp: 0 } : NO;
      if (depth > 10 || seen.has(item.id) || !x || x.a.level > levelIn(x.skill, lv) || x.a.need?.(lv)) return NO;
      if (g) { const acts = n / Math.max(1, g.a.qty); return { ms: acts * g.a.ms, xp: g.skill.id === skillId ? acts * g.a.xp : 0 }; }
      const opt = c.a.options[0], crafts = n / perAttempt(c.a, opt); // attempts, not rounded: ranks methods by their steady rate
      const r = { ms: crafts * c.a.ms, xp: c.skill.id === skillId ? crafts * c.a.succ * c.a.xp : 0 };
      seen.add(item.id);
      for (const k of opt.costs) { const s = acquire(k.item, k.quantity * crafts, lv, skillId, seen, depth + 1); r.ms += s.ms; r.xp += s.xp; }
      seen.delete(item.id);
      return r;
    };
    // the same, but what the queue can't get itself is free while the bank holds enough of it (shards, feathers, bones)
    const acquire = (item, n, lv, skillId, seen, depth) => { const r = makeTime(item, n, lv, skillId, seen, depth); return isFinite(r.ms) || owned(item) < n ? r : { ms: 0, xp: 0 }; };
    // how many attempts the bank (and what you could buy) allows for the costs the queue can't gather or make
    const stockCap = (costs) => Math.min(Infinity, ...costs.filter((k) => shopOnly(k.item) || !isFinite(makeTime(k.item, 1).ms)).map((k) => Math.floor((owned(k.item) + buyLeft(k.item)) / k.quantity)));
    // the same step the queue would really run for this product (first crafter, or first gatherer). Methods that make nothing,
    // and extra ways to make something (Superheat), run as their own XP step.
    const stepFor = (m) => {
      if (!m.product) return { craft: m.options[0].costs.length > 0, own: true };
      const c = crafter(m.product.id), g = gatherer(m.product.id);
      return c ? (c.a === m ? { craft: true } : null) : g?.a === m ? { craft: false } : m.own ? { craft: true, own: true } : null;
    };
    // training methods open at this level, best first by XP per hour of everything they need
    const trainCands = (skill, lv) => {
      const out = [], L = levelIn(skill, lv);
      for (const m of methodsOf(skill)) {
        const st = !m.dungeon && m.level <= L && m.xp > 0 && !m.need?.(lv) && m.safe?.().ok !== false && stepFor(m);
        if (!st) continue;
        const opt = st.craft ? m.options[0] : NO_COSTS[0];
        let ms = m.ms, xpPer = m.xp * m.succ, mast = 0;
        if (st.craft) for (const k of opt.costs) { const r = acquire(k.item, k.quantity, lv, skill.id); ms += r.ms; xpPer += r.xp; }
        if (!isFinite(ms) || ms <= 0) continue;
        if (mastery() && !m.noMastery && m.a.hasMastery !== false) {
          try { if (skill.getMasteryLevel(m.a) < 99) mast = Number(skill.getMasteryXPToAddForAction(m.a, m.ms)) || 0; } catch (e) { /* no mastery */ }
        }
        out.push({ a: m, st, opt, per: perAttempt(m, opt), ms, xpPer, mast, rate: (xpPer / ms) * 3600000, score: ((xpPer + mast) / ms) * 3600000 });
      }
      return out.sort((x, y) => y.score - x.score);
    };
    // why nothing at this level can be trained, when it comes down to gear, requirements or safety (no food, say)
    const blockedWhy = (skill) => {
      // skill actions first, fights after: Alt Magic short on runes says so before Magic combat asks for a staff
      for (const m of [...methodsOf(skill)].sort((a, b) => !!a.actor - !!b.actor)) {
        if (m.level > skill.level || m.dungeon) continue;
        const need = m.need?.();
        if (need) return need;
        const safe = m.xp > 0 && m.safe?.();
        if (safe && !safe.ok) return `it isn't safe while you're away (${safe.why})`;
        // something it needs that the queue can't get (Nature Runes before Runecrafting 44, say)
        const k = m.xp > 0 && !m.actor && (m.options[0]?.costs ?? []).find((c) => owned(c.item) < c.quantity && !isFinite(makeTime(c.item, c.quantity).ms));
        if (k) return `${m.name} needs ${nm(k.item)}, which you don't have and the queue can't get on its own yet`;
      }
      return null;
    };
    const trainPlan = (skill, target, forcedId, fromLevel = skill.level, fromXp = skill.xp ?? 0, seed = null) => {
      const sim = new Map(seed ?? []), batches = [];
      let L = fromLevel, cur = null, blocked = null;
      for (let guard = 0; L < target && guard < 140; guard++) {
        sim.set(skill.id, L);
        const cands = trainCands(skill, sim).filter((c) => !forcedId || c.a.id === forcedId);
        if (!cands.length) { blocked = L; break; }
        const same = cur && cands.find((c) => c.a === cur.c.a);
        const pick = same && cands[0].score < same.score * switchGain() ? same : cands[0];
        if (!cur || cur.c.a !== pick.a) batches.push((cur = { c: pick, from: L, to: L }));
        cur.to = ++L;
      }
      let totalMs = 0, xpPrev = fromXp;
      for (const b of batches) {
        b.xpGain = Math.max(0, xpAt(b.to) - Math.max(xpPrev, xpAt(b.from)));
        b.ms = Math.max(1, Math.ceil(b.xpGain / b.c.xpPer)) * b.c.ms;
        totalMs += b.ms;
        xpPrev = xpAt(b.to);
      }
      return { batches, totalMs, blocked };
    };
    // Another skill can hold a better method back (steel needs coal, which needs Mining 30). Work out whether training that skill first
    // gets you to the target sooner, counting the time it takes. Returns { skill, level, T1, saveMs, detourMs } or null.
    const memo = (m, key, max, fn) => { if (m.has(key)) return m.get(key); if (m.size > max) m.clear(); const v = fn(); m.set(key, v); return v; };
    const detourMemo = new Map(), estMemo = new Map();
    const GATHER_SKILLS = ["melvorD:Mining", "melvorD:Woodcutting", "melvorD:Fishing"];
    const bestDetour = (skill, target, fromLevel = skill.level, fromXp = skill.xp ?? 0) => {
      if (!isTrainable(skill) || (COMBAT.has(skill.id) && skill.id !== MAGIC) || target - fromLevel < 3) return null;
      const key = `${skill.id}|${fromLevel}|${target}|${GATHER_SKILLS.map((id) => skillById(id)?.level ?? 0)}|${mastery()}`;
      return memo(detourMemo, key, 100, () => {
        let best = null;
        try {
          const base = trainPlan(skill, target, "", fromLevel, fromXp), T0 = base.blocked != null ? Infinity : base.totalMs;
          const bestRate = (lv, L) => trainCands(skill, lv.set(skill.id, L))[0]?.score ?? 0;
          for (const S of GATHER_SKILLS.map(skillById)) {
            if (!S || S === skill || !isTrainable(S)) continue;
            const levels = [...new Set(list(S.actions).filter((a) => realmOk(a) && lvl(a) > S.level && lvl(a) <= S.level + 30).map(lvl))].sort((x, y) => x - y);
            for (const R of levels) {
              // quick filter: does opening this level make any method better, now or near the end of the run?
              const better = (L) => { const was = bestRate(new Map(), L), now = bestRate(new Map([[S.id, R]]), L); return now > was * 1.1 || (was === 0 && now > 0); };
              if (!better(fromLevel) && !better(target - 1)) continue;
              const det = trainPlan(S, R, "", S.level, S.xp ?? 0);
              const after = det.blocked == null && det.batches.length && trainPlan(skill, target, "", fromLevel, fromXp, new Map([[S.id, R]]));
              if (!after || after.blocked != null) continue;
              const T1 = det.totalMs + after.totalMs;
              if (T1 < T0 * 0.9 && (T0 === Infinity || T0 - T1 > 120000) && (!best || T1 < best.T1)) best = { skill: S, level: R, T1, saveMs: T0 - T1, detourMs: det.totalMs };
            }
          }
        } catch (e) { console.warn(TAG, "detour check failed", e); }
        return best;
      });
    };
    // the next batch of real queue steps for a "train" entry, planned from the player's level and bank right now
    const nextBatch = (e) => {
      const skill = skillById(e.skillId);
      if (!skill) return fail("this skill wasn't found in your game version");
      // an Agility goal fills the empty slots of your course first (you confirm each obstacle)
      const picks = skill.id === AGILITY && !e.forced ? agilityPicks(e.noBuild) : [];
      if (picks.length) return { ok: true, entries: buildSteps(picks, e.id), note: `building your course first (${plural(picks.length, "obstacle")})` };
      // a Slayer goal with no task asks about rolling one
      if (skill.id === SLAYER && !e.noTask && !hasTask()) {
        const t = slayerTier();
        if (t) return { ok: true, entries: [{ kind: "ask", what: "slayer", skillId: SLAYER, actionId: t.c.id, qty: 1, parent: e.id, label: `Slayer: roll ${aOr(nm(t.c))} task` }], note: "asking you about a Slayer task first" };
      }
      // an Archaeology goal with no map to dig with makes one first (you confirm it), and picks your tools
      if (skill.id === ARCH) {
        for (const s of list(skill.actions)) pickTools(s);
        if (!e.noMap && !list(skill.actions).some((s) => lvl(s) <= skill.level && skill.canExcavate?.(s))) {
          const { site, hidden } = mapSite();
          if (!site && hidden) return fail("you haven't found a dig site you can map yet. Survey the map in Cartography to find one");
          if (site) {
            const mats = materialSteps(costsOf(game.cartography.getMapCreationCosts(site)).items, 1, e.id);
            if (!mats) return fail(`a map for ${nm(site)} needs something the queue can't get on its own`);
            return { ok: true, entries: [...mats, { kind: "ask", what: "map", skillId: ARCH, actionId: site.id, qty: 1, parent: e.id, label: `Make a map for ${nm(site)}` }], note: `making a map for ${nm(site)} first` };
          }
        }
      }
      const dt = !e.forced && !e.noDetour && bestDetour(skill, e.targetLevel);
      if (dt && (skillById(dt.skill.id)?.level ?? 0) < dt.level) return {
        ok: true,
        entries: [{ kind: "train", skillId: dt.skill.id, targetLevel: dt.level, targetXp: xpAt(dt.level), qty: xpAt(dt.level), noDetour: true, parent: e.id, label: `${nm(dt.skill)}: reach level ${dt.level} (opens better ${nm(skill)} methods)` }],
        note: `${nm(dt.skill)} to level ${dt.level} first, saves about ${fmtDur(dt.saveMs)} on ${nm(skill)}`,
      };
      const b = trainPlan(skill, e.targetLevel, e.forced).batches[0];
      if (!b) {
        // Attack, Strength, Ranged and Magic need the right weapon: switch to a set that has one, or wait for you to equip it
        if (weaponGap(skill)) {
          const i = setFor(skill), w = WEAPON[skill.id];
          return { ok: true, entries: [{ kind: "ask", what: "equip", skillId: skill.id, actionId: w, set: i, qty: 1, parent: e.id, label: i >= 0 ? `Switch to equipment set ${i + 1} (${w})` : `Equip a ${w} weapon` }],
            note: i >= 0 ? `switching to equipment set ${i + 1} first` : `waiting for you to equip a ${w} weapon` };
        }
        const fm = e.forced && methodById(skill, e.forced), why = blockedWhy(skill);
        return fail(fm ? `${fm.name} can't be trained by the queue at level ${skill.level}` : why ? `nothing at ${nm(skill)} level ${skill.level} can be trained right now: ${why}`
          : `nothing at ${nm(skill)} level ${skill.level} can be trained by the queue on its own (it may need shop items or monster drops)`);
      }
      const m = b.c.a, goalXp = Math.min(xpAt(b.to), e.targetXp ?? Infinity), note = `${m.name} until level ${b.to} (about ${num(Math.round(b.c.rate))} XP/h)`;
      const actions = Math.max(1, Math.min(stockCap(b.c.opt.costs), m.cap?.() ?? Infinity, Math.ceil((goalXp - (skill.xp ?? 0)) / b.c.xpPer)));
      // a method that makes nothing (or isn't the usual way to make its product) runs as an XP step after its materials
      if (b.c.st.own) {
        const entries = materialSteps(b.c.opt.costs, actions, e.id), xpPer = m.xp * m.succ;
        if (!entries) return fail(`${m.name} needs something the queue can't get on its own`);
        const last = { kind: "skill", skillId: skill.id, actionId: m.id, qty: Math.ceil(actions * xpPer), untilLevel: b.to, untilSkill: skill.id, parent: e.id, label: `${nm(skill)}: ${m.name}` };
        if (e.targetXp !== undefined && e.targetXp <= xpAt(b.to)) last.untilXp = e.targetXp;
        return { ok: true, entries: [...entries, last], to: b.to, note };
      }
      const item = m.product, entries = toEntries(buildRows(item, Math.max(1, Math.floor(actions * b.c.per + 1e-9)), true)), last = entries[entries.length - 1];
      if (last?.itemId !== item.id) return fail("couldn't work out the steps");
      if (entries.some((x) => x.kind === "manual")) return fail(`${nm(item)} needs something the queue can't get on its own`);
      Object.assign(last, { untilLevel: b.to, untilSkill: skill.id, sellAll: !!e.sellMade });
      if (e.targetXp !== undefined && e.targetXp <= xpAt(b.to)) last.untilXp = e.targetXp;
      for (const x of entries) x.parent = e.id;
      // Farming: offer to buy compost so every crop grows (skip it once and this goal plants without)
      const comp = itemById(COMPOST);
      // (not while this crop is already growing or ready to pick: the harvest may be all the goal needs)
      const busy = skill.id === FARMING && openPlots(skill, m.a).some((p) => p.plantedRecipe === m.a && (p.state === PLOT.growing || p.state === PLOT.grown));
      if (skill.id === FARMING && !busy && !e.noCompost && shopFor(comp) && owned(comp) < compostPer())
        entries.unshift({ kind: "ask", what: "buy", optional: true, skipFlag: "noCompost", skipNote: "Compost makes every crop grow. Skip plants without it for the rest of this goal.", itemId: COMPOST, qty: Math.ceil(actions * m.succ) * compostPer(), parent: e.id, label: "Buy compost for your crops" });
      return { ok: true, entries, to: b.to, note };
    };
    const trainEstimate = (e) => {
      const sk = skillById(e.skillId);
      if (!sk) return null;
      const fromL = e.afterLevel > sk.level ? e.afterLevel : sk.level;
      return memo(estMemo, `${e.id}|${fromL}|${e.targetLevel}|${mastery()}`, 200, () => {
        const fromXp = fromL === sk.level ? (sk.xp ?? 0) : xpAt(fromL), plan = trainPlan(sk, e.targetLevel, e.forced, fromL, fromXp);
        const dt = !e.forced && !e.noDetour && bestDetour(sk, e.targetLevel, fromL, fromXp);
        return dt ? dt.T1 : plan.blocked != null ? null : plan.totalMs;
      });
    };
    const rowsMs = (rows) => rows.reduce((s, n) => {
      if (n.recipe) return s + n.recipe.crafts * n.recipe.c.a.ms;
      const g = gatherer(n.item.id);
      return s + (g ? (n.qty * g.a.ms) / Math.max(1, g.a.qty) : 0);
    }, 0);

    // skills with something to do (Harvesting stays hidden until the Abyssal realm is unlocked)
    const trainSkills = () => list(game.skills).filter((s) => isTrainable(s) && methodsOf(s).length);
    // items a skill can be asked to make: its methods that are the usual way to make their product
    const makeables = (skill) => methodsOf(skill).filter((m) => m.product && stepFor(m) && !stepFor(m).own).sort((x, y) => x.level - y.level);
    // what a goal does first that the plan below doesn't show (switch gear, roll a Slayer task, make a map)
    const goalFirst = (sk) => {
      if (weaponGap(sk)) {
        const i = setFor(sk), w = WEAPON[sk.id];
        return i >= 0 ? `Your equipment set ${i + 1} has a ${w} weapon. This goal switches to it first and back when it's done.` : `You don't have a ${w} weapon on. When this goal starts it waits for you to equip one.`;
      }
      if (sk.id === SLAYER && !hasTask()) { const t = slayerTier(); if (t) return `You have no Slayer task. This goal asks you before rolling ${aOr(nm(t.c))} task (${t.safe.length} of its ${t.mons.length} monsters are safe for you).`; }
      if (sk.id === ARCH && !list(sk.actions).some((s) => lvl(s) <= sk.level && sk.canExcavate?.(s))) { const { site } = mapSite(); if (site) return `You have no map to dig with. This goal makes a map for ${nm(site)} first, once you confirm it.`; }
      return null;
    };

    // ---------- running steps (Action Queue asks the trainer) ----------
    const methodOf = (e) => methodById(skillById(e.skillId), e.actionId);
    const levelIssue = (e) => {
      const sk = skillById(e.skillId), m = ["craft", "gather", "skill", "kill"].includes(e.kind) && methodById(sk, e.actionId);
      return m && m.level > sk.level ? `Needs ${nm(sk)} level ${m.level} (you have ${sk.level})` : null;
    };
    const Trainer = {
      // what a step counts: XP for skill steps, kills for kill steps (items are counted by Action Queue)
      value: (e) => (e.kind === "skill" ? Math.floor(skillById(e.skillId)?.xp ?? 0) : e.kind === "kill" ? kills(e.monsterId) : undefined),
      actor: (e) => methodOf(e)?.actor ?? skillById(e.skillId) ?? null,
      start: (e) => startAction(e),
      ticks: (e) => !!methodOf(e)?.tick,
      tick: (e) => { const m = methodOf(e); return m?.tick ? m.tick(e) : null; },
      check: (e) => {
        const m = methodOf(e), s = m?.safe?.(e);
        if (s && !s.ok) return { why: `not safe while you're away: ${s.why}` };
        return m?.check?.() ?? null;
      },
      running: (e) => { const sk = skillById(e.skillId), m = methodOf(e); return m?.active ? m.active() : !!sk && sk.isActive && game.activeAction === sk; },
      foreign: (e) => { const m = methodOf(e), actor = m?.actor ?? skillById(e.skillId); return !!game.activeAction && (game.activeAction !== actor || (!!m?.active && !m.active())); },
      restock: (e) => restockCraft(e),
      plan: (e) => nextBatch(e),
      trainFinished: (e) => restoreSet(e),
      halt: () => restoreCombat(),
      changed: () => secMemo.m.clear(),
      // ms per unit (item, XP or kill), or the whole time for a goal
      estimate: (e) => {
        if (e.kind === "train") { const t = trainEstimate(e); return t === null ? null : { total: t }; }
        const m = methodOf(e);
        if (!m) return null;
        return { per: e.kind === "skill" ? m.ms / Math.max(1e-9, m.xp * m.succ) : e.kind === "gather" ? m.ms / Math.max(1, m.qty) : m.ms / perAttempt(m, { mult: m.options[e.altIndex ?? 0]?.mult ?? 1 }) };
      },
      issue: levelIssue,
      icon: (e) => methodOf(e) ?? skillById(e.skillId),
      // while crops grow: gathering, kills, or a skill step that uses no materials
      sideJobOk: (e) => { const m = ["gather", "skill", "kill"].includes(e.kind) && methodOf(e); return !!m && !m.tick && (e.kind !== "skill" || !m.options[0].costs.length); },
    };

    // ----- the Train a skill window -----
    // ----- the Train a skill window -----
    // messages show the icon of the skill picked in the window
    const tellPlayer = (m) => A.tell(m, skillById(TS.skillId));
    const dupHtml = (entries) => A.queue.dupHtml(entries);
    const TS = { skillId: null, goal: "level", make: null, qty: 100, level: null, forced: "", sell: false };
    const fixTrain = () => {
      let sk = skillById(TS.skillId);
      if (!isTrainable(sk)) { const open = skillById(game.openPage?.id); sk = isTrainable(open) ? open : trainSkills()[0]; TS.skillId = sk?.id ?? null; }
      if (!sk) return;
      const ms = makeables(sk), ok = ms.filter((m) => m.level <= sk.level), cap = levelCap(sk);
      if (!ms.length) TS.goal = "level"; // Thieving, Firemaking and others make nothing to ask for
      if (!ms.some((m) => m.id === TS.make)) TS.make = (ok[ok.length - 1] ?? ms[0])?.id ?? null;
      if (!(TS.level > sk.level) || TS.level > cap) TS.level = Math.min(cap, Math.max(sk.level + 1, Math.ceil((sk.level + 1) / 10) * 10));
      if (TS.forced && !trainCands(sk).some((c) => c.a.id === TS.forced)) TS.forced = "";
    };
    const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(l)}</option>`;
    const select = (id, body) => `<select id="${id}" class="custom-select custom-select-sm">${body}</select>`;
    const field = (label, html) => `<label>${label}</label>${html}`;
    const check = (id, on, text) => field(id === "mst-tr-sell" ? "Selling" : "Mastery", `<label style="opacity:1"><input id="${id}" type="checkbox"${on ? " checked" : ""}> ${text}</label>`);
    const numberInput = (id, value, attrs) => `<input id="${id}" type="number" ${attrs} step="1" value="${value}" class="form-control form-control-sm">`;
    const trainForm = () => {
      const sk = skillById(TS.skillId);
      return `<div class="aq-form">` +
        field("Skill", select("mst-tr-skill", trainSkills().map((s) => opt(s.id, `${nm(s)} (level ${s.level})`, s.id === TS.skillId)).join(""))) +
        field("Goal", select("mst-tr-goal", opt("level", "Train to a level", TS.goal === "level") + (makeables(sk).length ? opt("make", "Make an amount of an item", TS.goal === "make") : ""))) +
        (TS.goal === "make"
          ? field("Item", select("mst-tr-item", makeables(sk).map((m) => opt(m.id, `${nm(m.product)} (level ${m.level}${m.level > sk.level ? ", locked" : ""})`, m.id === TS.make)).join(""))) +
            field("Amount", numberInput("mst-tr-qty", TS.qty, 'min="1"'))
          : field("Target level", numberInput("mst-tr-level", TS.level, `min="${sk.level + 1}" max="${levelCap(sk)}"`)) +
            field("Method", select("mst-tr-method", opt("", "Best available (recommended)", !TS.forced) + trainCands(sk).map((c) => opt(c.a.id, `${nm(c.a)} (about ${num(Math.round(c.rate))} XP/h)`, c.a.id === TS.forced)).join(""))) +
            check("mst-tr-sell", TS.sell, "Sell the items it makes") + check("mst-tr-mastery", mastery(), "Prefer mastery XP")) +
        `</div>`;
    };
    const nothing = (problem, html = note(esc(problem))) => ({ html, entries: [], problem });
    const trainMake = (sk) => {
      const act = methodById(sk, TS.make), qty = Math.max(1, Math.floor(TS.qty || 0)), item = act?.product;
      if (!item) return nothing("Pick an item first.", "");
      const miss = itemMissing(item, qty, true);
      if (miss.length) return nothing("You don't meet the requirements for that yet.", missingHtml(miss));
      const rows = buildRows(item, qty, true), entries = toEntries(rows);
      const xp = Math.ceil(qty / Math.max(1, act.qty * (stepFor(act)?.craft ? act.options[0].mult : 1))) * act.xp;
      const head = step(`<div class="aq-title">${icon(item)}<b>Make ${num(qty)} ${esc(nm(item))}</b></div>` +
        chips(chip(`About ${fmtDur(rowsMs(rows))}`, "ok", "Base speed, counting what your bank already holds"), chip(`${num(xp)} ${esc(nm(sk))} XP`, "", "Base XP, before bonuses")));
      return { html: dupHtml(entries) + head + itemSection(rows), entries };
    };
    // Agility: the obstacles the builder would add, with a button that queues them
    const courseHtml = (picks) => !picks.length ? "" : step(`<div class="aq-stepno">Your course</div><div class="aq-title"><b>${plural(picks.length, "empty slot")} can be filled</b></div>` +
      picks.map((x) => chips(chip(`${icon(x.o)}Slot ${x.slot + 1}: ${esc(nm(x.o))}`), chip(`${num(Math.round(x.xpSec * 3600))} XP/hour`), chip(esc(costText(x))))).join("") +
      chips('<button type="button" class="btn btn-sm btn-success" data-mst-build><i class="fa fa-hammer mr-1"></i>Build my course</button>') +
      note("Each obstacle asks you to confirm before anything is spent. An Agility goal builds them first too."));
    const queueBuild = () => {
      const picks = agilityPicks();
      if (!picks.length) return tellPlayer("Your course has no empty slots the builder can fill right now.");
      if (A.queue.add(buildSteps(picks), false, skillById(AGILITY))) tellPlayer(`Added ${plural(picks.length, "obstacle")} to build. You'll confirm each one before anything is spent.`);
      A.panel.open();
    };
    const trainLevel = (sk) => {
      const cap = levelCap(sk), L = Math.floor(TS.level || 0);
      if (!(L > sk.level) || L > cap) return nothing(sk.level >= cap ? `${nm(sk)} is already at its highest level.` : `Pick a target level between ${sk.level + 1} and ${cap}.`);
      const plan = trainPlan(sk, L, TS.forced || null), picks = sk.id === AGILITY && !TS.forced ? agilityPicks() : [];
      const goal = [{ kind: "train", skillId: sk.id, targetLevel: L, targetXp: xpAt(L), qty: xpAt(L), forced: TS.forced || undefined, sellMade: TS.sell, label: `${nm(sk)}: reach level ${L}` }];
      // an empty course can still take a goal: it builds first, then runs
      if (!plan.batches.length && picks.length) return { html: dupHtml(goal) + courseHtml(picks) + note("Your course is empty, so this goal builds it first and then runs it."), entries: goal };
      const first = !TS.forced && goalFirst(sk);
      if (!plan.batches.length && first) return { html: dupHtml(goal) + step(chips(chip(esc(first), "ok"))) + note("The plan is worked out once that's done."), entries: goal };
      if (!plan.batches.length) {
        const why = blockedWhy(sk), msg = why ? `Nothing here can be trained right now: ${why}.` : "Nothing here can be trained by the queue on its own at your level (it may need shop items or monster drops).";
        return nothing(msg, step(chips(chip(`${warnIcon}${esc(msg)}`, "warn"))));
      }
      const entries = goal, dt = !TS.forced && bestDetour(sk, L);
      const time = dt ? chip(`About ${fmtDur(dt.T1)}`, "ok", `Includes training ${esc(nm(dt.skill))} first`)
        : plan.blocked == null ? chip(`About ${fmtDur(plan.totalMs)}`, "ok", "Base speeds, gathering the materials included") : chip(`Plan covers up to level ${plan.blocked}`, "warn");
      let html = dupHtml(entries) + step(`<div class="aq-title">${icon(sk)}<b>${esc(nm(sk))}: level ${sk.level} to ${L}</b></div>` + chips(chip(`${num(Math.max(0, Math.ceil(xpAt(L) - (sk.xp ?? 0))))} XP to go`), time));
      if (dt) html += step(`<div class="aq-stepno">First</div><div class="aq-title">${icon(dt.skill)}<b>${esc(nm(dt.skill))} to level ${dt.level}</b></div>` +
        chips(chip(`About ${fmtDur(dt.detourMs)}`), chip(`Saves about ${fmtDur(dt.saveMs)}`, "ok", "Compared with staying on the methods you can use now")) +
        note(`Better ${esc(nm(sk))} methods need materials from ${esc(nm(dt.skill))} level ${dt.level}, so the queue trains it first.`));
      html += plan.batches.map((b, i) => {
        const a = b.c.a, uses = b.c.st.craft ? b.c.opt.costs.map((k) => chip(`${icon(k.item)}${num(k.quantity)} ${esc(nm(k.item))}`)).join("") : "";
        return step(`<div class="aq-stepno">${i === 0 ? "Starting at" : "Then at"} level ${b.from}${b.to > b.from ? ` (to ${b.to})` : ""}</div><div class="aq-title">${icon(a)}<b>${esc(a.name)}</b></div>` +
          chips(chip(`${num(Math.round(b.c.rate))} XP/hour`, "", "Counting the time to gather or make what it needs"), chip(`About ${fmtDur(b.ms)}`)) + (uses ? chips(chip("<b>Each uses</b>", "lbl"), uses) : ""));
      }).join("");
      const okIds = !TS.forced && new Set(trainCands(sk).map((c) => c.a.id));
      const skipped = okIds && methodsOf(sk).some((m) => m.level <= sk.level && m.xp > 0 && m.safe?.().ok !== false && !okIds.has(m.id) && xpRate(m) > plan.batches[0].c.rate);
      html += courseHtml(picks) + (first ? step(chips(chip(esc(first), "ok"))) : "");
      html += note("Methods are ranked by XP per hour including the time to gather what they need, so it won't farm a mountain of materials for little XP. The queue re-checks your level and bank after every batch." +
        (skipped ? " Some faster methods are left out because their materials need higher levels in other skills, or come from the shop or monsters." : ""));
      return { html, entries };
    };
    const trainBuild = () => {
      const sk = skillById(TS.skillId);
      return !sk ? nothing("No trainable skill found.") : TS.goal === "make" ? trainMake(sk) : trainLevel(sk);
    };
    const trainQueue = (top) => {
      const b = trainBuild();
      if (!b.entries.length) return tellPlayer(b.problem || "Nothing to add.");
      const added = A.queue.add(b.entries, top, skillById(TS.skillId));
      A.panel.open();
      if (added && A.settings.get("autoStart") && A.runner.state !== "running") A.runner.start();
    };
    // what each form field changes; "redraw" means the form itself depends on it
    const FIELDS = {
      "mst-tr-skill": (el) => { Object.assign(TS, { skillId: el.value, make: null, level: null, forced: "" }); return true; },
      "mst-tr-goal": (el) => { TS.goal = el.value; return true; },
      "mst-tr-item": (el) => { TS.make = el.value; },
      "mst-tr-qty": (el) => { TS.qty = Math.max(1, Math.floor(Number(el.value) || 1)); },
      "mst-tr-level": (el) => { TS.level = Math.floor(Number(el.value) || 0); },
      "mst-tr-method": (el) => { TS.forced = el.value; },
      "mst-tr-sell": (el) => { TS.sell = el.checked; },
      "mst-tr-mastery": (el) => { Settings.set("preferMastery", el.checked); },
    };
    const onTrainEvent = (popup, ev) => {
      const el = ev.target, fn = FIELDS[el?.id];
      if (!fn || (ev.type === "input" && (el.tagName === "SELECT" || el.type === "checkbox"))) return;
      if (fn(el)) { fixTrain(); popup.querySelector("#mst-tr-form").innerHTML = trainForm(); }
      const prev = popup.querySelector("#mst-tr-prev");
      if (prev) prev.innerHTML = trainBuild().html;
    };
    const openTrain = () => {
      Object.assign(TS, { skillId: null, make: null, level: null, forced: "" });
      fixTrain();
      if (!TS.skillId) return;
      SwalLocale.fire({
        title: "Train a skill",
        html: `<div class="text-center font-size-sm aq-pop"><div id="mst-tr-form">${trainForm()}</div><div id="mst-tr-prev">${trainBuild().html}</div></div>`,
        confirmButtonText: "Close", showDenyButton: true, denyButtonText: '<i class="fa fa-play mr-1"></i>Add to queue',
        showCancelButton: true, cancelButtonText: '<i class="fa fa-arrow-up mr-1"></i>Add to top',
        customClass: { popup: "aq-swal", confirmButton: "btn btn-primary m-1", denyButton: "btn btn-success m-1", cancelButton: "btn btn-warning m-1" },
        didOpen: (popup) => {
          for (const t of ["input", "change"]) popup.addEventListener(t, (ev) => onTrainEvent(popup, ev));
          popup.addEventListener("click", (ev) => { if (ev.target.closest?.("[data-mst-build]")) { queueBuild(); const prev = popup.querySelector("#mst-tr-prev"); if (prev) prev.innerHTML = trainBuild().html; } });
        },
        width: 620,
      })?.then?.((r) => { try { if (r?.isDenied) trainQueue(false); else if (r?.dismiss === "cancel") trainQueue(true); } catch (e) { console.warn(TAG, e); } });
    };
    // ---------- install ----------
    const API = {
      version: VERSION, settings: Settings, mastery,
      skills: { list: trainSkills, byId: skillById, isTrainable, methodsOf, methodById, makeables, stepFor, xpRate, levelCap, xpAt, levelIn, COMBAT, WEAPON },
      items: { crafter, gatherer, shopOnly, buyLeft, index: () => index() },
      plan: { buildRows, rowsFor, toEntries, materialSteps, makeTime, acquire, itemMissing, missingHtml, itemSection, rowsMs, trainCands, trainPlan, bestDetour, blockedWhy, goalFirst, agilityPicks, buildSteps, nextBatch },
      fightId, HITPOINTS,
      // other mods can say where an item comes from (monster drops, gems): fn(item, qty) returns a step, or nothing
      addSource: (fn) => { if (typeof fn === "function") SOURCES.push(fn); },
      openTrain: () => openTrain(),
      _dev: { Trainer, secMemo, startAction, restockCraft },
    };
    window.skillTrainer = API;
    parts.st = API;
    const mount = () => { if (A) A.addButton("mst-train-btn", "Train a skill: queue an item or a level goal", "fa-chart-line", 16, () => openTrain()); };
    const install = () => {
      A = aq();
      if (!A) {
        const msg = "The queue didn't load, so training is off. Reload the game and check the console if it keeps happening.";
        try { SwalLocale.fire({ title: "Skill Trainer", html: msg, icon: "warning" }); } catch (e) { console.warn(TAG, msg); }
        return;
      }
      A.setTrainer(Object.assign(Trainer, { builtIn: true }));
      for (const [what, def] of Object.entries(ASKS)) A.addAsk(what, Object.assign(def, { builtIn: true }));
      mount();
      clearInterval(window.__mstTimer);
      window.__mstTimer = setInterval(mount, 2000); // the game can rebuild the menu; put the button back if it vanishes
      console.log(TAG, "installed", VERSION);
    };
    const ready = () => typeof game !== "undefined" && list(game?.skills).length > 0 && typeof SwalLocale !== "undefined" && document.getElementById("skill-footer-minibar");
    const go = install;
    if (ready()) go();
    else { const timer = setInterval(() => { if (ready()) { clearInterval(timer); go(); } }, 500); }
  })();

  // ======================================================================================================================
  // 3. Township tasks (was the Township Task Helper mod)
  // ======================================================================================================================

(() => {
  "use strict";

  const LOG = (...a) => console.log("[Township Task Helper]", ...a);
  const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
  const nm = (o) => {
    const n = String(o?.name ?? o?._name ?? o?._localID ?? o?.id ?? "?");
    // some areas (Into the Mist, Lair of the Spider Queen) have a placeholder "random" monster with no name in the game files
    if (/^UNDEFINED TRANSLATION/i.test(n)) { try { const a = ["combatAreas", "slayerAreas", "dungeons", "strongholds", "abyssDepths"].flatMap((k) => list(game[k])).find((x) => (x.monsters ?? []).includes(o)); return a ? `Random monster in ${String(a.name)}` : "Random monster"; } catch (e) { return "Random monster"; } }
    return n;
  };
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent; };
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const icon = (o) => (typeof o?.media === "string" ? `<img class="skill-icon-xs mr-1" src="${esc(o.media)}">` : "");
  const have = (item) => {
    try { const q = game.bank.getQty(item); return Number.isFinite(q) ? q : null; } catch (e) { return null; }
  };
  // The queue part (the queue and its panel, where the steps go) and the training part (which knows how to train each skill
  // and run those steps) are above. This part works out what a task takes and adds the steps.
  const aq = () => parts.aq;
  const st = () => parts.st;
  const MELVOR_REALM = "melvorD:Melvor", HITPOINTS = "melvorD:Hitpoints";
  const intervalMs = (skill, a) =>
    a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
  const fmtDur = (ms) => {
    if (!isFinite(ms)) return "an unknown time";
    const m = Math.round(ms / 60000);
    if (m < 1) return "under 1 min";
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const areaFor = (m) => {
    for (const key of ["combatAreas", "slayerAreas"]) for (const a of list(game[key])) if ((a.monsters ?? []).includes(m)) return a;
    return null;
  };
  const itemById = (id) => { try { return game.items.getObjectByID(id); } catch (e) { return null; } };
  const skillById = (id) => list(game.skills).find((s) => s.id === id);

  // drops that live in a skill's own mechanics instead of a random product list:
  // gems while mining, general rare items while thieving, special finds while fishing.
  // each one gives a function that returns the chance (in %) per action.
  const specialDrops = (skill, a) => {
    const out = [];
    try {
      if (a.realm && a.realm.id !== MELVOR_REALM) return out;
      const mods = () => game.modifiers ?? {};
      if (skill.id === "melvorD:Mining" && a.giveGems && game.randomGemTable?.drops) {
        const tw = game.randomGemTable.totalWeight || game.randomGemTable.drops.reduce((t, d) => t + d.weight, 0);
        for (const d of game.randomGemTable.drops) if (d?.item) out.push({ id: d.item.id, pct: () => (1 + Number(mods().miningGemChance ?? 0)) * (1 + Number(mods().offItemChance ?? 0) / 100) * (d.weight / tw) });
      } else if (skill.id === "melvorD:Thieving") {
        for (const r of skill.generalRareItems ?? []) {
          if (!r?.item || (r.npcs && !(r.npcs.has ? r.npcs.has(a) : false))) continue;
          try { if (skill.isCorrectRealmForGeneralRareDrop && !skill.isCorrectRealmForGeneralRareDrop(r, a.realm)) continue; } catch (e) { /* ignore */ }
          out.push({ id: r.item.id, pct: () => { let ok = 1; try { const v = Number(skill.getNPCSuccessRate?.(a)); if (v > 0) ok = v > 1 ? v / 100 : v; } catch (e) { /* ignore */ } return Number(r.chance) * ok; } });
        }
      } else if (skill.id === "melvorD:Fishing" && a.area && skill.specialItemTables?.get) {
        const tbl = skill.specialItemTables.get(a.realm ?? game.realms?.getObjectByID?.(MELVOR_REALM)) ?? skill.specialItemTables.get(game.realms?.getObjectByID?.(MELVOR_REALM));
        if (tbl?.drops && a.area.specialChance > 0) {
          const tw = tbl.totalWeight || tbl.drops.reduce((t, d) => t + d.weight, 0);
          const base = () => (Number(a.area.specialChance) + Number(mods().bonusFishingSpecialChance ?? 0)) / 100;
          for (const d of tbl.drops) {
            if (!d?.item) continue;
            out.push({ id: d.item.id, pct: () => base() * 100 * (d.weight / tw) });
            const inner = d.item.dropTable?.drops;
            if (inner) { const itw = d.item.dropTable.totalWeight || inner.reduce((t, x) => t + x.weight, 0); for (const x of inner) if (x?.item) out.push({ id: x.item.id, pct: () => base() * 100 * (d.weight / tw) * (x.weight / itw) }); }
          }
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  };
  // Blessed Offering turns runes into Holy Dust, so it gets recipe-style fields and looks like a
  // recipe to the rest of the helper.
  const MAGIC_ID = "melvorD:Magic";
  // Herblore recipes list their potions by tier instead of one product, so give them one (the tier your mastery makes)
  const decorateHerblore = (skill) => {
    for (const a of list(skill.actions)) {
      try {
        if (a.product !== undefined || !a.potions?.length || Object.prototype.hasOwnProperty.call(a, "product")) continue;
        Object.defineProperties(a, {
          product: { get: () => a.potions[Math.min(a.potions.length - 1, Math.max(0, skill.getPotionTier?.(a) ?? 0))], configurable: true },
          baseQuantity: { get: () => 1, configurable: true },
        });
      } catch (e) { /* ignore */ }
    }
  };
  const decorateSpells = (skill) => {
    for (const sp of list(skill.actions)) {
      try {
        if (sp.produces?.id !== "melvorF:Holy_Dust" || !(sp.runesRequired?.length) || sp.specialCost?.type !== -5 || Object.prototype.hasOwnProperty.call(sp, "itemCosts")) continue;
        Object.defineProperties(sp, {
          itemCosts: { get: () => sp.runesRequired.map((r) => ({ item: r.item, quantity: r.quantity })), configurable: true },
          product: { get: () => sp.produces, configurable: true },
          baseQuantity: { get: () => sp.productionRatio ?? 1, configurable: true },
          baseInterval: { get: () => skill.baseInterval ?? 2000, configurable: true },
        });
      } catch (e) { /* ignore */ }
    }
  };
  // ---------- recipe index (built on first use) ----------
  let idx = null;
  const buildIndex = () => {
    if (idx) return idx;
    idx = { crafters: new Map(), gatherers: new Map(), randoms: new Map(), droppers: new Map(), shop: new Map() };
    for (const skill of list(game.skills)) {
      if (skill.id === MAGIC_ID) decorateSpells(skill);
      if (skill.id === "melvorD:Herblore") decorateHerblore(skill);
      for (const a of list(skill.actions)) {
        const isCraft = Array.isArray(a.itemCosts) && (a.itemCosts.length > 0 || (a.alternativeCosts?.length ?? 0) > 0);
        if (a.product) push(isCraft ? idx.crafters : idx.gatherers, a.product.id, { skill, a });
        for (const rp of a.randomProducts ?? []) if (rp?.id) push(idx.randoms, rp.id, { skill, a });
        if (skill.id === ASTRO_ID && (!a.realm || a.realm.id === MELVOR_REALM)) for (const ri of a.randomItems ?? []) if (ri?.id) push(idx.randoms, ri.id, { skill, a });
        for (const x of specialDrops(skill, a)) push(idx.randoms, x.id, { skill, a, pct: x.pct });
      }
    }
    for (const m of list(game.monsters)) {
      const drops = m.lootTable?.drops ?? m.lootTable?._drops ?? [];
      if (Array.isArray(drops)) for (const d of drops) if (d?.item) push(idx.droppers, d.item.id, m);
      if (m.bones?.item) push(idx.droppers, m.bones.item.id, m);
    }
    try {
      for (const p of list(game.shop?.purchases)) {
        for (const c of p.contains?.items ?? []) if (c?.item) push(idx.shop, c.item.id, p);
      }
    } catch (e) { console.warn("[Township Task Helper] shop index failed", e); }
    return idx;
  };

  // Cooking burns some food: costs are used every attempt, but the product and the XP only come from the ones that work.
  // Returns the share of attempts that succeed (1 for every skill that never fails).
  const succ = (skill, a) => {
    try {
      if (skill?.id === "melvorD:Cooking" && typeof skill.getRecipeSuccessChance === "function") {
        const c = Number(skill.getRecipeSuccessChance(a));
        if (c > 0 && c < 100) return Math.max(0.05, c / 100);
      }
    } catch (e) { /* ignore */ }
    return 1;
  };
  const baseCosts = (a) => (Array.isArray(a.itemCosts) ? a.itemCosts : []);
  const options = (a) =>
    a.alternativeCosts?.length
      ? a.alternativeCosts.map((o) => ({ costs: o.itemCosts ?? [], mult: o.quantityMultiplier ?? 1 }))
      : [{ costs: [], mult: 1 }];

  const explode = (item, qty, depth, path, nodes) => {
    const n = nodes.get(item.id) ?? { item, qty: 0, depth: 0 };
    n.qty += qty;
    n.depth = Math.max(n.depth, depth);
    nodes.set(item.id, n);
    const c = idx.crafters.get(item.id)?.[0];
    if (!c || path.has(item.id) || depth > 12) return;
    const opt = options(c.a)[0];
    const per = Math.max(1, (c.a.baseQuantity ?? 1) * opt.mult) * succ(c.skill, c.a);
    const crafts = Math.ceil(qty / per);
    n.recipe = { c, opt, crafts };
    path.add(item.id);
    for (const cost of [...baseCosts(c.a), ...opt.costs]) {
      if (cost?.item) explode(cost.item, cost.quantity * crafts, depth + 1, path, nodes);
    }
    path.delete(item.id);
  };

  const num = (n) => Number(n).toLocaleString();
  const chip = (html, cls = "", title = "") => `<span class="mbd-chip ${cls}"${title ? ` title="${esc(title)}"` : ""}><span>${html}</span></span>`;
  const where = (x) => `${esc(nm(x.skill))}: ${esc(nm(x.a))} (Lv ${x.a.level ?? 1})`;
  const shopCost = (p) => {
    const cur = (p.costs?.currencies ?? []).map((c) => `${Number(c.cost ?? c.quantity ?? 0).toLocaleString()} ${esc(nm(c.currency))}`);
    const its = (p.costs?.items ?? []).map((c) => `${Number(c.quantity).toLocaleString()} ${esc(nm(c.item))}`);
    return `${esc(nm(p))} for ${[...cur, ...its].join(" + ") || "free"}`;
  };
  // where an item comes from, as structured parts
  const sourceParts = (id) => {
    buildIndex();
    const parts = [];
    const g = idx.gatherers.get(id);
    if (g) parts.push({ fa: "fa-hand-paper", label: "Gather", items: g.slice(0, 3).map(where) });
    const r = idx.randoms.get(id);
    if (r) parts.push({ fa: "fa-dice", label: "Random drop", items: [...new Map(r.map((x) => [x.skill.id, x.skill])).values()].slice(0, 4).map((sk) => esc(nm(sk))) });
    const d = idx.droppers.get(id);
    if (d) parts.push({ fa: "fa-skull", label: "Monster drop", items: [...d.slice(0, 4).map((m) => esc(nm(m))), ...(d.length > 4 ? [`+${d.length - 4} more`] : [])] });
    const s = idx.shop.get(id);
    if (s) parts.push({ fa: "fa-shopping-cart", label: "Shop", items: s.slice(0, 2).map(shopCost) });
    return parts;
  };
  const wikiUrl = (id) => `https://wiki.melvoridle.com/index.php?search=${encodeURIComponent(nm(itemById(id)))}`;
  const wikiChip = (id) => chip(`<a data-mbd-wiki href="${esc(wikiUrl(id))}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline"><i class="fa fa-book mr-1"></i>Look it up on the Melvor wiki</a>`);
  const sourceText = (id) => {
    const parts = sourceParts(id);
    return parts.length ? parts.map((p) => `${p.label}: ${p.items.join("; ")}`).join(" | ") : `no source found in the game data (chest, event or other). Try the wiki: ${wikiUrl(id)}`;
  };
  const sourceHtml = (id) => {
    const parts = sourceParts(id);
    if (!parts.length) return `<div class="mbd-chips">${chip("No source found in the game data (chest, event or other)", "warn")}</div><div class="mbd-chips">${wikiChip(id)}</div>`;
    return parts.map((p) => `<div class="mbd-chips">${chip(`<i class="fa ${p.fa}"></i> <b>${p.label}</b>`, "lbl")}${p.items.map((i) => chip(i)).join("")}</div>`).join("");
  };

  // ---------- Astrology: Stardust and Golden Stardust are random drops from studying a constellation ----------
  // Each constellation also boosts other skills, so the player picks one on purpose or lets the mod take the best XP per hour.
  const ASTRO_ID = "melvorD:Astrology";
  const Astro = { pick: "best" }; // "best" or a constellation id; reset whenever a popup opens
  const astroSkill = () => skillById(ASTRO_ID);
  const astroCons = (item) => {
    const sk = astroSkill();
    return sk && item ? list(sk.actions).filter((c) => (!c.realm || c.realm.id === MELVOR_REALM) && (c.randomItems ?? []).some((i) => i.id === item.id)) : [];
  };
  const isAstroItem = (item) => astroCons(item).length > 0;
  const astroInterval = (sk, c) => sk.getConstellationInterval?.(c) ?? intervalMs(sk, c);
  const astroXpHr = (sk, c) => ((c.baseExperience ?? 0) / astroInterval(sk, c)) * 3600000;
  // how many of the item one hour of studying finds, on average
  const astroPerHour = (sk, c, item) => {
    const p = Number(sk.getRandomItemChance?.(item) ?? 0) / 100;
    const d = Number(sk.getDoublingChance?.(c) ?? 0) / 100;
    return (3600000 / astroInterval(sk, c)) * p * (1 + (d > 0 && d < 1 ? d : 0));
  };
  const astroOptions = (item) => {
    const sk = astroSkill();
    return astroCons(item).map((c) => ({ c, level: c.level ?? 1, open: (c.level ?? 1) <= sk.level, xpHr: astroXpHr(sk, c), perHr: astroPerHour(sk, c, item) })).sort((a, b) => a.level - b.level);
  };
  const bestCon = (item) => astroOptions(item).filter((o) => o.open).sort((a, b) => b.xpHr - a.xpHr || b.level - a.level)[0] ?? null;
  const conChoice = (item) => (Astro.pick === "best" ? bestCon(item) : astroOptions(item).find((o) => o.c.id === Astro.pick && o.open) ?? bestCon(item));
  const astroBoosts = (c) => (c.skills ?? []).map((s) => nm(s));
  const astroHtml = (item, qty) => {
    const sk = astroSkill(), opts = astroOptions(item), best = bestCon(item), cur = conChoice(item);
    if (!opts.length || !best || !cur) return sourceHtml(item.id);
    const label = (o) => `${nm(o.c)} · ${astroBoosts(o.c).slice(0, 3).join(", ")}${astroBoosts(o.c).length > 3 ? "..." : ""} · ${num(Math.round(o.xpHr))} XP/h`;
    const sel = `<select data-mbd-astro class="custom-select custom-select-sm" style="max-width:100%;width:auto">` +
      `<option value="best"${Astro.pick === "best" ? " selected" : ""}>Best XP/hour: ${esc(nm(best.c))} (${num(Math.round(best.xpHr))} XP/h)</option>` +
      opts.map((o) => `<option value="${esc(o.c.id)}"${Astro.pick === o.c.id ? " selected" : ""}${o.open ? "" : " disabled"}>${esc(label(o))}${o.open ? "" : ` (needs level ${o.level})`}</option>`).join("") + `</select>`;
    const hrs = qty / Math.max(1e-9, cur.perHr);
    const mastery = (() => { try { return sk.getMasteryLevel(cur.c); } catch (e) { return null; } })();
    return `<div class="mbd-chips">${chip(`<i class="fa fa-star"></i> <b>Astrology</b>`, "lbl")}${chip("Random drop while studying a constellation")}</div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">Which constellation?</div><div class="mbd-chips">${sel}</div></div>` +
      `<div class="mbd-chips">${chip(`${esc(nm(cur.c))}`)}${chip(`${num(Math.round(cur.xpHr))} XP/hour`)}${mastery !== null ? chip(`Mastery ${mastery}`) : ""}` +
      `${chip(`About ${fmtDur(hrs * 3600000)}`, "ok", "Average, at base speed")}</div>` +
      `<div class="mbd-chips">${chip(`Boosts ${esc(astroBoosts(cur.c).join(", "))}`)}</div>` +
      `<div class="mbd-note">Studying also levels the constellation's mastery. Pick one to train it on purpose, or take the best XP/hour and the queue switches to a better one when you level up.</div>`;
  };

  // ---------- Farming an item that only drops ----------
  // Bird Nest and friends are random drops. Order of preference: a skill that drops it while you train (best XP/hour),
  // then a fight that is safe for you, then a risky fight only if the player says so. A Slayer task on a monster that drops
  // the item is shown as an option because those kills count twice.
  const Farm = { pick: {} };
  const farmPick = (item) => Farm.pick[item.id] ?? "best";
  const isFarmItem = (item) => {
    if (!item) return false;
    buildIndex();
    if (idx.gatherers.get(item.id) || idx.crafters.get(item.id) || isAstroItem(item)) return false;
    return !!(idx.randoms.get(item.id) || idx.droppers.get(item.id));
  };
  const farmSkills = (item) => {
    buildIndex();
    const out = [];
    for (const x of idx.randoms.get(item.id) ?? []) {
      if (x.skill.id === ASTRO_ID || (x.a.realm && x.a.realm.id !== MELVOR_REALM)) continue;
      let chance = 0;
      if (x.pct) { try { chance = Number(x.pct()); } catch (e) { /* ignore */ } }
      if (!(chance > 0)) try { chance = Number(x.skill.getRandomProductInfo?.(item)?.chance ?? 0); } catch (e) { /* ignore */ }
      if (!(chance > 0)) { try { chance = Number(x.skill.randomProducts?.get?.(item)?.chance ?? 0); } catch (e) { /* ignore */ } }
      if (!(chance > 0)) continue;
      const ms = intervalMs(x.skill, x.a);
      out.push({ type: "skill", skill: x.skill, a: x.a, id: "s:" + x.a.id, open: (x.a.level ?? 1) <= x.skill.level, level: x.a.level ?? 1,
        xpHr: ((x.a.baseExperience ?? 0) / ms) * 3600000, perHr: (3600000 / ms) * (chance / 100) });
    }
    return out.sort((a, b) => a.level - b.level);
  };
  const bestFarmSkill = (item) => farmSkills(item).filter((o) => o.open).sort((a, b) => b.xpHr - a.xpHr || b.perHr - a.perHr)[0] ?? null;
  const nmult = () => (typeof numberMultiplier === "number" ? numberMultiplier : 10);
  const stdMax = (lvl, b) => { const e = lvl + 9; return Math.floor(nmult() * (1.3 + e / 10 + b / 80 + (e * b) / 640)); };
  // the hardest a monster's normal attack can hit (special attacks can hit harder)
  const monsterMaxHit = (m) => {
    try {
      const lv = m.levels ?? {};
      if (m.attackType === "melee") return stdMax(lv.Strength ?? 1, statVal(m, "meleeStrengthBonus"));
      if (m.attackType === "ranged") return stdMax(lv.Ranged ?? 1, statVal(m, "rangedStrengthBonus"));
      const sp = m.selectedSpell;
      if (!sp) return null;
      if (sp.spellbook && sp.spellbook.allowDamageModifiers === false) return Math.round(nmult() * sp.maxHit);
      return Math.floor(nmult() * sp.maxHit * (1 + statVal(m, "magicDamageBonus") / 100) * (1 + ((lv.Magic ?? 1) + 1) / 200));
    } catch (e) { return null; }
  };
  // One switch in the mod settings menu (ctx.settings), with localStorage as the fallback.
  let setSec = null;
  try {
    setSec = ctx.settings.section("Township Task Helper");
    setSec.add({ type: "switch", name: "noAutoEat", label: "Fights don't need auto eat", hint: "Turn this on if you're playing while the queue runs and will eat yourself. Fights then count as safe without auto eat or food equipped, as long as the monster can't hit for half your HP or more.", default: false });
  } catch (e) { setSec = null; }
  const noAutoEat = () => {
    try { const v = setSec?.get("noAutoEat"); if (v !== undefined && v !== null) return !!v; } catch (e) { /* use the fallback */ }
    try { return localStorage.getItem("mbd-th-noautoeat") === "1"; } catch (e) { return false; }
  };
  parts.noAutoEat = noAutoEat; // the training part's fight check follows this setting too
  // what you have to survive with: HP, equipped food and the auto eat settings (a queue runs while you're away, so only auto eat counts)
  const playerGuard = () => {
    const pl = game.combat?.player;
    const hs = skillById("melvorD:Hitpoints");
    const hp = pl?.stats?.maxHitpoints ?? nmult() * (hs?.level ?? 10);
    const slot = pl?.food?.slots?.[pl.food.selectedSlot];
    let heal = 0;
    try { if (slot?.item) heal = pl.getFoodHealing(slot.item); } catch (e) { /* ignore */ }
    let threshold = 0, eff = 0, swap = false;
    try { threshold = Number(pl.autoEatThreshold) || 0; eff = threshold > 0 ? Math.max(1, Number(pl.autoEatEfficiency) || 0) : 0; } catch (e) { /* ignore */ }
    try { swap = pl.modifiers?.autoSwapFoodUnlocked > 0 && !!game.settings?.enableAutoSwapFood; } catch (e) { /* ignore */ }
    const eat = (s) => Math.floor((pl.getFoodHealing(s.item) * eff) / 100);
    let pool = 0;
    try {
      const slots = swap ? pl.food.slots : slot ? [slot] : [];
      for (const s of slots) if (s.item && s.quantity > 0) pool += s.quantity * eat(s);
    } catch (e) { /* ignore */ }
    return { hp, heal, food: slot?.item && slot.quantity > 0 ? nm(slot.item) : null, foodQty: slot?.quantity ?? 0, auto: threshold > 0, threshold, eff, effHeal: eff ? Math.floor((heal * eff) / 100) : 0, pool, swap };
  };
  // rough damage you take killing this monster once (it respawns after a few seconds)
  const RESPAWN_MS = 3000; // the pause before the next monster appears
  // how long you take to kill it once (you land about 75% of your hits)
  const killTimeMs = (m) => {
    try {
      const st = game.combat.player.stats;
      const mine = ((st.minHit + st.maxHit) / 2) * 0.75;
      const mhp = (m.levels?.Hitpoints ?? 1) * nmult();
      return Math.ceil(mhp / Math.max(1, mine)) * (st.attackInterval || 4000);
    } catch (e) { return null; }
  };
  const damagePerKill = (m, avg) => {
    const killMs = killTimeMs(m);
    return killMs === null ? null : avg * (killMs / (statVal(m, "attackSpeed") || 3000)) * 0.75;
  };
  // safe = auto eat is on and starts early enough to survive its biggest hit, and your food covers the whole farm
  const fightSafety = (m, kills = 1) => {
    const max = monsterMaxHit(m), g = playerGuard();
    if (max === null) return { safe: false, max, avg: null, g, why: "can't tell how hard it hits" };
    const avg = (1 + max) / 2;
    if (max * 2 >= g.hp) return { safe: false, max, avg, g, why: `can hit for ${num(max)} against your ${num(g.hp)} HP` };
    if (noAutoEat()) return { safe: true, max, avg, g, why: `it hits for ${num(max)} at most against your ${num(g.hp)} HP, and you're set to eat yourself` };
    if (!g.food) return { safe: false, max, avg, g, why: "you have no food equipped" };
    const dpk = damagePerKill(m, avg);
    const total = dpk === null ? null : dpk * kills;
    if (!g.auto) {
      if (total !== null && total < g.hp * 0.5) return { safe: true, max, avg, g, why: `it can't do much damage over this farm (about ${num(Math.round(total))} of your ${num(g.hp)} HP)` };
      return { safe: false, max, avg, g, why: "auto eat is off, so nothing eats your food while the queue runs" };
    }
    if (g.threshold < max) return { safe: false, max, avg, g, why: `auto eat starts at ${num(Math.round(g.threshold))} HP but it can hit for ${num(max)}` };
    const need = total === null ? null : Math.ceil(total / Math.max(1, g.effHeal));
    const have = Math.floor(g.pool / Math.max(1, g.effHeal));
    if (total !== null && total > g.pool) return { safe: false, max, avg, g, need, have, why: `this farm needs about ${num(need)} food and auto eat can use ${num(have)}${g.swap ? "" : " from the food slot in use"}` };
    return { safe: true, max, avg, g, need, have, why: `auto eat starts at ${num(Math.round(g.threshold))} HP, it hits for ${num(max)} at most, and your food lasts` };
  };
  const dropPerKill = (m, item) => {
    let p = 0;
    if (m.bones?.item?.id === item.id) p += Number(m.bones.quantity ?? 1);
    const lt = m.lootTable, drops = lt?.drops ?? lt?._drops ?? [];
    const tw = Number(lt?.totalWeight) || (Array.isArray(drops) ? drops.reduce((s, d) => s + (d.weight || 0), 0) : 0);
    if (Array.isArray(drops) && tw > 0) for (const d of drops) if (d.item?.id === item.id) p += ((m.lootChance ?? 100) / 100) * (d.weight / tw) * (((d.minQuantity ?? 1) + (d.maxQuantity ?? 1)) / 2);
    return p;
  };
  const slayerTaskNow = () => {
    try { const t = game.combat?.slayerTask; return t?.active && t.monster && t.killsLeft > 0 ? t : null; } catch (e) { return null; }
  };
  const farmFights = (item, qty = 1) => {
    buildIndex();
    const task = slayerTaskNow();
    const out = [];
    for (const m of idx.droppers.get(item.id) ?? []) {
      if (!areaFor(m) || /^UNDEFINED TRANSLATION/i.test(String(m.name))) continue; // placeholder "random monster" slots have no real stats, so they are not offered
      const perKill = dropPerKill(m, item);
      if (!(perKill > 0)) continue;
      let open = true;
      try { open = !areaMissing(m).length; } catch (e) { /* ignore */ }
      const kills = Math.ceil(qty / perKill), safety = fightSafety(m, kills), km = killTimeMs(m);
      const ms = km === null ? Infinity : kills * (km + RESPAWN_MS);
      // efficiency: time to finish, made worse the more of your food it burns; a Slayer task you needed anyway counts for a lot
      const foodShare = safety.need != null && safety.have > 0 ? Math.min(1, safety.need / safety.have) : 1;
      const onTask = !!task && task.monster === m;
      out.push({ type: "fight", m, id: "m:" + m.id, open, perKill, kills, ms, food: safety.need ?? null, safety, onTask, taskLeft: onTask ? task.killsLeft : 0, score: ms * (1 + 0.5 * foodShare) * (onTask ? 0.75 : 1) });
    }
    return out.sort((a, b) => b.open - a.open || b.safety.safe - a.safety.safe || a.score - b.score);
  };
  // what "best" means for this item right now
  const farmPlan = (item, ignorePick = false, qty = 1) => {
    const pick = ignorePick ? "best" : farmPick(item);
    const skills = farmSkills(item), fights = farmFights(item, qty);
    if (pick.startsWith("s:")) { const o = skills.find((x) => x.id === pick && x.open); if (o) return { opt: o, auto: false }; }
    if (pick.startsWith("m:")) { const o = fights.find((x) => x.id === pick && x.open); if (o) return { opt: o, auto: false }; }
    const s = bestFarmSkill(item);
    if (s) return { opt: s, auto: true };
    const okFights = fights.filter((f) => f.open);
    const safe = okFights.filter((f) => f.safety.safe).sort((a, b) => a.score - b.score)[0];
    if (safe) return { opt: safe, auto: true };
    const risky = okFights.sort((a, b) => a.score - b.score)[0];
    return risky ? { opt: risky, auto: true, risky: true } : { opt: null, auto: true };
  };
  const farmHtml = (item, qty) => {
    const skills = farmSkills(item), fights = farmFights(item, qty);
    const plan = farmPlan(item, false, qty), o = plan.opt, auto = farmPlan(item, true, qty).opt;
    if (!skills.length && !fights.length) return sourceHtml(item.id);
    const label = (x) => x.type === "skill"
      ? `${nm(x.skill)}: ${nm(x.a)} · ${num(Math.round(x.xpHr))} XP/h · about ${(x.perHr).toFixed(x.perHr < 10 ? 1 : 0)}/h${x.open ? "" : ` (needs level ${x.level})`}`
      : `Fight ${nm(x.m)} (Combat Lv ${num(x.m.combatLevel ?? 0)}) · ${x.perKill >= 1 ? "drops every kill" : `about 1 in ${num(Math.round(1 / x.perKill))} kills`} · ${isFinite(x.ms) ? "about " + fmtDur(x.ms) : "time unknown"} · ${x.safety.safe ? "safe" : "risky"}${x.onTask ? " · your Slayer task" : ""}${x.open ? "" : " (area locked)"}`;
    const cur = farmPick(item);
    const autoTxt = !auto ? "nothing you can do yet" : auto.type === "skill" ? `${nm(auto.skill)}, ${nm(auto.a)} (best XP/hour)` : `fight ${nm(auto.m)}${auto.safety.safe ? " (most efficient safe fight)" : " (risky)"}`;
    const sel = `<select data-mbd-farm="${esc(item.id)}" class="custom-select custom-select-sm" style="max-width:100%;width:auto">` +
      `<option value="best"${cur === "best" ? " selected" : ""}>Automatic: ${esc(autoTxt)}</option>` +
      (skills.length ? `<optgroup label="Skilling">${skills.map((x) => `<option value="${esc(x.id)}"${cur === x.id ? " selected" : ""}${x.open ? "" : " disabled"}>${esc(label(x))}</option>`).join("")}</optgroup>` : "") +
      (fights.length ? `<optgroup label="Combat, lowest level first">${[...fights].sort((p, q) => (p.m.combatLevel ?? 0) - (q.m.combatLevel ?? 0)).map((x) => `<option value="${esc(x.id)}"${cur === x.id ? " selected" : ""}${x.open ? "" : " disabled"}>${esc(label(x))}</option>`).join("")}</optgroup>` : "") + `</select>`;
    let html = `<div class="mbd-chips">${chip(`<i class="fa fa-dice"></i> <b>Random drop</b>`, "lbl")}${chip("Farm it while you train, or by fighting")}</div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">How do you want to get it?</div><div class="mbd-chips">${sel}</div></div>`;
    if (o && o.type === "skill") {
      html += `<div class="mbd-chips">${chip(`${icon(o.skill)}${esc(nm(o.skill))}`)}${chip(esc(nm(o.a)))}${chip(`${num(Math.round(o.xpHr))} XP/hour`)}${chip(`About ${fmtDur((qty / o.perHr) * 3600000)}`, "ok", "Average, at base speed")}</div>` +
        `<div class="mbd-note">You train ${esc(nm(o.skill))} while it drops. ${plan.auto ? "The queue moves to a better method when you level up." : ""}</div>`;
    } else if (o) {
      const kills = Math.ceil(qty / o.perKill);
      html += `<div class="mbd-chips">${chip(`${esc(nm(o.m))}`)}${chip(`Combat Lv ${num(o.m.combatLevel ?? 0)}`)}${chip(`About ${num(kills)} kills`, "ok", "Average drop rate")}${isFinite(o.ms) ? chip(`About ${fmtDur(o.ms)}`, "ok", "Kill time plus the pause between monsters, using your damage and an average drop rate") : ""}${o.food != null ? chip(`About ${num(o.food)} food`, "", "Food auto eat is expected to use") : ""}${chip(o.safety.safe ? "Safe for you" : "Risky for you", o.safety.safe ? "ok" : "warn", esc(o.safety.why))}</div>` +
        `<div class="mbd-note">${esc(cap(o.safety.why))}.${o.safety.safe ? "" : " Special attacks can hit harder than this."}</div>`;
      if (o.onTask) html += `<div class="mbd-chips">${chip(`<i class="fa fa-skull"></i> Your Slayer task: ${num(o.taskLeft)} left`, "ok", "These kills count toward it")}</div>`;
      if (!o.safety.safe) html += `<div class="mbd-chips">${chip("<i class='fa fa-exclamation-triangle'></i> The queue won't run this fight, you do it yourself", "warn", "The queue only runs fights that are safe while you're away")}</div>`;
    } else html += `<div class="mbd-note">Nothing you can do yet gives this item. ${lvlWarn(item.id)}</div>`;
    const task = slayerTaskNow();
    if (task && (!o || o.type !== "fight" || !o.onTask)) {
      const f = fights.find((x) => x.onTask);
      if (f) html += `<div class="mbd-chips">${chip(`<i class="fa fa-skull"></i> Your Slayer task (${esc(nm(f.m))}) drops this, pick it from the list to count both`, "", "")}</div>`;
    }
    return html;
  };

  // ---------- breakdown rows -> popup html / queue entries ----------
  const lvlChip = (skill, a) =>
    skill && (a.level ?? 1) > skill.level
      ? chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;Needs ${esc(nm(skill))} level ${a.level} (you have ${skill.level})`, "warn")
      : "";
  const lvlWarn = (id) => {
    buildIndex();
    if (idx.shop.get(id)) return "";
    const opts = [...(idx.gatherers.get(id) ?? []), ...(idx.randoms.get(id) ?? [])];
    if (!opts.length || opts.some((x) => (x.a.level ?? 1) <= x.skill.level)) return "";
    const best = opts.reduce((m, x) => ((x.a.level ?? 1) - x.skill.level < (m.a.level ?? 1) - m.skill.level ? x : m));
    return `<div class="mbd-chips">${lvlChip(best.skill, best.a)}</div>`;
  };
  const buyHtml = (id, need) => {
    buildIndex();
    const p = idx.shop.get(id)?.[0];
    if (!p || need <= 0) return "";
    try {
      const per = Math.max(1, p.contains.items.find((c) => c.item.id === id)?.quantity ?? 1);
      let n = Math.ceil(need / per);
      if (!p.allowQuantityPurchase) n = Math.min(n, 1);
      n = Math.min(n, game.shop.capPurchaseQuantity(p, n));
      if (!(n > 0)) return "";
      const bought = game.shop.getPurchaseCount(p);
      const parts = [];
      for (const c of p.costs.currencies ?? []) parts.push(`${num(game.shop.getCurrencyCost(c, n, bought))} ${esc(nm(c.currency))}`);
      for (const c of p.costs.items ?? []) parts.push(`${num(c.quantity * n)} ${esc(nm(c.item))}`);
      const ok = game.shop.getPurchaseCosts(p, n).checkIfOwned() && game.checkRequirements(p.purchaseRequirements);
      const label = `<i class="fa fa-shopping-cart mr-1"></i>Buy ${num(n * per)} ${esc(nm(itemById(id)))} for ${parts.join(" + ")}`;
      return `<div class="mbd-chips"><button type="button" class="btn btn-sm ${ok ? "btn-success" : "btn-outline-secondary"}" data-mbd-buy="${esc(p.id)}" data-n="${n}"${ok ? "" : " disabled"}>${label}</button></div>` +
        (ok ? "" : `<div class="mbd-chips">${chip("You can't afford this yet, or it's locked", "warn")}</div>`);
    } catch (e) { console.warn("[Township Task Helper] shop button", e); return ""; }
  };

  const reqText = (r) => {
    try {
      if (r.type === "SkillLevel") return `${r.level} ${nm(r.skill)}`;
      if (r.type === "DungeonCompletion") return `${nm(r.dungeon)} completed${r.count > 1 ? ` ${r.count} times` : ""}`;
      if (r.type === "ShopPurchase") return `${nm(r.purchase)} (from the shop)`;
      if (r.type === "SlayerItem") return `${nm(r.item)} equipped`;
    } catch (e) { /* fall through */ }
    return String(r.type ?? "an unmet requirement").replace(/([a-z])([A-Z])/g, "$1 $2");
  };
  const areaMissing = (m) => {
    const a = areaFor(m);
    const out = [];
    for (const r of a?.entryRequirements ?? []) {
      try { if (!game.checkRequirement(r)) out.push({ text: reqText(r), forName: nm(m) }); } catch (e) { /* ignore */ }
    }
    return out;
  };
  const itemMissing = (item, qty, fresh = false) => {
    const out = [];
    for (const n of buildRows(item, qty, fresh)) {
      if (n.recipe) {
        const { c } = n.recipe;
        if ((c.a.level ?? 1) > c.skill.level) out.push({ text: `${c.a.level} ${nm(c.skill)}`, forName: nm(n.item) });
        continue;
      }
      const id = n.item.id;
      if (idx.shop.get(id)) continue;
      const opts = [...(idx.gatherers.get(id) ?? []), ...(idx.randoms.get(id) ?? [])];
      if (!opts.length || opts.some((x) => (x.a.level ?? 1) <= x.skill.level)) continue;
      try { if (idx.droppers.get(id)?.some((m) => areaFor(m) && !areaMissing(m).length)) continue; } catch (e) { /* ignore */ }
      const best = opts.reduce((m, x) => ((x.a.level ?? 1) - x.skill.level < (m.a.level ?? 1) - m.skill.level ? x : m));
      out.push({ text: `${best.a.level ?? 1} ${nm(best.skill)}`, forName: nm(n.item) });
    }
    const seen = new Set();
    return out.filter((x) => { const k = x.text + "|" + x.forName; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const missingHtml = (miss) =>
    `<div class="mbd-step">` +
    miss.map((x) => `<div class="mbd-chips">${chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;Warning: ${esc(x.text)} required for ${esc(x.forName)}`, "warn")}</div>`).join("") +
    `<div class="mbd-note">You can't queue this until you meet the requirements.</div></div>`;

  const buildRows = (item, qty, fresh = false) => {
    buildIndex();
    const nodes = new Map();
    explode(item, qty, 0, new Set(), nodes);
    // second pass, parents before children: what the bank already holds is used first, and only the rest is made
    const demand = new Map([[item.id, qty]]);
    const rows = [];
    for (const n of [...nodes.values()].sort((a, b) => a.depth - b.depth)) {
      const need = demand.get(n.item.id) ?? 0;
      if (need <= 0) continue;
      const isRoot = fresh && n.item.id === item.id;
      const owned = isRoot ? 0 : have(n.item) ?? 0;
      const make = Math.max(0, need - owned);
      n.need = need;
      n.fresh = isRoot;
      n.qty = make;
      if (n.recipe) {
        const { c, opt } = n.recipe;
        const per = Math.max(1, (c.a.baseQuantity ?? 1) * opt.mult) * succ(c.skill, c.a);
        const crafts = Math.ceil(make / per);
        n.recipe = { c, opt, crafts };
        if (make > 0) {
          for (const cost of [...baseCosts(c.a), ...opt.costs]) {
            if (cost?.item) demand.set(cost.item.id, (demand.get(cost.item.id) ?? 0) + cost.quantity * crafts);
          }
        }
      }
      if (make > 0) rows.push(n);
    }
    return rows.sort((a, b) => b.depth - a.depth || nm(a.item).localeCompare(nm(b.item)));
  };

  const itemSection = (item, qty, fresh = false) => {
    const rows = buildRows(item, qty, fresh);
    if (!rows.length) return `<div class="mbd-step"><div class="mbd-chips">${chip(`<i class="fa fa-check"></i> You already have enough in your bank`, "ok")}</div></div>`;
    return rows.map((n, i) => {
      const owned = have(n.item);
      const haveChip = owned === null || n.fresh ? "" : chip(`You have ${num(owned)}${n.need !== undefined ? ` of ${num(n.need)} needed` : ""}`);
      let title, chips;
      if (n.recipe) {
        const { c, opt, crafts } = n.recipe;
        const uses = [...baseCosts(c.a), ...opt.costs].filter((x) => x?.item).map((x) => chip(`${icon(x.item)}${num(x.quantity * crafts)} ${esc(nm(x.item))}`));
        const alts = (idx.crafters.get(n.item.id)?.length ?? 1) - 1 + options(c.a).length - 1;
        title = `${icon(c.skill)}<b>${esc(nm(c.skill))}</b>: make ${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
        chips =
          `<div class="mbd-chips">${chip(`Level ${c.a.level ?? 1}`)}${chip(`${num(crafts)} craft${crafts === 1 ? "" : "s"}`)}${haveChip}${alts > 0 ? chip(`${alts} other option${alts === 1 ? "" : "s"}`) : ""}</div>` +
          (uses.length ? `<div class="mbd-chips">${chip("<b>Uses</b>", "lbl")}${uses.join("")}</div>` : "") +
          (lvlChip(c.skill, c.a) ? `<div class="mbd-chips">${lvlChip(c.skill, c.a)}</div>` : "");
      } else {
        title = `${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
        chips = `<div class="mbd-chips">${haveChip}</div>` + (isAstroItem(n.item) ? astroHtml(n.item, n.qty) : isFarmItem(n.item) ? farmHtml(n.item, n.qty) + buyHtml(n.item.id, n.qty) : sourceHtml(n.item.id) + buyHtml(n.item.id, n.qty) + lvlWarn(n.item.id));
      }
      return `<div class="mbd-step"><div class="mbd-stepno">Step ${i + 1}</div><div class="mbd-title">${title}</div>${chips}</div>`;
    }).join("");
  };

  // Queue entries: "kind" is what the runner does; qty is how many MORE of the item to end up with
  // (for "manual" entries it is how many you should own).
  const toEntries = (rows) =>
    rows.map((n) => {
      const base = { itemId: n.item.id, qty: n.qty };
      if (n.recipe) {
        const { c } = n.recipe;
        return { ...base, kind: "craft", skillId: c.skill.id, actionId: c.a.id, altIndex: 0, label: `${nm(c.skill)}: make ${nm(n.item)}` };
      }
      const g = idx.gatherers.get(n.item.id)?.[0];
      if (!g) { const d = dropEntry(n.item, n.qty); if (d) return { ...base, ...d }; }
      if (g) return { ...base, kind: "gather", skillId: g.skill.id, actionId: g.a.id, label: `${nm(g.skill)}: gather ${nm(n.item)}` };
      const why = riskyFightNote(n.item, n.qty);
      return { ...base, qty: n.need ?? n.qty, kind: "manual", label: why ? `Fight ${why.name} for ${nm(n.item)}` : `Get ${nm(n.item)}`, note: why ? why.note : plain(sourceText(n.item.id)) };
    });
  // The best fight for a random drop isn't safe, so the queue can't run it. Say which fight it is and why, instead of a vague note.
  const riskyFightNote = (item, qty) => {
    if (!isFarmItem(item)) return null;
    const o = farmPlan(item, false, qty).opt;
    if (o?.type !== "fight" || o.safety.safe) return null;
    const kills = Math.ceil(qty / o.perKill);
    return { name: nm(o.m), note: `Kill ${nm(o.m)} until you own ${num(qty)} ${nm(item)} (about ${num(kills)} kills). The queue only runs fights that are safe while you're away, and this one isn't: ${o.safety.why}. Do it yourself, or fix that and add the step again.` };
  };
  // A random drop runs as an Action Queue gather step: study a constellation, train a skill that drops it, or fight a monster
  // that drops it (safe fights only). unitMs is the average time per item, so the queue's time estimate is right.
  const dropEntry = (item, qty) => {
    if (isAstroItem(item)) {
      const ch = conChoice(item);
      if (ch) return { kind: "gather", skillId: ASTRO_ID, actionId: ch.c.id, unitMs: ch.perHr > 0 ? 3600000 / ch.perHr : undefined, label: `${nm(astroSkill())}: study ${nm(ch.c)} for ${nm(item)}` };
    }
    if (!isFarmItem(item)) return null;
    const o = farmPlan(item, false, qty).opt, fid = o?.type === "fight" && st()?.fightId(o.m);
    if (o?.type === "skill") return { kind: "gather", skillId: o.skill.id, actionId: o.a.id, unitMs: o.perHr > 0 ? 3600000 / o.perHr : undefined, label: `${nm(o.skill)}: ${nm(o.a)} for ${nm(item)}` };
    if (fid && o.safety.safe) return { kind: "gather", skillId: HITPOINTS, actionId: fid, unitMs: isFinite(o.ms) ? o.ms / Math.max(1, qty) : undefined, label: `Fight ${nm(o.m)} for ${nm(item)}` };
    return null;
  };

  const AREA_KINDS = [
    ["combatAreas", "Combat Area"], ["slayerAreas", "Slayer Area"], ["dungeons", "Dungeon"],
    ["strongholds", "Stronghold"], ["abyssDepths", "Abyssal Depth"],
  ];
  const ATTACK_ICON = { melee: "melvorD:Attack", ranged: "melvorD:Ranged", magic: "melvorD:Magic" };
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const TRIANGLE = { melee: "magic", ranged: "melee", magic: "ranged" }; // what beats what: Magic > Melee > Ranged > Magic
  const statVal = (m, key) => (m.equipmentStats ?? []).find((x) => x.key === key)?.value ?? 0;
  const styleChip = (t, cls = "", title = "", extra = "") => {
    const sk = skillById(ATTACK_ICON[t]);
    return chip(`${sk ? icon(sk) : ""}${esc(cap(t))}${extra}`, cls, title);
  };
  const row = (label, chips) => (chips.length ? `<div class="mbd-row"><div class="mbd-rowlbl">${label}</div><div class="mbd-chips">${chips.join("")}</div></div>` : "");
  const combatSection = (m) => {
    const styles = m.attackType === "random" ? ["melee", "ranged", "magic"] : m.attackType ? [m.attackType] : [];
    const attacks = styles.map((t) => styleChip(t));
    if (m.attackType === "random") attacks.push(chip("<small>picks one at random</small>"));
    if (m.damageType && m.damageType.id !== "melvorD:Normal") attacks.push(chip(`${typeof m.damageType.media === "string" ? icon(m.damageType) : ""}${esc(nm(m.damageType))}`));
    const specials = (m.specialAttacks ?? []).filter((x) => x?.attack).map((x) => chip(`${esc(nm(x.attack))} <small>${num(x.chance)}%</small>`, "", plain(String(x.attack.description ?? ""))));
    const passives = (m.passives ?? []).map((x) => chip(esc(nm(x)), "", plain(String(x.description ?? ""))));
    const def = { melee: statVal(m, "meleeDefenceBonus"), ranged: statVal(m, "rangedDefenceBonus"), magic: statVal(m, "magicDefenceBonus") };
    const low = Math.min(def.melee, def.ranged, def.magic);
    const lowStyles = new Set(Object.keys(def).filter((k) => def[k] === low && !(def.melee === def.ranged && def.ranged === def.magic)));
    const tri = TRIANGLE[m.attackType];
    const weak = [];
    if (tri) weak.push(styleChip(tri, "ok", `Combat triangle: ${cap(tri)} beats ${cap(m.attackType)}`, ` <small>beats ${cap(m.attackType)}</small>`));
    for (const k of lowStyles) {
      if (k === tri) continue;
      weak.push(styleChip(k, "ok", `Lowest defence bonus (${def[k]})`, ` <small>low defence</small>`));
    }
    const defence = ["melee", "ranged", "magic"].map((k) => styleChip(k, lowStyles.has(k) ? "ok" : "", `${cap(k)} defence bonus`, ` <small>${def[k] > 0 ? "+" : ""}${num(def[k])}</small>`));
    const resist = (m.equipmentStats ?? []).filter((x) => x.key === "resistance" && x.value).map((x) =>
      chip(`${x.damageType && typeof x.damageType.media === "string" ? icon(x.damageType) : ""}${esc(nm(x.damageType))} <small>${num(x.value)}%</small>`, "", x.value > 0 ? "Damage reduction" : "Takes extra damage"));
    return `<div class="mbd-step"><div class="mbd-stepno">Combat</div>` +
      row("Attacks with", attacks) + row("Special attacks", specials) + row("Passives", passives) +
      row("Weak to", weak) + row("Defence bonus", defence) + row("Resists", resist) + `</div>`;
  };

  // food and equipment sets, so the player can get ready for a fight
  const foodHtml = () => {
    const pl = game.combat?.player;
    const slots = pl?.food?.slots ?? [];
    const foods = slots.map((sl, i) => ({ sl, i })).filter((x) => x.sl.item && x.sl.quantity > 0);
    if (!foods.length) return chip('<i class="fa fa-exclamation-triangle"></i>&nbsp;No food equipped', "warn", "Equip food before fighting");
    return foods.map(({ sl, i }) => chip(`${icon(sl.item)}${esc(nm(sl.item))} <small>&times;${num(sl.quantity)}</small>`, i === pl.food.selectedSlot ? "ok" : "", i === pl.food.selectedSlot ? "Food in use" : "Backup food")).join("");
  };
  let setMsg = "";
  const switchSet = (i) => {
    const pl = game.combat?.player;
    setMsg = "";
    try { pl.changeEquipmentSet(i); } catch (e) { console.warn("[Township Task Helper]", e); }
    if (pl && pl.selectedEquipmentSet !== i) setMsg = "Couldn't switch sets right now (you may be in combat, or the set has a restriction).";
  };
  const setsHtml = () => {
    const pl = game.combat?.player;
    const sets = pl?.equipmentSets ?? [];
    if (!sets.length) return "";
    const sel = pl.selectedEquipmentSet;
    const itemsOf = (st) => (st.equipment?.equippedArray ?? []).filter((x) => !x.isEmpty && x.item);
    const btns = sets.map((st, i) => {
      const names = itemsOf(st).map((x) => nm(x.item)).join(", ") || "Nothing equipped";
      return `<button type="button" class="btn btn-sm ${i === sel ? "btn-primary" : "btn-outline-secondary"}" data-mbd-set="${i}" title="${esc(names)}">${i === sel ? '<i class="fa fa-check mr-1"></i>' : ""}Set ${i + 1}</button>`;
    }).join("");
    const worn = itemsOf(sets[sel] ?? sets[0]);
    return `<div class="mbd-chips">${btns}</div>` +
      `<div class="mbd-chips">${worn.length ? worn.map((x) => chip(`${icon(x.item)}${esc(nm(x.item))}`, "", nm(x.item))).join("") : chip("Nothing equipped in this set")}</div>` +
      (setMsg ? `<div class="mbd-chips">${chip(esc(setMsg), "warn")}</div>` : "");
  };
  const gearSection = () => {
    if (!game.combat?.player) return "";
    return `<div class="mbd-step"><div class="mbd-stepno">Gear</div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">Food</div><div class="mbd-chips mbd-food">${foodHtml()}</div></div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">Equipment sets (click to switch)</div><div class="mbd-sets">${setsHtml()}</div></div></div>`;
  };

  // Fights the queue won't run on its own (auto eat too low, for one) can still go in the queue if you tick the box saying
  // you'll stay and eat yourself. A hit that kills from full HP, or no food at all, can't be fixed that way.
  const Fight = { selfEat: false };
  const fightMethod = (m) => { const id = st().fightId(m); return id ? st().skills.methodById(skillById(HITPOINTS), id) : null; };
  const queueSafety = (m, self = false) => { try { return fightMethod(m)?.safe?.(self ? { selfEat: true } : undefined) ?? { ok: true }; } catch (e) { return { ok: true }; } };
  const selfEatSection = (m) => {
    const s = queueSafety(m);
    if (s.ok) return "";
    const own = queueSafety(m, true);
    if (!own.ok) return `<div class="mbd-step" data-mbd-unsafe><div class="mbd-chips">${chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;The queue can't run this fight: ${esc(own.why)}`, "warn")}</div></div>`;
    return `<div class="mbd-step" data-mbd-unsafe><div class="mbd-chips">${chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;Not safe while you're away: ${esc(s.why)}`, "warn")}</div>` +
      `<label style="display:block;margin:8px 0 2px;cursor:pointer"><input type="checkbox" data-mbd-selfeat${Fight.selfEat ? " checked" : ""}> I'll stay and eat myself during this fight</label>` +
      `<div class="mbd-note">The queue runs it without waiting for auto eat. If you don't eat in time you can die, and dying loses an item.</div></div>`;
  };
  // Add to queue and Add to top stay off until the box is ticked
  const syncFight = (popup) => {
    const need = popup?.querySelector?.("[data-mbd-unsafe]"), box = popup?.querySelector?.("[data-mbd-selfeat]");
    const off = !!need && !box?.checked;
    for (const sel of [".swal2-deny", ".swal2-cancel"]) { const b = popup?.querySelector?.(sel); if (b) { b.disabled = off; b.style.opacity = off ? ".5" : ""; b.title = off ? "Tick the box above to add this fight" : ""; } }
  };
  const monsterSection = (m, kills) => {
    const places = [];
    for (const [key, label] of AREA_KINDS) {
      for (const a of list(game[key])) {
        if ((a.monsters ?? []).includes(m)) {
          const slv = a.slayerLevelRequired ? ` &middot; Slayer Lv ${a.slayerLevelRequired}` : "";
          places.push(`<div class="mbd-place">${icon(a)}<b>${label}:</b> ${esc(nm(a))}${slv}</div>`);
        }
      }
    }
    const chips = [];
    if (m.combatLevel !== undefined) chips.push(chip(`Combat Level: <b>${num(m.combatLevel)}</b>`));
    const hpLvl = m.levels?.Hitpoints;
    if (hpLvl !== undefined) {
      const hp = hpLvl * (typeof numberMultiplier === "number" ? numberMultiplier : 10);
      const hs = skillById("melvorD:Hitpoints");
      chips.push(chip(`${hs ? icon(hs) : '<i class="fa fa-heart text-danger"></i> '}<b>${num(hp)}</b>`, "", "Hitpoints"));
    }
    if (m.isBoss) chips.push(chip('<i class="fa fa-skull"></i> Boss', "warn"));
    return (
      `<div class="mbd-step"><div class="mbd-title" style="font-size:18px">` +
      (typeof m.media === "string" ? `<img src="${esc(m.media)}" style="width:56px;height:56px;object-fit:contain;display:block;margin:0 auto 4px">` : "") +
      `<b>${esc(nm(m))}</b>${kills ? ` &times;${num(kills)}` : ""}</div>` +
      `<div class="mbd-chips">${chips.join("")}</div></div>` +
      combatSection(m) + gearSection() + selfEatSection(m) +
      `<div class="mbd-sec">Location:</div>` +
      (places.length
        ? places.slice(0, 8).join("") + (places.length > 8 ? `<div class="mbd-place">+${places.length - 8} more</div>` : "")
        : `<div class="mbd-place">Not found in any area list (may be event or special content)</div>`)
    );
  };

  const heading = (t) => `<h5 class="font-w600 text-warning mt-3 mb-1">${t}</h5>`;
  // onQueue(top) is called with top=true for "Add to top", false for "Add to queue"
  const buyFromShop = (id, n) => {
    try {
      const p = game.shop.purchases.getObjectByID(id);
      if (!p || !(n > 0)) return;
      const old = game.shop.buyQuantity;
      game.shop.buyQuantity = n;
      try { game.shop.buyItemOnClick(p, true); } finally { game.shop.buyQuantity = old; }
    } catch (e) { console.warn("[Township Task Helper] buy failed", e); }
  };
  const fire = (title, body, onQueue, hooks) => {
    const bodyFn = typeof body === "function" ? body : () => body;
    const res = SwalLocale.fire({
      title,
      html: `<div class="text-center font-size-sm mbd-th-pop">${bodyFn()}</div>`,
      confirmButtonText: "Close",
      showDenyButton: !!onQueue,
      denyButtonText: '<i class="fa fa-play mr-1"></i>Add to queue',
      showCancelButton: !!onQueue,
      cancelButtonText: '<i class="fa fa-arrow-up mr-1"></i>Add to top',
      // same shape and size as the Close button (btn btn-primary m-1), different colours
      customClass: { confirmButton: "btn btn-primary m-1", denyButton: "btn btn-success m-1", cancelButton: "btn btn-warning m-1" },
      didOpen: (popup) => {
        try { hooks?.didOpen?.(popup); } catch (e) { console.warn("[Township Task Helper]", e); }
        const acts = popup?.querySelector?.(".swal2-actions");
        if (acts) Object.assign(acts.style, { display: "flex", justifyContent: "center", alignItems: "center", gap: "5px", flexWrap: "nowrap", margin: "1em auto 0" });
        // order: Add to queue, Add to top, Close
        const ord = { ".swal2-deny": "1", ".swal2-cancel": "2", ".swal2-confirm": "3" };
        const sz = { height: "36px", padding: "0 16px", "font-size": "14px", "line-height": "1", "box-sizing": "border-box", display: "inline-flex", "align-items": "center", "justify-content": "center", "box-shadow": "none", outline: "none", margin: "0" };
        for (const [sel, o] of Object.entries(ord)) {
          const el = popup?.querySelector?.(sel);
          if (!el || (!onQueue && sel !== ".swal2-confirm")) continue;
          el.style.order = o;
          for (const [k, v] of Object.entries(sz)) el.style.setProperty(k, v, "important");
          if (sel === ".swal2-confirm") el.style.setProperty("min-width", "84px", "important");
        }
        syncFight(popup);
        popup?.addEventListener?.("change", (ev) => {
          if (ev.target?.matches?.("[data-mbd-selfeat]")) { Fight.selfEat = ev.target.checked; syncFight(popup); return; }
          const fs = ev.target?.closest?.("[data-mbd-farm]");
          if (fs) {
            Farm.pick[fs.dataset.mbdFarm] = fs.value;
            const pop2 = popup.querySelector(".mbd-th-pop");
            if (pop2) pop2.innerHTML = bodyFn();
            return;
          }
          const s = ev.target?.closest?.("[data-mbd-astro]");
          if (!s) return;
          Astro.pick = s.value;
          const pop = popup.querySelector(".mbd-th-pop");
          if (pop) pop.innerHTML = bodyFn();
        });
        popup?.addEventListener?.("click", (ev) => {
          const wk = ev.target.closest?.("[data-mbd-wiki]");
          if (wk) {
            // always a new tab; never navigate the game's own tab
            ev.preventDefault();
            ev.stopPropagation();
            let w = null;
            try { w = window.open(wk.href, "_blank"); if (w) w.opener = null; } catch (e) { /* blocked */ }
            if (!w) { try { navigator.clipboard.writeText(wk.href); } catch (e) { /* ignore */ } tellPlayer("Your browser blocked the new tab. The wiki link was copied, paste it into a new tab."); }
            return;
          }
          const bb = ev.target.closest?.("[data-mbd-buy]");
          if (bb) {
            ev.preventDefault();
            ev.stopPropagation();
            buyFromShop(bb.dataset.mbdBuy, Number(bb.dataset.n));
            const pop = popup.querySelector(".mbd-th-pop");
            if (pop) pop.innerHTML = bodyFn();
            return;
          }
          const b = ev.target.closest?.("[data-mbd-set]");
          if (!b) return;
          ev.preventDefault();
          ev.stopPropagation();
          switchSet(Number(b.dataset.mbdSet));
          const box = popup.querySelector(".mbd-sets");
          if (box) box.innerHTML = setsHtml();
          const fb = popup.querySelector(".mbd-food");
          if (fb) fb.innerHTML = foodHtml();
        });
      },
      width: 620,
    });
    if (onQueue && res?.then) {
      res.then((r) => {
        try {
          if (r?.isDenied) onQueue(false);
          else if (r?.dismiss === "cancel") onQueue(true);
        } catch (e) { console.warn("[Township Task Helper]", e); }
      });
    }
  };

  // ---------- goal -> popup ----------
  const tellPlayer = (msg) => {
    try { notifyPlayer(game.township ?? game.attack, msg, "info"); } catch (e) { console.log("[Township Task Helper]", msg); }
  };
  // steps go into Action Queue; it skips any that are already queued and says so
  const dupHtml = (entries) => (entries?.length ? aq().queue.dupHtml(entries) : "");
  const queueSteps = (entries, top) => {
    const A = aq(), added = A.queue.add(entries, top, game.township);
    A.panel.open();
    if (added && A.settings.get("autoStart") && A.runner.state !== "running") A.runner.start();
  };
  // an XP task: Action Queue plans the fastest way there, gathering what the methods need, and re-plans as you level up
  const levelForXp = (xp) => { const at = st().skills.xpAt; let l = 1; while (l < 120 && at(l) < xp) l++; return l; };
  const xpEntry = (skill, target) => ({ kind: "train", xpGoal: true, skillId: skill.id, targetXp: target, targetLevel: levelForXp(target), qty: target, label: `${nm(skill)}: reach ${num(target)} XP` });
  const xpSection = (skill, target) => {
    const S = st(), now = skill.xp ?? 0, left = Math.max(0, target - now);
    let html = `<div class="mbd-step"><div class="mbd-title">${icon(skill)}<b>${esc(nm(skill))}</b></div><div class="mbd-chips">` +
      chip(`${num(Math.floor(now))} / ${num(target)} XP`) + (left > 0 ? chip(`${num(Math.ceil(left))} to go`) : chip('<i class="fa fa-check"></i> Done', "ok")) + `</div></div>`;
    if (left <= 0) return html;
    if (!S.skills.isTrainable(skill)) return html + `<div class="mbd-place">The queue can't train ${esc(nm(skill))} on its own.</div>`;
    const plan = S.plan.trainPlan(skill, levelForXp(target)), b = plan.batches[0];
    if (!b) {
      const first = S.plan.goalFirst(skill), why = S.plan.blockedWhy(skill);
      return html + (first ? `<div class="mbd-chips">${chip(esc(first), "ok")}</div>` : `<div class="mbd-place">${why ? `Nothing can be trained right now: ${esc(why)}.` : "Nothing found that the queue can train with your current levels."}</div>`);
    }
    const ms = Math.ceil(left / Math.max(1e-9, b.c.xpPer)) * b.c.ms;
    html += `<div class="mbd-step"><div class="mbd-stepno">Fastest method right now</div><div class="mbd-title">${icon(b.c.a)}<b>${esc(b.c.a.name)}</b></div>` +
      `<div class="mbd-chips">${chip(`Level ${b.c.a.level ?? 1}`)}${chip(`${num(Math.round(b.c.rate))} XP/hour`, "", "Counting the time to gather or make what it needs")}${chip(`About ${fmtDur(ms)}`, "ok", "Base speeds, gathering the materials included")}</div></div>`;
    return html + `<div class="mbd-note">Queued, it gathers what the method needs and picks a better method as you level up, until you reach ${num(target)} XP.</div>`;
  };

  const killEntry = (goal, total) => {
    const m = goal.monster;
    const need = total ? goal.quantity : Math.max(0, goal.quantity - (goal._progress ?? 0));
    if (total ? game.stats.monsterKillCount(m) >= goal.quantity : need <= 0) return [];
    const left = total ? goal.quantity - game.stats.monsterKillCount(m) : need;
    const self = Fight.selfEat && !queueSafety(m).ok;
    return [{ kind: "kill", monsterId: m.id, skillId: HITPOINTS, actionId: st().fightId(m) ?? `fight:none:${m.id}`, qty: left, label: `Defeat ${nm(m)}${self ? " (you eat yourself)" : ""}`, ...(self ? { selfEat: true } : {}) }];
  };
  const describeGoal = (goal) => {
    const type = goal?.constructor?.name;
    if (type === "TownshipItemGoal" && goal.item) {
      return {
        title: `${goal.quantity.toLocaleString()} x ${esc(nm(goal.item))}`,
        body: () => { const miss = itemMissing(goal.item, goal.quantity); return miss.length ? missingHtml(miss) : itemSection(goal.item, goal.quantity); },
        queue: () => (itemMissing(goal.item, goal.quantity).length ? [] : toEntries(buildRows(goal.item, goal.quantity))),
        blocked: () => itemMissing(goal.item, goal.quantity).length > 0 || !buildRows(goal.item, goal.quantity).length,
      };
    }
    if (type === "TownshipSkillXPGoal" && goal.skill) {
      return {
        title: `${esc(nm(goal.skill))}: reach ${goal.quantity.toLocaleString()} XP`,
        body: () => xpSection(goal.skill, goal.quantity),
        queue: () => {
          if ((goal.skill.xp ?? 0) >= goal.quantity) return [];
          return [xpEntry(goal.skill, goal.quantity)];
        },
      };
    }
    if ((type === "TownshipMonsterGoal" || type === "TownshipCasualMonsterGoal") && goal.monster) {
      return {
        title: esc(nm(goal.monster)),
        body: () => { const miss = areaMissing(goal.monster); return (miss.length ? missingHtml(miss) : "") + monsterSection(goal.monster, goal.quantity); },
        queue: () => (areaMissing(goal.monster).length ? [] : killEntry(goal, type === "TownshipMonsterGoal")),
        blocked: () => areaMissing(goal.monster).length > 0,
      };
    }
    if (type === "TownshipMonsterWithItemsGoal" && goal.monster) {
      return {
        title: esc(nm(goal.monster)),
        body: () => {
          const all = [...areaMissing(goal.monster), ...(goal.items ?? []).flatMap((it) => itemMissing(it, 1))];
          return (all.length ? missingHtml(all) : "") + monsterSection(goal.monster, goal.quantity) +
            (all.length ? "" : (goal.items ?? []).map((it) => heading(`Equipment needed: ${esc(nm(it))}`) + itemSection(it, 1)).join(""));
        },
        blocked: () => areaMissing(goal.monster).length > 0 || (goal.items ?? []).some((it) => itemMissing(it, 1).length > 0),
        queue: () => (areaMissing(goal.monster).length || (goal.items ?? []).some((it) => itemMissing(it, 1).length) ? [] : [...(goal.items ?? []).flatMap((it) => toEntries(buildRows(it, 1))), ...killEntry(goal, false)]),
      };
    }
    return null;
  };

  const decorate = (el, goal) => {
    const holder = el.container ?? el;
    holder.querySelector(".mbd-th-btn")?.remove();
    const info = describeGoal(goal);
    if (!info) return;
    // centre the text and the button on one line
    Object.assign(holder.style, { display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "8px" });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mbd-th-btn btn btn-sm btn-success";
    btn.style.cssText = "padding:2px 10px;line-height:1.5;white-space:nowrap;flex:none";
    btn.title = "Show how to get this (and add it to the queue)";
    btn.setAttribute("aria-label", "Show how to get this");
    btn.innerHTML = '<i class="fa fa-play"></i>';
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        Astro.pick = "best"; Farm.pick = {}; Fight.selfEat = false;
        const onQueue = info.queue && !info.blocked?.() ? (top) => queueSteps(info.queue(), top) : null;
        fire(info.title, () => dupHtml(info.queue?.()) + info.body(), onQueue);
      } catch (e) { console.warn("[Township Task Helper]", e); }
    });
    holder.appendChild(btn);
  };

  // ---------- install ----------
  const refresh = () => {
    try {
      const t = game.township.tasks;
      for (const task of list(t.tasks)) t.renderQueue.taskGoals.add(task);
      t.render();
    } catch (e) { console.warn("[Township Task Helper] refresh failed", e); }
  };

  const injectStyle = () => {
    document.getElementById("mbd-th-style")?.remove();
    const st = document.createElement("style");
    st.id = "mbd-th-style";
    st.textContent = `
      .mbd-th-pop{text-align:center}
      .mbd-step{background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.3);border-radius:8px;padding:8px 10px;margin:0 0 8px}
      .mbd-stepno{font-size:12px;font-weight:600;opacity:.7;margin-bottom:2px}
      .mbd-title{font-size:15px;margin:2px 0 6px}
      .mbd-chips{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px;margin-top:4px}
      .mbd-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 9px;border-radius:11px;background:rgba(127,127,127,.22);font-size:12px;line-height:20px}
      .mbd-chip img,.mbd-title img.skill-icon-xs{width:18px;height:18px;margin:0 3px 0 0;vertical-align:middle}
      .mbd-chip.ok{background:rgba(48,199,141,.25);color:#2fb67a}
      .mbd-chip.warn{background:rgba(229,174,103,.25);color:#c98a2b}
      .mbd-chip.lbl{background:transparent;padding-left:0;opacity:.85}
      .mbd-sec{font-weight:600;margin:12px 0 4px;font-size:14px;opacity:.85}
      .mbd-row{margin:8px 0}
      .mbd-rowlbl{font-size:12px;font-weight:600;opacity:.7}
      .mbd-chip>span{display:inline;line-height:20px}
      .mbd-chip small{opacity:.8;font-size:.8em}
      .mbd-sets .btn{margin:0 2px}
      .mbd-place{margin:3px 0;font-size:13px}
      .mbd-place img{width:18px;height:18px;margin-right:4px;vertical-align:middle}
      .mbd-note{margin-top:8px;font-size:12px;opacity:.7}
      .mbd-form{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;align-items:center;text-align:left;margin:0 0 10px}
      .mbd-form label{margin:0;font-size:13px;opacity:.85}
      .mbd-form select,.mbd-form input[type=number]{width:100%}
    `;
    document.head.appendChild(st);
  };

  // Skill Trainer 1.2.0 is the first version that holds the planner and lets other mods add sources
  const verOk = (v, min) => { const a = String(v ?? "0").split(".").map(Number), b = min.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]; } return true; };
  const problems = () => {
    const out = [];
    if (!aq()) out.push("Action Queue");
    if (!st()) out.push("Skill Trainer");
    else if (!verOk(st().version, "1.2.0") || !st().plan || !st().addSource) out.push(`a newer Skill Trainer (you have ${st().version ?? "an old version"}, it needs 1.2.0 or later)`);
    return out;
  };
  let tries = 0;
  const install = () => {
    const missing = problems();
    // the other mods can still be setting up, so give them a few seconds before complaining
    if (missing.length && ++tries < 12) return void setTimeout(install, 1000);
    if (missing.length) {
      let found = {};
      try { found = { actionQueue: aq()?.version ?? null, skillTrainer: st()?.version ?? null, modApi: Object.keys(mod?.api ?? {}), globals: Object.keys(window).filter((k) => /skillTrainer|actionQueue/i.test(k)) }; } catch (e) { /* ignore */ }
      console.warn("[Township Task Helper] missing:", missing.join(", "), found);
      const msg = `Township Task Helper needs ${missing.join(" and ")}. Install or update ${missing.length > 1 ? "them" : "it"} from the Mod Manager, then reload the game.`;
      try { SwalLocale.fire({ title: "Township Task Helper", html: msg, icon: "warning" }); } catch (e) { /* console has it */ }
      return;
    }
    injectStyle();
    const proto = customElements.get("township-task-goal").prototype;
    const orig = proto.__mbdOrig ?? proto.setGoal;
    proto.__mbdOrig = orig;
    proto.setGoal = function (goal) {
      orig.call(this, goal);
      try { decorate(this, goal); } catch (e) { console.warn("[Township Task Helper]", e); }
    };
    // the queue can use what this mod knows about random drops when a recipe step runs short
    st().addSource((item, qty) => dropEntry(item, qty));
    refresh();
    window.townshipHelper = {
      version: VERSION,
      showItem: (id, qty = 1) => {
        Astro.pick = "best"; Farm.pick = {}; Fight.selfEat = false;
        const it = itemById(id);
        const miss = itemMissing(it, qty);
        fire(`${qty} x ${esc(nm(it))}`, () => (itemMissing(it, qty).length ? missingHtml(itemMissing(it, qty)) : dupHtml(toEntries(buildRows(it, qty))) + itemSection(it, qty)), miss.length || !buildRows(it, qty).length ? null : (top) => queueSteps(toEntries(buildRows(it, qty)), top));
      },
      refresh,
      // internals for testing
      _dev: { selfEatSection, queueSafety, itemMissing, areaMissing, buildRows, toEntries, itemSection, sourceHtml, describeGoal, killEntry, xpEntry, xpSection, dropEntry, farmPlan, farmSkills, farmFights, fightSafety, astroOptions, bestCon, isFarmItem, isAstroItem, fire },
    };
    LOG("installed", VERSION);
  };

  const ready = () =>
    typeof game !== "undefined" &&
    list(game?.township?.tasks?.tasks).length > 0 &&
    customElements.get("township-task-goal") &&
    typeof SwalLocale !== "undefined";

  const go = install;
  if (ready()) go();
  else {
    const timer = setInterval(() => { if (ready()) { clearInterval(timer); go(); } }, 500);
  }
})();

  // ======================================================================================================================
  // Old copies of Skill Trainer or Township Task Helper still installed would fight with the parts above, so say so once
  // ======================================================================================================================
  const checkOld = () => {
    const old = [];
    try { if (typeof mod !== "undefined" && mod?.api?.skillTrainer) old.push("Skill Trainer"); } catch (e) { /* no mod api */ }
    try { if (window.townshipHelper && window.townshipHelper.version !== VERSION) old.push("Township Task Helper"); } catch (e) { /* ignore */ }
    if (!old.length) return;
    const msg = `${old.join(" and ")} ${old.length > 1 ? "are" : "is"} part of Action Queue now. Uninstall ${old.length > 1 ? "them" : "it"} from the Mod Manager and reload the game, or things will show up twice.`;
    console.warn("[Action Queue]", msg);
    try { SwalLocale.fire({ title: "Action Queue", html: msg, icon: "warning" }); } catch (e) { /* the console has it */ }
  };
  const oldTimer = setInterval(() => { if (parts.installed) { clearInterval(oldTimer); setTimeout(checkOld, 6000); } }, 1000);
}

// Action Queue: one shared queue for Melvor Idle mods. Mods add steps to it and it runs them one after another while you're
// away. Skill Trainer knows how to train each skill and runs those steps through it; Township Task Helper adds steps too.
export function setup(ctx) {
  const VERSION = "1.2.0", TAG = "[Action Queue]";

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
    remove(id) { this.items = this.items.filter((e) => e.id !== id); this.save(); },
    move(id, dir) { const i = this.pos(id), j = i + dir; if (i >= 0 && j >= 0 && j < this.items.length) { [this.items[i], this.items[j]] = [this.items[j], this.items[i]]; this.save(); } },
    toTop(id) { const i = this.pos(id); if (i > 0) { this.items.unshift(...this.items.splice(i, 1)); this.save(); } },
    clearDone() { this.items = this.items.filter((e) => e.status !== "done"); this.save(); },
    clear() { Runner.stop(); this.items = []; this.save(); },
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
    #aq-queue-panel{position:fixed;right:68px;bottom:16px;width:350px;max-height:70vh;display:none;flex-direction:column;z-index:1050;background:rgba(28,32,41,.98);color:#fff;
      border:1px solid rgba(255,255,255,.15);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:13px}
    .aq-ph{display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);cursor:move;user-select:none;touch-action:none}
    .aq-pf{padding:10px;border-top:1px solid rgba(255,255,255,.12);text-align:center} .aq-btns{display:flex;justify-content:center;gap:6px}
    .aq-bar{position:relative;height:16px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden} .aq-bar>div{height:100%;background:#30c78d;transition:width .8s}
    .aq-bar>span{position:absolute;left:0;right:0;top:0;line-height:16px;font-size:11px;font-weight:600;text-shadow:0 0 3px rgba(0,0,0,.7)}
    #aq-queue-btn{position:relative} .aq-ico{display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;vertical-align:middle}
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
    setTrainer: (t) => { T = t; Panel.last = ""; Panel.render(); },
    get hasTrainer() { return !!T; },
    addAsk: (what, def) => { if (what && def?.target && what !== "buy") ASKS[what] = def; },
    addButton, tell: tellPlayer,
    // for testing
    _dev: { Queue, Runner, Panel, secMemo },
  };
  try { ctx?.api?.(API); } catch (e) { console.warn(TAG, "could not register the mod API", e); }
  window.actionQueue = API;
  const ready = () => typeof game !== "undefined" && list(game?.skills).length > 0 && typeof SwalLocale !== "undefined" && document.getElementById("skill-footer-minibar");
  if (ready()) install();
  else { const timer = setInterval(() => { if (ready()) { clearInterval(timer); install(); } }, 500); }
}

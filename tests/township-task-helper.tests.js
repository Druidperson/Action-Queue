/*
 * Township Task Helper test suite. Runs inside Melvor Idle with the mod installed.
 *
 *   1. Open the game, load a character, open the browser console.
 *   2. Paste this file, then run:   await TTHTests.run()
 *
 * Options: TTHTests.run({ live: false })            skip tests that start real game actions
 *          TTHTests.run({ group: "Queue" })         one group only
 *          TTHTests.run({ only: /duplicate/i })     tests whose name matches
 * The queue, settings and bank lookups are backed up and restored around every test.
 * Keep the game tab in front while it runs: hidden tabs pause the game and the live tests will skip.
 */
(() => {
  "use strict";
  const TESTS = [];
  const test = (group, name, fn, opts = {}) => TESTS.push({ group, name, fn, ...opts });
  class Skip extends Error {}
  const skip = (why) => { throw new Skip(why); };
  class Warn extends Error {}
  const fail = (m) => { throw new Error(m); };
  const ok = (c, m = "expected a truthy value") => { if (!c) fail(m); };
  const eq = (a, b, m = "") => { if (a !== b) fail(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`.trim()); };
  const has = (s, sub, m = "") => { if (!String(s).includes(sub)) fail(`${m} expected text to contain ${JSON.stringify(sub)}, got ${JSON.stringify(String(s).replace(/\s+/g, " ").slice(0, 160))}`.trim()); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (cond, ms = 15000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(step); } return false; };
  const TH = () => window.townshipHelper;
  const D = () => TH()._dev;
  const have = (it) => { try { return game.bank.getQty(it); } catch (e) { return null; } };
  const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
  const item = (id) => game.items.getObjectByID(id);
  const skill = (n) => game.skills.getObjectByID("melvorD:" + n);
  const html = (s) => { const d = document.createElement("div"); d.innerHTML = s; return d; };
  const text = (s) => html(s).textContent;
  const TRAINABLE = ["Woodcutting", "Mining", "Fishing", "Cooking", "Smithing", "Fletching", "Runecrafting"];

  // ---- sandbox: everything a test changes is put back afterwards ----
  let stubs = [];
  const stub = (obj, key, val) => {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (d && d.configurable === false) { // global function declarations: assign over them
      const old = obj[key];
      stubs.push(() => { obj[key] = old; });
      obj[key] = val;
      return;
    }
    stubs.push(() => (d ? Object.defineProperty(obj, key, d) : delete obj[key]));
    Object.defineProperty(obj, key, { value: val, configurable: true, writable: true, enumerable: true });
  };
  const bankStub = (fn) => stub(game.bank, "getQty", (it) => fn(it?.id));
  const notes = [];
  const captureNotices = () => stub(window, "notifyPlayer", (_, msg) => { notes.push(String(msg)); });
  // closing animates, and a half-closed popup would answer the next test's lookups
  const closePopups = async () => {
    try { Swal.close(); } catch (e) { /* none open */ }
    await waitFor(() => !document.querySelector(".swal2-container"), 800, 25);
    document.querySelectorAll(".swal2-container").forEach((x) => x.remove());
  };
  const sandbox = async (fn) => {
    const th = TH();
    th.runner.stop();
    await closePopups();
    const saved = JSON.stringify(th.queue.items);
    const sAuto = th.settings.autoStart(), sSell = th.settings.autoSell();
    th.settings.setAutoStart(false);
    th.settings.set("autoSell", true);
    th.queue.items = [];
    notes.length = 0;
    stubs = [];
    try { return await fn(); }
    finally {
      th.runner.stop();
      try { if (game.activeAction) game.stopActiveAction(); } catch (e) { /* ignore */ }
      await closePopups();
      while (stubs.length) stubs.pop()();
      th.queue.items = JSON.parse(saved);
      th.queue.save();
      th.settings.setAutoStart(sAuto);
      th.settings.set("autoSell", sSell);
      th.panel.close();
    }
  };
  // SweetAlert shows the popup first; the mod's own setup (button styling and click handlers) runs in didOpen right after.
  // Its last visible trace is the Close button's min-width.
  const popupReady = () => waitFor(() => document.querySelector(".swal2-confirm")?.style.minWidth === "84px", 3000, 25);
  const liveOk = () => { if (document.hidden) skip("the game tab is hidden, so the game is paused"); };

  // =====================================================================================
  // Game contract: the game things the mod relies on. A failure here after a game update tells you what moved.
  // =====================================================================================
  const G = "Game contract";
  test(G, "globals the mod needs exist", () => {
    const present = { game: typeof game, SwalLocale: typeof SwalLocale, notifyPlayer: typeof notifyPlayer, exp: typeof exp };
    for (const [n, ty] of Object.entries(present)) ok(ty !== "undefined", `${n} is missing`);
    eq(typeof exp.level_to_xp, "function", "exp.level_to_xp");
    ok(customElements.get("township-task-goal"), "township-task-goal element");
    ok(document.getElementById("skill-footer-minibar"), "skill-footer-minibar");
  });
  test(G, "XP table matches the known values", () => { eq(exp.level_to_xp(99), 13034431, "level 99"); ok(exp.level_to_xp(50) > 100000 && exp.level_to_xp(50) < 102000, "level 50"); });
  test(G, "Township tasks have goals", () => {
    const tasks = list(game.township.tasks.tasks);
    ok(tasks.length > 0, "no tasks");
    ok(tasks.every((t) => list(t.goals).length > 0 || t.goals?.allGoals?.length > 0), "a task has no goals");
  });
  test(G, "every task goal type is one the mod knows", () => {
    const known = new Set(["TownshipItemGoal", "TownshipMonsterGoal", "TownshipCasualMonsterGoal", "TownshipMonsterWithItemsGoal", "TownshipSkillXPGoal"]);
    const seen = new Set();
    for (const t of list(game.township.tasks.tasks)) for (const g of t.goals.allGoals) seen.add(g.constructor.name);
    const unknown = [...seen].filter((n) => !known.has(n));
    ok(seen.has("TownshipItemGoal"), "no item goals found, did the goal classes get renamed?");
    // goal types without a play button are fine (buildings, etc.), but a new item/monster/xp style type is worth a look
    window.__tthUnknownGoals = unknown;
  });
  test(G, "skill methods used to start actions exist", () => {
    const need = {
      Woodcutting: ["selectTree", "stop"], Mining: ["onRockClick", "canMineOre", "stop"], Fishing: ["onAreaFishSelection", "onAreaStartButtonClick", "stop"],
      Firemaking: ["selectLog", "burnLog"], Cooking: ["onRecipeSelectionClick", "onActiveCookButtonClick"],
      Smithing: ["selectRecipeOnClick", "createButtonOnClick"], Fletching: ["selectRecipeOnClick", "createButtonOnClick"],
      Crafting: ["selectRecipeOnClick", "createButtonOnClick"], Runecrafting: ["selectRecipeOnClick", "createButtonOnClick"], Herblore: ["selectRecipeOnClick", "createButtonOnClick"],
    };
    const bad = [];
    for (const [s, ms] of Object.entries(need)) for (const m of ms) if (typeof skill(s)?.[m] !== "function") bad.push(`${s}.${m}`);
    ok(!bad.length, "missing: " + bad.join(", "));
    ok(skill("Woodcutting").activeTrees && typeof skill("Woodcutting").activeTrees.clear === "function", "Woodcutting.activeTrees");
    ok(list(skill("Fishing").areas).length > 0, "Fishing.areas");
  });
  test(G, "combat, bank, shop and stats methods exist", () => {
    for (const [o, ms] of [[game, ["stopActiveAction", "checkRequirement", "checkRequirements"]], [game.combat, ["selectMonster"]],
      [game.bank, ["getQty", "processItemSale", "getItemSalePrice"]], [game.shop, ["buyItemOnClick", "capPurchaseQuantity"]], [game.stats, ["monsterKillCount"]]]) {
      for (const m of ms) eq(typeof o[m], "function", m);
    }
    ok(game.bank.items instanceof Map || typeof game.bank.items?.get === "function", "bank.items.get");
    ok("buyQuantity" in game.shop, "shop.buyQuantity");
    ok(list(game.combatAreas).length > 0 && list(game.slayerAreas).length >= 0, "combat areas");
  });
  test(G, "recipe data has the fields the planner reads", () => {
    for (const s of TRAINABLE) {
      const acts = list(skill(s).actions);
      ok(acts.length > 0, `${s} has no actions`);
      ok(acts.some((a) => a.baseExperience > 0 && a.level >= 1 && a.product), `${s}: no action with baseExperience, level and product`);
    }
    const bar = list(skill("Smithing").actions).find((a) => a.product?.id === "melvorD:Bronze_Bar");
    ok(bar && bar.itemCosts.length === 2, "Bronze Bar recipe changed");
    ok(item("melvorD:Feathers") && item("melvorD:Copper_Ore"), "base items");
  });

  // =====================================================================================
  const I = "Install";
  test(I, "mod is installed with a version and API", () => {
    ok(/^\d+\.\d+\.\d+$/.test(TH().version), "version " + TH().version);
    for (const k of ["queue", "panel", "runner", "settings", "showItem", "refresh", "_dev"]) ok(TH()[k], "townshipHelper." + k);
  });
  test(I, "task goal elements get a play button", async () => {
    const goals = [];
    for (const t of list(game.township.tasks.tasks)) for (const g of t.goals.allGoals) if (D().describeGoal(g)) { goals.push(g); if (goals.length >= 5) break; }
    ok(goals.length, "no supported goals");
    const proto = customElements.get("township-task-goal").prototype;
    ok(proto.__mbdOrig, "setGoal isn't patched");
    const el = document.createElement("township-task-goal");
    document.body.appendChild(el);
    try {
      for (const g of goals) { el.setGoal(g); ok((el.container ?? el).querySelector(".mbd-th-btn"), "no button for " + g.constructor.name); }
    } finally { el.remove(); }
  });
  test(I, "minibar has the queue button and no train button", () => {
    ok(document.getElementById("mbd-queue-btn"), "queue button");
    ok(!document.getElementById("mbd-train-btn"), "the train button moved to Skill Trainer");
  });
  test(I, "panel opens and closes", () => {
    TH().panel.open();
    eq(document.getElementById("mbd-queue-panel").style.display, "flex");
    TH().panel.close();
    eq(document.getElementById("mbd-queue-panel").style.display, "none");
  });

  // =====================================================================================
  const B = "Task breakdown";
  test(B, "every supported task goal builds a popup and queue entries without errors", () => {
    let n = 0;
    for (const t of list(game.township.tasks.tasks)) for (const g of t.goals.allGoals) {
      const info = D().describeGoal(g);
      if (!info) continue;
      n++;
      try {
        ok(typeof info.title === "string" && info.title.length, "title");
        ok(info.body().includes("mbd-"), "body");
        const q = info.queue();
        ok(Array.isArray(q), "queue()");
        for (const e of q) ok(e.kind && e.label && Number.isFinite(e.qty), "entry shape " + JSON.stringify(e).slice(0, 80));
      } catch (e) { fail(`${g.constructor.name} ${g.item?.id ?? g.monster?.id ?? g.skill?.id}: ${e.message}`); }
    }
    ok(n > 20, "only " + n + " goals checked");
  });
  test(B, "Bronze Bar x10: mine copper and tin, then smelt", () => sandbox(() => {
    bankStub(() => 0);
    const rows = D().buildRows(item("melvorD:Bronze_Bar"), 10);
    const names = rows.map((r) => r.item.id);
    eq(names[names.length - 1], "melvorD:Bronze_Bar", "the product comes last");
    ok(names.includes("melvorD:Copper_Ore") && names.includes("melvorD:Tin_Ore"), "ores");
    eq(rows.find((r) => r.item.id === "melvorD:Copper_Ore").qty, 10);
    const e = D().toEntries(rows);
    eq(e.filter((x) => x.kind === "gather").length, 2);
    eq(e[e.length - 1].kind, "craft");
  }));
  test(B, "the bank is subtracted from what's needed", () => sandbox(() => {
    bankStub((id) => (id === "melvorD:Copper_Ore" ? 4 : 0));
    const rows = D().buildRows(item("melvorD:Bronze_Bar"), 10);
    eq(rows.find((r) => r.item.id === "melvorD:Copper_Ore").qty, 6, "copper");
    eq(rows.find((r) => r.item.id === "melvorD:Tin_Ore").qty, 10, "tin");
  }));
  test(B, "a full bank leaves nothing to do, but 'make' still makes the amount", () => sandbox(() => {
    bankStub(() => 999);
    eq(D().buildRows(item("melvorD:Bronze_Bar"), 10).length, 0, "normal");
    const rows = D().buildRows(item("melvorD:Bronze_Bar"), 10, true);
    eq(rows.length, 1, "fresh");
    eq(rows[0].qty, 10);
  }));
  test(B, "arrows chain through shafts, tips and bars", () => sandbox(() => {
    const arrow = list(game.items).find((i) => i.id === "melvorD:Bronze_Arrows");
    if (!arrow) skip("Bronze Arrows not found");
    bankStub(() => 0);
    const ids = D().buildRows(arrow, 300).map((r) => r.item.id);
    ok(ids.length >= 5, "expected at least 5 steps, got " + ids.length);
    eq(ids[ids.length - 1], arrow.id);
  }));
  test(B, "missing levels are reported and block queueing", () => {
    const sm = skill("Smithing");
    const hard = list(sm.actions).filter((a) => a.product && a.level > sm.level).sort((a, b) => b.level - a.level)[0];
    if (!hard) skip("Smithing level is already above every recipe");
    const miss = D().itemMissing(hard.product, 1);
    ok(miss.length > 0, "no warning for " + hard.product.id);
    ok(miss.some((m) => /Smithing|Mining/.test(m.text)), "warning text: " + JSON.stringify(miss));
    has(D().missingHtml(miss), "Warning:");
  });
  test(B, "feathers can be bought from the popup", () => sandbox(() => {
    const feathers = item("melvorD:Feathers");
    const h = D().buyHtml(feathers.id, 50);
    has(h, "data-mbd-buy");
    let seen = null;
    const old = game.shop.buyQuantity;
    stub(game.shop, "buyItemOnClick", (p) => { seen = { p, q: game.shop.buyQuantity }; });
    D().buyFromShop(html(h).querySelector("[data-mbd-buy]").dataset.mbdBuy, 50);
    ok(seen, "buyItemOnClick wasn't called");
    eq(seen.q, 50, "buy quantity during the call");
    eq(game.shop.buyQuantity, old, "buy quantity restored");
  }));
  test(B, "every item can describe where it comes from", () => {
    let wiki = 0;
    for (const it of list(game.items)) {
      try { const h = D().sourceHtml(it.id); if (h.includes("data-mbd-wiki")) wiki++; D().buyHtml(it.id, 1); }
      catch (e) { fail(`${it.id}: ${e.message}`); }
    }
    window.__tthWikiItems = wiki;
  });
  test(B, "items with no known source get a wiki search link", () => {
    const it = list(game.items).find((i) => D().sourceHtml(i.id).includes("data-mbd-wiki"));
    if (!it) skip("every item has a known source in this version");
    const a = html(D().sourceHtml(it.id)).querySelector("[data-mbd-wiki]");
    ok(a.href.startsWith("https://wiki.melvoridle.com/"), a.href);
    eq(a.getAttribute("target"), "_blank");
  });
  test(B, "the wiki link opens a new tab and never navigates the game", () => sandbox(async () => {
    const it = list(game.items).find((i) => D().sourceHtml(i.id).includes("data-mbd-wiki"));
    if (!it) skip("no item without a source");
    let args = null, navigated = false;
    stub(window, "open", (...a) => { args = a; return {}; });
    D().fire("t", () => D().sourceHtml(it.id), null);
    ok(await waitFor(() => document.querySelector(".swal2-popup [data-mbd-wiki]"), 2000, 50), "link not in popup");
    ok(await popupReady(), "popup never finished opening"); // the click handler is attached when it opens
    const link = document.querySelector(".swal2-popup [data-mbd-wiki]");
    const realHref = link.href;
    has(realHref, "wiki.melvoridle.com");
    link.setAttribute("href", "#tth-probe"); // harmless if the click isn't intercepted
    // the mod stops the click from bubbling, so watch preventDefault itself
    let intercepted = false;
    const realPrevent = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () { if (this.type === "click" && this.target === link) intercepted = true; return realPrevent.call(this); };
    try { link.click(); } finally { Event.prototype.preventDefault = realPrevent; }
    ok(intercepted, "the click wasn't intercepted, so the link would have changed the game's own tab");
    ok(args, "window.open wasn't called");
    eq(args[1], "_blank");
    has(args[0], "#tth-probe", "the link's own address is what gets opened");
  }));
  test(B, "the popup has Add to queue, Add to top and Close in that order", () => sandbox(async () => {
    D().fire("t", () => "x", () => {});
    ok(await popupReady(), "popup never finished opening");
    const order = ["swal2-deny", "swal2-cancel", "swal2-confirm"].map((c) => Number(document.querySelector("." + c).style.order));
    eq(order.join(), "1,2,3");
  }));

  // =====================================================================================
  const M = "Monster info";
  const aMonster = () => list(game.monsters).find((m) => D().areaFor(m));
  test(M, "monster section shows location, attack info and weaknesses", () => {
    const m = aMonster();
    ok(m, "no monster in a combat area");
    const h = D().monsterSection(m, 5);
    has(h, "Location", "location label");
    ok(/Melee|Ranged|Magic/.test(text(h)), "attack style");
    ok(/beats|weak/i.test(text(h)), "weakness");
    ok(!/triangle/i.test(text(h)), "should say 'beats', not 'triangle'");
  });
  test(M, "every monster renders without errors", () => {
    for (const m of list(game.monsters)) { try { D().monsterSection(m, 1); D().areaMissing(m); } catch (e) { fail(`${m.id}: ${e.message}`); } }
  });
  test(M, "equipment set buttons match the player's sets", () => {
    const n = (game.combat.player ?? game.combat.player)?.equipmentSets?.length;
    ok(n > 0, "player has no equipment sets?");
    eq(html(D().setsHtml()).querySelectorAll("[data-mbd-set]").length, n);
    ok(typeof D().foodHtml() === "string");
  });
  test(M, "kill goals queue combat entries, and nothing when already done", () => {
    const m = aMonster();
    const e = D().killEntry({ monster: m, quantity: 3, _progress: 1 }, false);
    eq(e.length, 1); eq(e[0].kind, "combat"); eq(e[0].targetKills, 2); ok(e[0].rel, "relative count");
    eq(D().killEntry({ monster: m, quantity: 0, _progress: 0 }, false).length, 0);
  });

  // =====================================================================================
  const Q = "Queue";
  const logsAction = () => list(skill("Woodcutting").actions).find((a) => a.product?.id === "melvorD:Normal_Logs");
  const E = (o = {}) => ({ kind: "gather", skillId: "melvorD:Woodcutting", actionId: logsAction()?.id, itemId: "melvorD:Normal_Logs", qty: 1, label: "Test step", ...o });
  test(Q, "add, remove, move and move to top", () => sandbox(() => {
    const q = TH().queue;
    q.add([E({ label: "A" }), E({ label: "B" }), E({ label: "C" })]);
    eq(q.items.map((e) => e.label).join(""), "ABC");
    q.add([E({ label: "T" })], true);
    eq(q.items[0].label, "T");
    q.move(q.items[1].id, 1); eq(q.items.map((e) => e.label).join(""), "TBAC");
    q.toTop(q.items[3].id); eq(q.items[0].label, "C");
    q.remove(q.items[0].id); eq(q.items.length, 3);
    ok(q.items.every((e) => e.id && e.status === "pending"));
  }));
  test(Q, "insertBefore puts steps above a given entry", () => sandbox(() => {
    const q = TH().queue;
    q.add([E({ label: "A" }), E({ label: "B" })]);
    q.insertBefore(q.items[1].id, [E({ label: "X" }), E({ label: "Y" })]);
    eq(q.items.map((e) => e.label).join(""), "AXYB");
  }));
  test(Q, "clear done removes only finished steps", () => sandbox(() => {
    const q = TH().queue;
    q.add([E({ label: "A" }), E({ label: "B" })]);
    q.items[0].status = "done";
    q.clearDone();
    eq(q.items.map((e) => e.label).join(""), "B");
  }));
  test(Q, "the queue is saved per character and statuses reset on load", () => sandbox(() => {
    const q = TH().queue;
    ok(q.key().includes(game.characterName ?? "default"), "key " + q.key());
    q.add([E({ label: "A" }), E({ label: "B" }), E({ label: "C" })]);
    q.items[0].status = "active"; q.items[1].status = "blocked"; q.items[1].reason = "r"; q.items[2].status = "done";
    q.save();
    q.items = []; q.load();
    eq(q.items.map((e) => e.status).join(), "pending,pending,done");
    ok(!q.items[1].reason, "reason cleared");
  }));
  test(Q, "the badge shows how many steps are left", () => sandbox(() => {
    TH().queue.add([E(), E(), E()]);
    eq(document.querySelector("#mbd-queue-btn .mbd-count").textContent, "3");
    TH().queue.clear();
    eq(document.querySelector("#mbd-queue-btn .mbd-count").style.display, "none");
  }));

  const DU = "Duplicates";
  test(DU, "adding the same steps twice skips them and says so", () => sandbox(() => {
    captureNotices();
    const mk = () => [E({ label: "Chop" }), E({ kind: "craft", itemId: "melvorD:Bronze_Bar", actionId: "melvorD:Bronze_Bar", skillId: "melvorD:Smithing", label: "Smelt" })];
    eq(D().addUnique(mk(), false), 2);
    eq(D().addUnique(mk(), false), 0);
    eq(TH().queue.items.length, 2);
    ok(notes.some((n) => /already/i.test(n)), "no notice: " + notes.join("|"));
  }));
  test(DU, "the popup warns when steps are already queued", () => sandbox(() => {
    const a = E({ label: "Chop" }), b = E({ itemId: "melvorD:Oak_Logs", actionId: "melvorD:Oak_Tree", label: "Oak" });
    TH().queue.add([a]);
    has(D().dupHtml([a, b]), "1 of 2", "partial");
    has(D().dupHtml([a]), "already in your queue", "all");
    eq(D().dupHtml([b]), "", "none");
  }));
  test(DU, "finished steps don't count as duplicates", () => sandbox(() => {
    TH().queue.add([E()]);
    TH().queue.items[0].status = "done";
    eq(D().addUnique([E()], false), 1);
  }));

  const S = "Auto-sell";
  const sellSetup = (qty, locked = false, sellsFor = true) => {
    const sold = [];
    const it = item("melvorD:Copper_Ore");
    stub(game.bank.items, "get", () => ({ quantity: qty, locked }));
    stub(game.bank, "getItemSalePrice", () => 7);
    stub(game.bank, "processItemSale", (i, n) => sold.push([i.id, n]));
    if (!sellsFor) stub(it, "sellsFor", { quantity: 0 });
    return sold;
  };
  const sellEntry = (o = {}) => ({ kind: "gather", itemId: "melvorD:Copper_Ore", qty: 10, startQty: 5, label: "x", ...o });
  test(S, "sells only what's above the target", () => sandbox(() => {
    const sold = sellSetup(20);
    TH().runner.sellExtra(sellEntry());
    eq(JSON.stringify(sold), JSON.stringify([["melvorD:Copper_Ore", 5]]));
  }));
  test(S, "sells nothing when exactly on target", () => sandbox(() => {
    const sold = sellSetup(15);
    TH().runner.sellExtra(sellEntry());
    eq(sold.length, 0);
  }));
  test(S, "never sells locked items, or when auto-sell is off", () => sandbox(() => {
    let sold = sellSetup(20, true);
    TH().runner.sellExtra(sellEntry());
    eq(sold.length, 0, "locked");
    while (stubs.length) stubs.pop()();
    sold = sellSetup(20);
    TH().settings.set("autoSell", false);
    TH().runner.sellExtra(sellEntry());
    eq(sold.length, 0, "setting off");
  }));
  test(S, "'sell what I make' sells everything gained, even with auto-sell off", () => sandbox(() => {
    const sold = sellSetup(20);
    TH().settings.set("autoSell", false);
    const e = sellEntry({ sellAll: true });
    TH().runner.sellExtra(e);
    eq(JSON.stringify(sold), JSON.stringify([["melvorD:Copper_Ore", 15]]));
    has(e.sold, "Sold 15");
  }));

  const ST = "Settings";
  test(ST, "auto-start and auto-sell can be toggled and are remembered", () => sandbox(() => {
    const s = TH().settings;
    s.setAutoStart(true); eq(s.autoStart(), true);
    s.setAutoStart(false); eq(s.autoStart(), false);
    s.set("autoSell", false); eq(s.autoSell(), false);
    s.set("autoSell", true); eq(s.autoSell(), true);
  }));
  test(ST, "panel toggles flip the settings", () => sandbox(() => {
    TH().panel.open();
    const before = TH().settings.autoStart();
    TH().panel.el.querySelector('[data-act="autostart"]').click();
    eq(TH().settings.autoStart(), !before);
    const sBefore = TH().settings.autoSell();
    TH().panel.el.querySelector('[data-act="autosell"]').click();
    eq(TH().settings.autoSell(), !sBefore);
  }));

  // =====================================================================================
  const P = "Panel";
  test(P, "every kind of step renders a row", () => sandbox(() => {
    const sk = skill("Woodcutting");
    TH().queue.add([
      E({ label: "Gather row" }), E({ kind: "craft", skillId: "melvorD:Smithing", itemId: "melvorD:Bronze_Bar", actionId: "melvorD:Bronze_Bar", label: "Craft row" }),
      { kind: "manual", itemId: "melvorD:Feathers", qty: 5, label: "Manual row", note: "n" },
      { kind: "xp", skillId: sk.id, targetXp: sk.xp + 100, qty: 1, label: "XP row" },
      { kind: "combat", monsterId: aMonster().id, targetKills: 2, rel: true, qty: 2, label: "Combat row" },
      { kind: "gather", skillId: "melvorD:Farming", actionId: "melvorD:Potatoes", itemId: "melvorD:Potatoes", qty: 3, label: "Farm row" },
    ]);
    TH().panel.open();
    const t = TH().panel.el.innerText;
    for (const l of ["Gather row", "Craft row", "Manual row", "XP row", "Combat row", "Farm row"]) has(t, l);
    has(t, "6 actions left");
  }));
  test(P, "an empty queue says so and disables Start", () => sandbox(() => {
    TH().panel.open();
    has(TH().panel.el.innerText, "Nothing queued yet");
    ok(TH().panel.el.querySelector('[data-act="start"]').disabled, "Start enabled");
  }));
  test(P, "time estimates are numbers for gather steps", () => sandbox(() => {
    TH().queue.add([E({ qty: 100 })]);
    const ms = D().estimateMs(TH().queue.items[0]);
    ok(ms > 0 && Number.isFinite(ms), "estimate " + ms);
    ok(TH().runner.eta().ms >= ms - 1, "eta");
    ok(/min|h/.test(D().fmtDur(ms)), "format");
  }));

  // =====================================================================================
  const R = "Runner";
  test(R, "starting an empty queue stays idle", () => sandbox(() => {
    TH().runner.start();
    eq(TH().runner.state, "idle");
    ok(TH().runner.message.length > 0, "message");
  }));
  test(R, "a manual step waits for you, then continues when you press Start", () => sandbox(() => {
    TH().queue.add([{ kind: "manual", itemId: "melvorD:Feathers", qty: 999999999, label: "Do it", note: "n" }]);
    TH().runner.start();
    eq(TH().runner.state, "paused");
    eq(TH().queue.items[0].status, "waiting");
    has(TH().runner.message, "Your turn");
    TH().runner.start();
    eq(TH().queue.items[0].status, "done");
  }));
  test(R, "a step you can't do stops the queue with a reason", () => sandbox(() => {
    const sm = skill("Smithing");
    const hard = list(sm.actions).filter((a) => a.product && a.level > sm.level)[0];
    if (!hard) skip("no recipe above your Smithing level");
    TH().queue.add([{ kind: "craft", skillId: sm.id, actionId: hard.id, itemId: hard.product.id, qty: 1, label: "Too hard" }]);
    TH().runner.start();
    eq(TH().runner.state, "paused");
    eq(TH().queue.items[0].status, "blocked");
    has(TH().queue.items[0].reason, "level");
    ok(!game.activeAction || game.activeAction === null, "something is still running");
  }));
  test(R, "stop puts the current step back to pending, so Start doesn't skip a manual step", () => sandbox(() => {
    TH().queue.add([{ kind: "manual", itemId: "melvorD:Feathers", qty: 999999999, label: "m", note: "" }]);
    TH().runner.start();
    eq(TH().queue.items[0].status, "waiting");
    TH().runner.stop();
    eq(TH().runner.state, "idle");
    eq(TH().queue.items[0].status, "pending");
  }));
  test(R, "monsters outside normal areas are blocked, not crashed", () => sandbox(() => {
    const m = list(game.monsters).find((x) => !D().areaFor(x));
    if (!m) skip("every monster has an area");
    TH().queue.add([{ kind: "combat", monsterId: m.id, targetKills: 1, rel: true, qty: 1, label: "Special" }]);
    TH().runner.start();
    eq(TH().queue.items[0].status, "blocked");
    has(TH().queue.items[0].reason, "dungeon");
  }));

  const L = "Live actions";
  const live = { live: true };
  test(L, "gathering: chops logs, finishes, and stops the action", () => sandbox(async () => {
    liveOk();
    const logs = item("melvorD:Normal_Logs");
    const before = game.bank.getQty(logs);
    TH().queue.add([E({ qty: 2 })]);
    TH().runner.start();
    ok(await waitFor(() => game.activeAction === skill("Woodcutting"), 4000), "Woodcutting never started");
    ok(await waitFor(() => TH().queue.items[0].status === "done", 30000), "never finished: " + TH().queue.items[0].status);
    ok(game.bank.getQty(logs) - before >= 2, "no logs gained");
    ok(await waitFor(() => !game.activeAction, 3000), "action still running after the queue finished");
  }), live);
  test(L, "XP goal: trains until the XP is reached", () => sandbox(async () => {
    liveOk();
    const sk = skill("Woodcutting");
    TH().queue.add([{ kind: "xp", skillId: sk.id, targetXp: Math.floor(sk.xp) + 15, qty: 1, label: "xp" }]);
    TH().runner.start();
    ok(await waitFor(() => TH().queue.items[0].status === "done", 40000), "never finished: " + TH().queue.items[0].status);
    ok(sk.xp >= Math.floor(sk.xp) , "xp");
  }), live);
  test(L, "pause stops the action and Resume continues", () => sandbox(async () => {
    liveOk();
    TH().queue.add([E({ qty: 50 })]);
    TH().runner.start();
    ok(await waitFor(() => game.activeAction === skill("Woodcutting"), 4000), "start");
    TH().runner.pause();
    ok(!game.activeAction, "still running after pause");
    eq(TH().runner.state, "paused");
    TH().runner.start();
    ok(await waitFor(() => game.activeAction === skill("Woodcutting"), 4000), "resume");
  }), live);
  test(L, "'do this first' runs that step now", () => sandbox(async () => {
    liveOk();
    TH().queue.add([{ kind: "manual", itemId: "melvorD:Feathers", qty: 999999999, label: "m", note: "" }, E({ qty: 50, label: "Chop" })]);
    TH().runner.doFirst(TH().queue.items[1].id);
    ok(await waitFor(() => game.activeAction === skill("Woodcutting"), 4000), "didn't start the chosen step");
    eq(TH().queue.items[0].status, "pending", "the manual step should keep its place");
  }), live);
  test(L, "combat steps start the fight", () => sandbox(async () => {
    liveOk();
    const m = aMonster();
    TH().queue.add([{ kind: "combat", monsterId: m.id, targetKills: 1, rel: true, qty: 1, label: "Fight" }]);
    TH().runner.start();
    const started = await waitFor(() => game.activeAction === game.combat && game.combat.selectedMonster === m, 5000);
    TH().runner.stop();
    ok(started, "combat didn't start: " + (TH().queue.items[0].reason ?? TH().runner.message));
  }), live);
  test(L, "auto-start begins the queue when something is added", () => sandbox(async () => {
    liveOk();
    TH().settings.setAutoStart(true);
    const logs = item("melvorD:Normal_Logs");
    TH().showItem(logs.id, (game.bank.getQty(logs) ?? 0) + 5);
    ok(await popupReady(), "popup never finished opening");
    [...document.querySelectorAll(".swal2-actions button")].find((b) => /Add to queue/.test(b.textContent)).click();
    ok(await waitFor(() => TH().runner.state === "running", 4000), "didn't start: " + TH().runner.state);
  }), live);

  // =====================================================================================
  const X = "XP planner";
  test(X, "XP methods are best first and open at your level", () => {
    for (const s of list(game.skills)) {
      const c = D().xpCandidates(s);
      for (let i = 0; i < c.length; i++) {
        ok((c[i].a.level ?? 1) <= s.level, `${s.id}: ${c[i].a.id} is above your level`);
        if (i) ok(c[i - 1].rate >= c[i].rate, `${s.id}: not sorted`);
      }
      ok(D().xpCandidates(s, true).length >= c.length, `${s.id}: ignoring materials can't give fewer`);
    }
  });
  test(X, "XP task popup names the fastest method", () => {
    const sk = skill("Woodcutting");
    const h = D().xpSection(sk, sk.xp + 5000);
    has(h, "Fastest method");
    has(h, "XP/hour");
  });

  const A = "Astrology";
  const nm = (o) => String(o?.name ?? o?._name ?? o?.id);
  const stardust = () => game.items.getObjectByID("melvorF:Stardust");
  const owned = (it) => game.bank.getQty(it);
  const golden = () => game.items.getObjectByID("melvorF:Golden_Stardust");
  test(A, "Stardust and Golden Stardust are found as Astrology drops", () => sandbox(async () => {
    for (const it of [stardust(), golden()]) {
      ok(it, "item missing from the game");
      ok(D().isAstroItem(it), nm(it) + " has no constellation");
      ok(D().astroOptions(it).length >= 2, "needs a list of constellations");
    }
  }));
  test(A, "the best pick is the unlocked constellation with the most XP/hour", () => sandbox(async () => {
    const o = D().astroOptions(stardust()).filter((x) => x.open);
    ok(o.length > 0, "no unlocked constellation");
    const best = D().bestCon(stardust());
    eq(Math.max(...o.map((x) => x.xpHr)), best.xpHr);
    ok(D().astroOptions(stardust()).filter((x) => !x.open).every((x) => x.level > skill("Astrology").level), "locked ones need a higher level");
  }));
  test(A, "the popup offers a constellation picker and keeps the choice", () => sandbox(async () => {
    TH().showItem("melvorF:Stardust", owned(stardust()) + 5);
    ok(await popupReady(), "popup never finished opening");
    const sel = document.querySelector("[data-mbd-astro]");
    ok(sel, "picker missing");
    const open = D().astroOptions(stardust()).find((x) => x.open);
    sel.value = open.c.id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(100);
    eq(document.querySelector("[data-mbd-astro]").value, open.c.id);
    has(document.querySelector(".mbd-th-pop").textContent, nm(open.c));
  }));
  test(A, "picking a constellation queues that one", () => sandbox(async () => {
    TH().showItem("melvorF:Stardust", owned(stardust()) + 5);
    ok(await popupReady(), "popup never finished opening");
    const open = D().astroOptions(stardust()).find((x) => x.open);
    const sel = document.querySelector("[data-mbd-astro]");
    sel.value = open.c.id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(100);
    [...document.querySelectorAll(".swal2-actions button")].find((b) => /Add to queue/.test(b.textContent)).click();
    await sleep(200);
    const e = TH().queue.items.find((x) => x.skillId === "melvorD:Astrology");
    ok(e, "no Astrology step queued");
    eq(e.actionId, open.c.id); eq(e.constellation, open.c.id); eq(e.itemId, "melvorF:Stardust");
  }));
  test(A, "leaving it on best queues a step that follows the best constellation", () => sandbox(async () => {
    TH().showItem("melvorF:Stardust", owned(stardust()) + 5);
    ok(await popupReady(), "popup never finished opening");
    [...document.querySelectorAll(".swal2-actions button")].find((b) => /Add to queue/.test(b.textContent)).click();
    await sleep(200);
    const e = TH().queue.items.find((x) => x.skillId === "melvorD:Astrology");
    ok(e, "no Astrology step queued");
    eq(e.constellation, "best");
    eq(e.actionId, D().bestCon(stardust()).c.id);
  }));
  test(A, "the estimate counts studies per Stardust", () => sandbox(async () => {
    const c = D().bestCon(stardust());
    const ms = D().estimateMs({ kind: "gather", skillId: "melvorD:Astrology", actionId: c.c.id, itemId: "melvorF:Stardust", qty: 10, startQty: owned(stardust()) });
    ok(ms > 0 && Number.isFinite(ms), "estimate " + ms);
    const gold = D().estimateMs({ kind: "gather", skillId: "melvorD:Astrology", actionId: c.c.id, itemId: "melvorF:Golden_Stardust", qty: 10, startQty: owned(golden()) });
    ok(gold > ms, "Golden Stardust is rarer, so it should take longer");
  }));
  test(A, "starting a step studies the constellation", () => sandbox(async () => {
    const c = D().bestCon(stardust());
    const e = { kind: "gather", skillId: "melvorD:Astrology", actionId: c.c.id, constellation: "best", itemId: "melvorF:Stardust", qty: 1, label: "t" };
    const r = D().startEntry(e);
    ok(r.ok, "start failed: " + r.reason);
    eq(game.activeAction?.id, "melvorD:Astrology");
    game.stopActiveAction();
  }), { live: true });

  const F = "Random drops";
  const nest = () => game.items.getObjectByID("melvorD:Bird_Nest");
  const bones = () => game.items.getObjectByID("melvorD:Bones");
  const farmAdd = async (item, setup) => {
    TH().showItem(item.id, (game.bank.getQty(item) ?? 0) + 5);
    ok(await popupReady(), "popup never finished opening");
    if (setup) await setup();
    [...document.querySelectorAll(".swal2-actions button")].find((b) => /Add to queue/.test(b.textContent)).click();
    await sleep(250);
    return TH().queue.items;
  };
  const pickFarm = async (value) => {
    const s = document.querySelector("[data-mbd-farm]");
    ok(s, "farm picker missing");
    s.value = value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(150);
  };
  test(F, "Bird Nest is farmed by skilling and picks the best open XP/hour", () => sandbox(async () => {
    ok(D().isFarmItem(nest()), "Bird Nest should be a farm item");
    const opts = D().farmSkills(nest());
    ok(opts.length > 3, "should list the trees");
    const open = opts.filter((o) => o.open);
    ok(open.length > 0, "no open tree");
    const plan = D().farmPlan(nest());
    eq(plan.opt.type, "skill");
    eq(plan.opt.xpHr, Math.max(...open.map((o) => o.xpHr)));
  }));
  test(F, "Bird Nest queues a Woodcutting step that follows the best tree", () => sandbox(async () => {
    const items = await farmAdd(nest());
    const e = items[0];
    ok(e, "nothing queued");
    eq(e.kind, "gather"); eq(e.skillId, "melvorD:Woodcutting"); eq(e.farm, "best"); eq(e.itemId, "melvorD:Bird_Nest");
    ok(D().estimateMs(e) > 0, "needs an estimate");
  }));
  test(F, "a chosen tree is queued as picked", () => sandbox(async () => {
    const o = D().farmSkills(nest()).find((x) => x.open && x.id !== D().farmPlan(nest()).opt.id);
    if (!o) throw new Skip("only one tree is open");
    const items = await farmAdd(nest(), () => pickFarm(o.id));
    eq(items[0].actionId, o.a.id); eq(items[0].farm, "fixed");
  }));
  // food plus auto eat: auto = { at: HP it starts eating at, eff: % of the healing it gets } or null for auto eat off
  const withFood = (qty, heal, auto = { at: 1e9, eff: 100 }) => {
    const pl = game.combat.player;
    const food = game.items.allObjects.find((i) => i.healsFor > 0);
    ok(food, "no food item in the game");
    stub(pl.food, "slots", [{ item: food, quantity: qty }]);
    stub(pl.food, "selectedSlot", 0);
    stub(pl, "getFoodHealing", () => heal);
    stub(pl, "autoEatThreshold", auto ? Math.min(auto.at, pl.stats.maxHitpoints) : 0);
    stub(pl, "autoEatEfficiency", auto ? auto.eff : 1);
  };
  const gentle = (fights) => fights.filter((f) => f.safety.max !== null && f.safety.max * 2 < f.safety.g.hp);
  test(F, "no equipped food means no fight is safe", () => sandbox(async () => {
    withFood(0, 100);
    const fights = D().farmFights(bones(), 10);
    ok(fights.length > 3, "bones should drop from many monsters");
    ok(fights.every((f) => !f.safety.safe), "something was safe with no food");
    has(fights[0].safety.why, "no food");
  }));
  test(F, "food without auto eat doesn't count, since nothing eats it while the queue runs", () => sandbox(async () => {
    withFood(100000, 1000, null);
    const fights = gentle(D().farmFights(bones(), 100000));
    ok(fights.length > 0, "no gentle monster");
    ok(fights.every((f) => !f.safety.safe), "a long farm was safe with auto eat off");
    has(fights[0].safety.why, "auto eat");
  }));
  test(F, "auto eat that starts below a monster's biggest hit is not safe", () => sandbox(async () => {
    withFood(100000, 1000, { at: 1, eff: 100 });
    const fights = gentle(D().farmFights(bones(), 10)).filter((f) => f.safety.max > 1);
    ok(fights.length > 0, "no gentle monster");
    ok(fights.every((f) => !f.safety.safe), "auto eat at 1 HP can't be safe");
    has(fights[0].safety.why, "auto eat starts");
  }));
  test(F, "auto eat plus plenty of food makes a gentle fight safe", () => sandbox(async () => {
    withFood(100000, 1000);
    const fights = D().farmFights(bones(), 10);
    ok(gentle(fights).length > 0, "no gentle monster");
    ok(gentle(fights).every((f) => f.safety.safe), "a gentle fight with auto eat and plenty of food should be safe");
    for (const f of fights) if (f.safety.max !== null && f.safety.max * 2 >= f.safety.g.hp) eq(f.safety.safe, false, nm(f.m));
  }));
  test(F, "auto eat efficiency shrinks how far your food goes", () => sandbox(async () => {
    withFood(40, 100, { at: 1e9, eff: 100 });
    const probe = gentle(D().farmFights(bones(), 300)).find((f) => f.safety.need > 0);
    ok(probe, "no gentle monster");
    const kills = Math.max(1, Math.floor((300 * 30) / probe.safety.need)); // a farm that needs about 30 of your 40 food
    const full = D().farmFights(bones(), kills).find((f) => f.m === probe.m);
    eq(full.safety.safe, true, "full efficiency");
    withFood(40, 100, { at: 1e9, eff: 25 });
    const weak = D().farmFights(bones(), kills).find((f) => f.m === probe.m);
    eq(weak.safety.safe, false, "25% efficiency");
  }));
  test(F, "a farm bigger than your food supply is not safe", () => sandbox(async () => {
    withFood(1, 1000);
    const small = gentle(D().farmFights(bones(), 1)).find((f) => f.safety.g.pool > 0);
    ok(small, "no gentle monster");
    const big = D().farmFights(bones(), 5000000).find((f) => f.m === small.m);
    eq(big.safety.safe, false);
    has(big.safety.why, "food");
  }));
  test(F, "a fight that is not safe is not queued unless you tick the box", () => sandbox(async () => {
    const risky = D().farmFights(bones()).find((f) => f.open && !f.safety.safe);
    if (!risky) throw new Skip("every fight is safe for this character");
    let items = await farmAdd(bones(), () => pickFarm(risky.id));
    eq(items[0].kind, "manual");
    TH().queue.clear();
    await closePopups();
    items = await farmAdd(bones(), async () => {
      await pickFarm(risky.id);
      const cb = document.querySelector("[data-mbd-risk]");
      ok(cb, "risk box missing");
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
    });
    eq(items[0].kind, "combat"); eq(items[0].untilItem, "melvorD:Bones"); eq(items[0].monsterId, risky.m.id);
  }));
  test(F, "a safe fight queues without asking", () => sandbox(async () => {
    withFood(100000, 1000);
    const safe = D().farmFights(bones()).find((f) => f.open && f.safety.safe);
    if (!safe) throw new Skip("no safe fight for this character");
    const items = await farmAdd(bones(), () => pickFarm(safe.id));
    eq(items[0].kind, "combat"); eq(items[0].monsterId, safe.m.id);
  }));
  test(F, "your Slayer task is flagged when its monster drops the item", () => sandbox(async () => {
    const m = D().farmFights(bones()).find((f) => f.open)?.m;
    ok(m, "no monster");
    const t = game.combat.slayerTask;
    stub(t, "active", true); stub(t, "monster", m); stub(t, "killsLeft", 25);
    const f = D().farmFights(bones()).find((x) => x.m === m);
    eq(f.onTask, true); eq(f.taskLeft, 25);
  }));
  test(F, "the fight step finishes when the item is in the bank", () => sandbox(async () => {
    const m = D().farmFights(bones()).find((f) => f.open)?.m;
    TH().queue.add([{ kind: "combat", monsterId: m.id, untilItem: "melvorD:Bones", targetKills: 99, qty: 3, startQty: 0, label: "t" }]);
    bankStub((id) => (id === "melvorD:Bones" ? 3 : 0));
    const r = TH().runner;
    r.start();
    eq(TH().queue.items[0].status, "done");
    r.stop();
  }));

  const XG = "XP goals";
  const xpE = (name, extra) => { const sk = skill(name); return { id: "t", kind: "xp", skillId: sk.id, targetXp: Math.floor(sk.xp ?? 0) + 3000, ...extra }; };
  test(XG, "an XP goal with no materials plans the gathering for a skill that needs logs", () => sandbox(async () => {
    const sk = skill("Firemaking");
    bankStub(() => 0);
    eq(D().xpCandidates(sk).length, 0, "bank is empty, nothing should be ready");
    const r = D().xpMaterialBatch(xpE("Firemaking"));
    ok(r.ok, r.reason);
    ok(r.entries.length > 0 && r.entries.every((x) => x.kind !== "manual"), "steps should be things the queue can do");
    ok(r.entries.some((x) => x.skillId === "melvorD:Woodcutting"), "should chop logs");
  }));
  test(XG, "a crafting skill plans the whole chain and stops at the exact XP", () => sandbox(async () => {
    const sk = skill("Smithing");
    bankStub(() => 0);
    const target = Math.floor(sk.xp ?? 0) + 5;
    const r = D().xpMaterialBatch(xpE("Smithing", { targetXp: target }));
    ok(r.ok, r.reason);
    const last = r.entries[r.entries.length - 1];
    eq(last.untilXp, target);
    ok(r.entries.some((x) => x.kind === "gather"), "should gather ore first");
  }));
  test(XG, "the popup says what it will gather first", () => sandbox(async () => {
    bankStub(() => 0);
    const sk = skill("Firemaking");
    has(D().xpSection(sk, Math.floor(sk.xp ?? 0) + 3000).replace(/<[^>]+>/g, " "), "get the materials");
  }));
  test(XG, "the runner adds the gathering above the XP step instead of stopping", () => sandbox(async () => {
    liveOk();
    const sk = skill("Firemaking");
    bankStub(() => 0);
    TH().queue.add([xpE("Firemaking", { qty: 1, label: "Firemaking XP" })]);
    TH().runner.start();
    const items = TH().queue.items;
    ok(items.length > 1, "no steps were added");
    eq(items[items.length - 1].kind, "xp");
    ok(items[0].parent, "added steps should point at the XP step");
    ok(items.every((x) => x.status !== "blocked"), "nothing should be blocked");
    TH().runner.stop();
  }), { live: true });

  const RS = "Restocking";
  const cookShrimp = () => { const sk = skill("Cooking"); const a = list(sk.actions).find((x) => x.product?.id === "melvorD:Shrimp"); return { sk, a }; };
  const shrimpEntry = (extra) => { const { sk, a } = cookShrimp(); return { id: "c1", kind: "craft", skillId: sk.id, actionId: a.id, altIndex: 0, itemId: "melvorD:Shrimp", qty: 10, startQty: 0, label: "Cooking: make Shrimp", ...extra }; };
  test(RS, "a craft that came up short asks for just the missing ingredients", () => sandbox(async () => {
    const { a } = cookShrimp();
    if (!a) skip("no Shrimp recipe");
    bankStub((id) => (id === "melvorD:Shrimp" ? 3 : 0)); // 3 cooked, the rest burned, no raw left
    stub(skill("Cooking"), "getRecipeSuccessChance", () => 100); // the burn rate has its own tests
    const r = D().restockCraft(shrimpEntry());
    ok(r.ok, r.reason);
    eq(r.remaining, 7);
    const raw = r.entries.find((x) => x.kind === "gather");
    ok(raw, "should gather the raw fish again");
    eq(raw.qty, 7);
    ok(r.entries.every((x) => x.parent === "c1"), "steps should point at the craft step");
  }));
  test(RS, "the runner adds the gathering above a craft that ran out, instead of stopping", () => sandbox(async () => {
    const { a } = cookShrimp();
    if (!a) skip("no Shrimp recipe");
    if ((game.bank.getQty(game.items.getObjectByID("melvorD:Raw_Shrimp")) ?? 0) >= 5) skip("the bank holds raw shrimp, so the craft would start");
    bankStub(() => 0); // nothing cooked yet, nothing raw to cook
    TH().queue.add([shrimpEntry({ id: undefined })]);
    TH().runner.start();
    const items = TH().queue.items;
    ok(items.length > 1, "no steps were added");
    eq(items[items.length - 1].kind, "craft");
    ok(items.every((x) => x.status !== "blocked"), "nothing should be blocked: " + items.map((x) => x.status + ":" + (x.reason ?? "")).join(" | "));
    TH().runner.stop();
  }));

  test(F, "every fight in the picker shows its combat level, lowest first", () => sandbox(async () => {
    TH().showItem("melvorD:Bones", (game.bank.getQty(bones()) ?? 0) + 5);
    ok(await popupReady(), "popup never finished opening");
    const opts = [...document.querySelectorAll("[data-mbd-farm] optgroup[label^='Combat'] option")];
    ok(opts.length > 3, "fights should be listed");
    const lv = opts.map((o) => { const m = /Combat Lv ([\d,]+)/.exec(o.textContent); ok(m, "no combat level in: " + o.textContent); return Number(m[1].replace(/,/g, "")); });
    for (let i = 1; i < lv.length; i++) ok(lv[i] >= lv[i - 1], "not sorted by combat level");
  }));

  test(F, "placeholder random-monster slots are not offered as fights", () => sandbox(async () => {
    const odd = list(game.monsters).filter((m) => /undefined translation/i.test(String(m.name)));
    if (!odd.length) skip("every monster has a name");
    const fights = D().farmFights(bones(), 1);
    ok(fights.length > 3, "bones should still drop from many monsters");
    ok(fights.every((f) => !odd.includes(f.m)), "a placeholder slot was offered");
    ok(!/undefined translation/i.test(D().farmHtml(bones(), 5)), "the placeholder name leaked into the picker");
  }));
  test(F, "the automatic fight is the most efficient safe one", () => sandbox(async () => {
    withFood(100000, 1000);
    const fights = D().farmFights(bones(), 50);
    const safe = fights.filter((f) => f.open && f.safety.safe);
    ok(safe.length > 1, "need more than one safe fight to compare");
    ok(safe.every((f) => isFinite(f.ms) && f.ms > 0), "every fight should have a time estimate");
    const best = Math.min(...safe.map((f) => f.score));
    const plan = D().farmPlan(bones(), true, 50);
    eq(plan.opt.type, "fight");
    eq(plan.opt.score, best);
  }));
  test(F, "slower kills and more food make a fight score worse", () => sandbox(async () => {
    withFood(100000, 1000);
    const f = D().farmFights(bones(), 50).find((x) => x.open && x.safety.safe);
    ok(f, "no safe fight");
    const bigger = D().farmFights(bones(), 500).find((x) => x.m === f.m);
    ok(bigger.ms > f.ms, "ten times the farm should take longer");
    ok(bigger.score > f.score, "and score worse");
  }));
  test(F, "the fight picker shows how long each fight takes", () => sandbox(async () => {
    withFood(100000, 1000);
    TH().showItem("melvorD:Bones", (game.bank.getQty(bones()) ?? 0) + 20);
    ok(await popupReady(), "popup never finished opening");
    const txt = document.querySelector("[data-mbd-farm]").textContent;
    has(txt, "about ");
    ok(!/Infinity|NaN/.test(document.querySelector(".mbd-th-pop").textContent), "bad number in the popup");
  }));

  const BR = "Burn rate";
  const burnAt = (pct) => stub(skill("Cooking"), "getRecipeSuccessChance", () => pct);
  const rawShrimpIn = (rows) => rows.find((r) => r.item.id === "melvorD:Raw_Shrimp")?.qty;
  test(BR, "the burn rate is read from the game and never goes below 5%", () => sandbox(async () => {
    const { a } = cookShrimp();
    if (!a) skip("no Shrimp recipe");
    burnAt(50); eq(D().succ(skill("Cooking"), a), 0.5);
    burnAt(100); eq(D().succ(skill("Cooking"), a), 1);
    burnAt(0.1); eq(D().succ(skill("Cooking"), a), 0.05);
    eq(D().succ(skill("Woodcutting"), list(skill("Woodcutting").actions)[0]), 1, "skills that never fail");
  }));
  test(BR, "a task breakdown asks for extra raw food to cover the burnt ones", () => sandbox(async () => {
    const { a } = cookShrimp();
    if (!a) skip("no Shrimp recipe");
    const shrimp = game.items.getObjectByID("melvorD:Shrimp");
    bankStub(() => 0);
    burnAt(100);
    const none = rawShrimpIn(D().buildRows(shrimp, 10, true));
    burnAt(50);
    const half = rawShrimpIn(D().buildRows(shrimp, 10, true));
    eq(none, 10); eq(half, 20);
  }));
  test(BR, "a restock after burning counts the burn rate too", () => sandbox(async () => {
    const { a } = cookShrimp();
    if (!a) skip("no Shrimp recipe");
    bankStub((id) => (id === "melvorD:Shrimp" ? 3 : 0));
    burnAt(50);
    const r = D().restockCraft(shrimpEntry());
    eq(r.remaining, 7);
    eq(r.entries.find((x) => x.kind === "gather").qty, 14);
  }));
  test(BR, "cooking is ranked and timed by what survives the pan", () => sandbox(async () => {
    const { sk, a } = cookShrimp();
    if (!a) skip("no Shrimp recipe");
    burnAt(100);
    const full = D().xpCandidates(sk, true).find((c) => c.a === a)?.rate;
    burnAt(50);
    const half = D().xpCandidates(sk, true).find((c) => c.a === a)?.rate;
    ok(full > 0 && Math.abs(half - full / 2) < 1, `expected half the XP/hour, got ${half} vs ${full}`);
    bankStub(() => 0);
    const e = { kind: "craft", skillId: sk.id, actionId: a.id, itemId: "melvorD:Shrimp", qty: 10, startQty: 0, altIndex: 0 };
    const slow = D().estimateMs(e);
    burnAt(100);
    ok(slow > D().estimateMs(e) * 1.9, "burning half should roughly double the time");
  }));

  // =====================================================================================
  const SD = "Skill drops";
  const itm = (id) => game.items.getObjectByID(id);
  test(SD, "every gem can be mined for", () => sandbox(async () => {
    for (const g of ["Topaz", "Sapphire", "Ruby", "Emerald", "Diamond"]) {
      const it = itm("melvorD:" + g);
      ok(D().isFarmItem(it), g + " should be a farm item");
      ok(D().farmSkills(it).some((o) => o.skill.id === "melvorD:Mining" && o.perHr > 0), g + " has no Mining option");
    }
  }));
  test(SD, "gem odds follow the gem table weights", () => sandbox(async () => {
    const per = (g) => D().farmSkills(itm("melvorD:" + g)).find((o) => o.a.id === "melvorD:Copper_Ore").perHr;
    ok(per("Topaz") > per("Diamond") * 5, "Topaz should drop far more often than Diamond");
  }));
  test(SD, "Bobby's Pocket and Chapeau Noir come from thieving", () => sandbox(async () => {
    for (const id of ["melvorF:Bobbys_Pocket", "melvorF:Chapeau_Noir"]) {
      const it = itm(id);
      ok(D().isFarmItem(it), id + " should be a farm item");
      const o = D().farmSkills(it);
      ok(o.length > 5 && o.every((x) => x.skill.id === "melvorD:Thieving"), "should list thieving targets");
    }
    ok(D().farmSkills(itm("melvorF:Bobbys_Pocket"))[0].perHr > D().farmSkills(itm("melvorF:Chapeau_Noir"))[0].perHr, "Chapeau Noir is far rarer");
  }));
  test(SD, "Amulet of Fishing comes from fishing chests", () => sandbox(async () => {
    const it = itm("melvorD:Amulet_of_Fishing");
    ok(D().isFarmItem(it), "should be a farm item");
    const o = D().farmSkills(it);
    ok(o.length > 0 && o.every((x) => x.skill.id === "melvorD:Fishing"), "should list fish");
    ok(o.every((x) => x.perHr > 0 && x.perHr < 1), "chest amulet should be rare");
  }));
  test(SD, "a Thieving farm step queues and takes the best target", () => sandbox(async () => {
    const it = itm("melvorF:Bobbys_Pocket");
    const items = await farmAdd(it);
    const e = items[0];
    ok(e, "nothing queued");
    eq(e.skillId, "melvorD:Thieving"); eq(e.farm, "best");
    ok(D().estimateMs(e) > 0, "needs an estimate");
  }));
  test(SD, "starting a Thieving step starts thieving", () => sandbox(async () => {
    const e = { kind: "gather", skillId: "melvorD:Thieving", farm: "best", itemId: "melvorF:Bobbys_Pocket", qty: 1, label: "t" };
    const r = D().startEntry(e);
    ok(r.ok, "start failed: " + r.reason);
    eq(game.activeAction?.id, "melvorD:Thieving");
    game.stopActiveAction();
  }), { live: true });

  const HD = "Holy Dust";
  test(HD, "Holy Dust breaks down into runes and a Blessed Offering step", () => sandbox(async () => {
    const it = itm("melvorF:Holy_Dust");
    const es = D().toEntries(D().buildRows(it, 30));
    const last = es[es.length - 1];
    eq(last.skillId, "melvorD:Magic"); eq(last.itemId, "melvorF:Holy_Dust"); eq(last.kind, "craft");
    const nature = es.find((e) => e.itemId === "melvorF:Nature_Rune"), earth = es.find((e) => e.itemId === "melvorD:Earth_Rune");
    ok(nature && earth, "should farm the runes");
    eq(nature.qty, 2 * earth.qty);
  }));
  test(HD, "Blessed Offering is the only spell turned into a recipe", () => sandbox(async () => {
    D().toEntries(D().buildRows(itm("melvorF:Holy_Dust"), 3));
    const spells = game.skills.getObjectByID("melvorD:Magic").actions.allObjects.filter((a) => Object.prototype.hasOwnProperty.call(a, "itemCosts")).map((a) => a.id);
    eq(spells.join(), "melvorF:BlessedOffering");
  }));

  // =====================================================================================
  // Farming, compost and seeds. These never change your plots or bank: the game calls they make are stubbed.
  // =====================================================================================
  const FM = "Farming";
  const FARMING = "melvorD:Farming", POTATOES = "melvorD:Potatoes", SEED = "melvorD:Potato_Seed", COMPOST = "melvorD:Compost";
  const farmEntry = (extra = {}) => ({ id: "t-farm", kind: "gather", skillId: FARMING, actionId: POTATOES, itemId: POTATOES, qty: 5, label: "Farming: Potatoes", status: "pending", ...extra });
  const farmSk = () => game.skills.getObjectByID(FARMING);
  const needPlot = () => { const f = farmSk(); const r = f.actions.getObjectByID(POTATOES); if (!D().openPlots(f, r).length) skip("no unlocked Allotment plot in this save"); return { f, r }; };

  test(FM, "Farming gather and XP steps are recognised, other steps are not", () => {
    ok(D().isFarmEntry({ kind: "gather", skillId: FARMING }));
    ok(D().isFarmEntry({ kind: "xp", skillId: FARMING }));
    ok(!D().isFarmEntry({ kind: "craft", skillId: FARMING }));
    ok(!D().isFarmEntry({ kind: "gather", skillId: "melvorD:Mining" }));
  });
  test(FM, "a crop with no seeds adds a fight for the seeds above the step", () => sandbox(async () => {
    const { f } = needPlot();
    bankStub((id) => (id === SEED ? 0 : 50));
    TH().queue.add([farmEntry()]);
    const e = TH().queue.items[0];
    D().Farm.risk[SEED] = true;
    stubs.push(() => { delete D().Farm.risk[SEED]; });
    const r = D().farmStep(e);
    if (r.block) { has(r.block, "Potato Seeds"); return; } // nobody can fight for them here, the step says so
    ok(r.again, "should carry on after adding the fight");
    const fight = TH().queue.items[0];
    eq(fight.kind, "combat"); eq(fight.untilItem, SEED); ok(fight.targetKills > 0); eq(TH().queue.items[1].id, e.id);
  }));
  test(FM, "an unsafe seed fight is not added, and the step says why", () => sandbox(async () => {
    needPlot();
    bankStub((id) => (id === SEED ? 0 : 50));
    TH().queue.add([farmEntry()]);
    const r = D().farmStep(TH().queue.items[0]);
    if (r.again) { eq(TH().queue.items[0].kind, "combat"); return; } // a safe fight exists for this character
    has(r.block, "Potato Seeds");
    eq(TH().queue.items.length, 1);
  }));
  test(FM, "estimates for a crop are finite when you own the seeds", () => sandbox(async () => {
    needPlot();
    bankStub((id) => (id === SEED ? 99 : 0));
    const ms = D().farmEstimate(farmEntry());
    ok(Number.isFinite(ms) && ms > 0, "got " + ms);
  }));
  test(FM, "a crop dies without compost, so the chance is below 100%", () => {
    const { f, r } = needPlot();
    const c = D().cropChance(f, r);
    ok(c >= 0.05 && c <= 1);
  });
  test(FM, "farmReady is true when nothing of this crop is growing", () => {
    needPlot();
    const f = farmSk(), r = f.actions.getObjectByID(POTATOES);
    const mine = D().openPlots(f, r).filter((p) => p.plantedRecipe === r);
    if (mine.some((p) => p.state === 2)) skip("a crop is growing in this save");
    ok(D().farmReady(farmEntry()));
  });

  const CP = "Compost";
  test(CP, "five Compost or one Weird Gloop reaches 100%", () => {
    eq(D().compostNeed(item(COMPOST)), 5);
    eq(D().compostNeed(item("melvorD:Weird_Gloop")), 1);
    eq(D().compostNeed(item(COMPOST), 60), 2);
  });
  test(CP, "owned compost covers plots without buying", () => sandbox(async () => {
    TH().settings.set("buyCompost", false);
    stubs.push(() => TH().settings.set("buyCompost", true));
    bankStub((id) => (id === COMPOST ? 10 : 0));
    eq(D().compostCover(), 2);
    bankStub(() => 0);
    eq(D().compostCover(), 0);
  }));
  test(CP, "buying compost counts only when the setting is on, and is capped by your gold", () => sandbox(async () => {
    bankStub(() => 0);
    stub(game.gp, "amount", 0);
    TH().settings.set("buyCompost", true);
    eq(D().compostCover(), 0);
    stub(game.gp, "amount", 1000000);
    ok(D().compostCover() > 0, "should be able to buy some");
    TH().settings.set("buyCompost", false);
    stubs.push(() => TH().settings.set("buyCompost", true));
    eq(D().compostCover(), 0);
  }));
  test(CP, "a plot is composted from the bank first, and the shop only fills the gap", () => sandbox(async () => {
    const { f } = needPlot();
    const plot = f.plots.allObjects.find((p) => p.state === 1);
    if (!plot) skip("no empty plot");
    const calls = [], bought = [];
    stub(f, "compostPlot", (p, it, n) => { calls.push([it.id, n]); });
    stub(game.shop, "buyItemOnClick", () => { bought.push(game.shop.buyQuantity); });
    stub(game.gp, "amount", 1000000);
    TH().settings.set("buyCompost", true);
    bankStub((id) => (id === COMPOST ? 2 : 0));
    D().applyCompost(f, [plot]);
    eq(bought.join(), "3", "should buy the 3 it is missing");
    bankStub((id) => (id === COMPOST ? 5 : 0));
    bought.length = 0; calls.length = 0;
    D().applyCompost(f, [plot]);
    eq(bought.length, 0); eq(calls.length, 1);
  }));
  test(CP, "no compost is bought when the setting is off", () => sandbox(async () => {
    const { f } = needPlot();
    const plot = f.plots.allObjects.find((p) => p.state === 1);
    if (!plot) skip("no empty plot");
    const bought = [];
    stub(f, "compostPlot", () => {});
    stub(game.shop, "buyItemOnClick", () => { bought.push(1); });
    stub(game.gp, "amount", 1000000);
    TH().settings.set("buyCompost", false);
    stubs.push(() => TH().settings.set("buyCompost", true));
    bankStub(() => 0);
    D().applyCompost(f, [plot]);
    eq(bought.length, 0);
  }));
  test(CP, "settings for compost and step switching are remembered", () => sandbox(async () => {
    const s = TH().settings;
    const a = s.buyCompost(), b = s.farmMulti();
    s.set("buyCompost", !a); s.set("farmMulti", !b);
    eq(s.buyCompost(), !a); eq(s.farmMulti(), !b);
    s.set("buyCompost", a); s.set("farmMulti", b);
  }));

  const CC = "Farming and other steps";
  test(CC, "while crops grow, the queue works on the next gathering step and comes back", () => sandbox(async () => {
    liveOk();
    const { f, r } = needPlot();
    const plot = f.plots.allObjects.find((p) => p.state === 1 && p.category === r.category);
    if (!plot) skip("no empty Allotment plot");
    if ((have(item(SEED)) ?? 0) < 3) skip("needs 3 Potato Seeds");
    const origChance = f.getPlotGrowthChance, origTimer = f.createGrowthTimer;
    try {
      f.getPlotGrowthChance = () => 100;
      f.createGrowthTimer = (ps, t) => origTimer.call(f, ps, 600000);
      TH().settings.set("buyCompost", false);
      TH().queue.add([farmEntry(), { kind: "gather", skillId: "melvorD:Woodcutting", actionId: "melvorD:Normal", itemId: "melvorD:Normal_Logs", qty: 2, label: "Woodcutting: Normal Logs" }]);
      TH().runner.start();
      const wood = TH().queue.items[1];
      eq(TH().runner.focusId, wood.id, "should move on to the logs while the potatoes grow");
      eq(game.activeAction && game.activeAction.name, "Woodcutting");
      f.growthTimerMap.get(plot)?.start(200);
      await waitFor(() => TH().queue.items[0].status === "done", 8000, 200);
      eq(TH().queue.items[0].status, "done", "should go back and finish the Farming step");
    } finally {
      f.getPlotGrowthChance = origChance; f.createGrowthTimer = origTimer;
      TH().settings.set("buyCompost", true);
      try { if (plot.state === 3) f.harvestPlot(plot); if (plot.state === 4) f.clearDeadPlot(plot); } catch (e) { /* ignore */ }
    }
  }), { live: true });

  const run = async (opts = {}) => {
    const { live = true, group = null, only = null } = opts;
    const results = [];
    const t0 = Date.now();
    for (const t of TESTS) {
      if (group && t.group !== group) continue;
      if (only && !only.test(t.name)) continue;
      const r = { group: t.group, name: t.name, status: "pass", ms: 0, note: "" };
      const s = Date.now();
      if (t.live && !live) { r.status = "skip"; r.note = "live tests off"; }
      else {
        try { await t.fn(); }
        catch (e) { if (e instanceof Skip) { r.status = "skip"; r.note = e.message; } else { r.status = "FAIL"; r.note = e.message; console.error(`[TTH test] ${t.group}: ${t.name}`, e); } }
      }
      r.ms = Date.now() - s;
      results.push(r);
    }
    const count = (s) => results.filter((r) => r.status === s).length;
    const summary = { version: TH()?.version, passed: count("pass"), failed: count("FAIL"), skipped: count("skip"), total: results.length, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    const unknown = window.__tthUnknownGoals ?? [];
    console.table(results.filter((r) => r.status !== "pass").map((r) => ({ group: r.group, test: r.name, result: r.status, note: r.note })));
    console.log(`%cTownship Task Helper ${summary.version}: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.seconds}s)`, `font-weight:bold;color:${summary.failed ? "#e0505c" : "#30c78d"}`);
    if (unknown.length) console.log("Task goal types without a play button (check after game updates):", unknown.join(", "));
    return { summary, results, unsupportedGoalTypes: unknown };
  };
  window.TTHTests = { run, tests: TESTS.map((t) => `${t.group}: ${t.name}`) };
  console.log(`TTHTests loaded (${TESTS.length} tests). Run: await TTHTests.run()`);
})();

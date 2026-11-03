/*
 * Action Queue test suite (queue, training and Township tasks). Runs inside Melvor Idle with the mod installed.
 *
 *   1. Open the game, load a character, open the browser console.
 *   2. Paste this file, then run:   await AQTests.run()
 *
 * Options: AQTests.run({ live: false })          skip tests that start real game actions
 *          AQTests.run({ group: "Queue" })       one group only
 *          AQTests.run({ only: /duplicate/i })   tests whose name matches
 * Progress is kept in AQTests.last while it runs. Tests that need items (seeds, runes) put them in the bank, and the queue,
 * settings, bank items and GP a test touches are put back afterwards. Made for a test save: some tests heal you or fight. Keep the game tab in front while it runs: hidden tabs pause the game and the live tests will skip.
 */
(() => {
  "use strict";
  const TESTS = [];
  const test = (group, name, fn, opts = {}) => TESTS.push({ group, name, fn, ...opts });
  class Skip extends Error {}
  const skip = (why) => { throw new Skip(why); };
  const fail = (m) => { throw new Error(m); };
  const ok = (c, m = "expected a truthy value") => { if (!c) fail(m); };
  const eq = (a, b, m = "") => { if (a !== b) fail(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`.trim()); };
  const has = (s, sub, m = "") => { if (!String(s).includes(sub)) fail(`${m} expected text to contain ${JSON.stringify(sub)}, got ${JSON.stringify(String(s).replace(/\s+/g, " ").slice(0, 200))}`.trim()); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (cond, ms = 15000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await cond()) return true; } catch (e) { /* keep waiting */ } await sleep(step); } return false; };
  const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
  const item = (id) => game.items.getObjectByID(id);
  const skill = (n) => game.skills.getObjectByID(n.includes(":") ? n : "melvorD:" + n);
  const have = (it) => { try { return game.bank.getQty(typeof it === "string" ? item(it) : it); } catch (e) { return 0; } };
  const text = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent.replace(/\s+/g, " "); };

  const A = () => (typeof mod !== "undefined" && mod?.api?.actionQueue) || window.actionQueue;
  const S = () => window.skillTrainer;
  const T = () => window.townshipHelper;
  const Q = () => A()._dev.Queue;
  const R = () => A()._dev.Runner;
  const SETTINGS = ["autoStart", "autoSell", "autoBuy", "sideJobs", "autoTokens", "autoClear"];

  // ---- sandbox: everything a test changes is put back afterwards ----
  // a popup counts while it's showing, not while it plays its closing animation (which can stall if the tab was hidden)
  const swalOpen = () => { try { return !!SwalLocale.isVisible() && !SwalLocale.getPopup()?.classList.contains("swal2-hide"); } catch (e) { return !!document.querySelector(".swal2-container .swal2-popup:not(.swal2-hide)"); } };
  const closeSwal = async () => { for (let i = 0; i < 5 && swalOpen(); i++) { try { SwalLocale.close(); } catch (e) { /* ignore */ } await sleep(300); } await waitFor(() => !document.querySelector(".swal2-container .swal2-popup:not(.swal2-hide)"), 3000, 100); };
  const openTrain = async () => { await closeSwal(); S().openTrain(); ok(await waitFor(() => $("mst-tr-skill") && /Train a skill/.test(swalTitle()), 4000, 100), "the Train window didn't open"); await sleep(600); /* its fields are wired up once the opening animation ends */ };
  const swalTitle = () => { if (!swalOpen()) return ""; try { return SwalLocale.getTitle()?.textContent ?? ""; } catch (e) { return document.querySelector(".swal2-title")?.textContent ?? ""; } };
  const $ = (id) => { try { return SwalLocale.getPopup()?.querySelector("#" + id) ?? null; } catch (e) { return document.getElementById(id); } };
  const swalButton = (cls) => { try { return SwalLocale.getPopup()?.querySelector(cls); } catch (e) { return document.querySelector(cls); } };
  const trainerLoaded = () => { const h = A().hasTrainer; return typeof h === "function" ? h() : !!h; };
  let bankUndo = [];
  const give = (id, n) => { const it = item(id); ok(it, `no item ${id}`); game.bank.addItem(it, n, false, false, true); bankUndo.push(() => { const q = Math.min(n, have(it)); if (q > 0) game.bank.removeItemQuantity(it, q, false); }); return it; };
  const take = (id, n = have(id)) => { const it = item(id); const q = Math.min(n, have(it)); if (q > 0) { game.bank.removeItemQuantity(it, q, false); bankUndo.push(() => game.bank.addItem(it, q, false, false, true)); } return q; };
  const sandbox = async (fn) => {
    const a = A(), q = Q();
    a.runner.stop();
    const saved = JSON.stringify(q.items), set = Object.fromEntries(SETTINGS.map((k) => [k, a.settings.get(k)]));
    const mastery = S().settings.get("preferMastery"), gp = game.gp.amount, style = game.combat.player.attackStyles?.melee;
    q.items = []; q.save();
    a.settings.set("autoClear", false); // most tests look at finished steps; the ones about clearing turn it on
    bankUndo = [];
    try { await fn(); }
    finally {
      try { a.runner.stop(); } catch (e) { /* ignore */ }
      try { if (game.activeAction) game.stopActiveAction(); } catch (e) { /* ignore */ }
      await closeSwal();
      for (const u of bankUndo.reverse()) { try { u(); } catch (e) { console.warn("[AQ test] undo", e); } }
      bankUndo = [];
      try { const d = gp - game.gp.amount; if (d > 0) game.gp.add(d); } catch (e) { /* ignore */ }
      for (const [k, v] of Object.entries(set)) a.settings.set(k, v);
      S().settings.set("preferMastery", mastery);
      try { if (style && game.combat.player.attackStyles.melee !== style) game.combat.player.setAttackStyle("melee", style); } catch (e) { /* ignore */ }
      q.items = JSON.parse(saved); q.save();
    }
  };
  const liveOk = () => { if (document.hidden) skip("the game tab is hidden, so the game is paused"); };
  const add = (entries, top = false) => A().queue.add(entries, top);
  const items = () => A().queue.items();
  // run the queue until cond() is true or it stops on its own
  const runUntil = async (cond, ms = 20000) => { A().runner.start(); return waitFor(() => cond() || A().runner.state !== "running", ms, 250).then(() => cond()); };
  const firstUnlocked = (sk) => S().skills.makeables(sk).filter((m) => m.level <= sk.level);

  // =================================================================================================================
  const L = "Loading";
  test(L, "the queue, training and Township parts all load as one version", () => {
    ok(A(), "no actionQueue API"); ok(S(), "no skillTrainer API"); ok(T(), "no townshipHelper API");
    eq(S().version, A().version, "training part version"); eq(T().version, A().version, "Township part version");
    ok(Number(A().version.split(".")[0]) >= 2, `expected 2.0.0 or later, got ${A().version}`);
  });
  test(L, "the queue has its trainer and both buttons are in the menu", () => {
    ok(trainerLoaded(), "no trainer registered");
    ok(document.getElementById("aq-queue-btn"), "no queue button"); ok(document.getElementById("mst-train-btn"), "no Train button");
  });
  test(L, "Township goals are wrapped so they get play buttons", () => {
    const proto = customElements.get("township-task-goal")?.prototype;
    ok(proto?.__mbdOrig && proto.setGoal !== proto.__mbdOrig, "setGoal isn't wrapped");
  });
  test(L, "a trainer or ask from another mod can't replace the built-in ones", () => sandbox(async () => {
    const a = A(), oldWarn = console.warn;
    console.warn = () => {};
    try { a.setTrainer({ start: () => ({ ok: false, reason: "fake" }) }); a.addAsk("build", { target: () => null }); } finally { console.warn = oldWarn; }
    ok(trainerLoaded(), "trainer gone");
    // the real build ask is still there: an unknown obstacle blocks with "wasn't found", not "needs the Skill Trainer mod"
    add([{ kind: "ask", what: "build", actionId: "melvorD:NoSuchObstacle", qty: 1, label: "test build" }]);
    a.runner.start(); await sleep(200);
    has(items()[0].reason, "wasn't found");
  }));
  test(L, "every ask kind the training part adds is registered", () => sandbox(async () => {
    for (const what of ["build", "slayer", "map", "equip", "buy", "plot", "travel", "open"]) {
      Q().items = []; Q().save();
      add([{ kind: "ask", what, actionId: "x:none", itemId: "x:none", qty: 1, label: `ask ${what}` }]);
      A().runner.start(); await sleep(150);
      const e = items()[0];
      ok(!/needs the Skill Trainer/i.test(e.reason ?? ""), `${what} isn't registered: ${e.reason}`);
      A().runner.stop();
    }
  }));

  // =================================================================================================================
  const ST = "Settings";
  test(ST, "the queue settings save and read back", () => sandbox(() => {
    for (const k of SETTINGS) { const v = A().settings.get(k); A().settings.set(k, !v); eq(A().settings.get(k), !v, k); A().settings.set(k, v); eq(A().settings.get(k), v, k); }
  }));
  test(ST, "Prefer mastery XP saves and reads back", () => sandbox(() => {
    const v = S().settings.get("preferMastery"); S().settings.set("preferMastery", !v); eq(S().mastery(), !v); S().settings.set("preferMastery", v);
  }));
  test(ST, "the settings show up in the mod settings menu", () => {
    try { const s = mod.getContext("actionQueue").settings; ok(s.section("General").get("autoSell") !== undefined, "General section"); ok(s.section("Training").get("preferMastery") !== undefined, "Training section"); ok(s.section("Township Task Helper").get("noAutoEat") !== undefined, "Township section"); }
    catch (e) { if (/getContext/.test(String(e))) skip("mod.getContext isn't available here"); throw e; }
  });

  // =================================================================================================================
  const QU = "Queue";
  const logStep = (n = 5, extra = {}) => ({ kind: "gather", skillId: "melvorD:Woodcutting", actionId: "melvorD:Normal", itemId: "melvorD:Normal_Logs", qty: n, label: "Woodcutting: gather Normal Logs", ...extra });
  const manual = (id, n, label = "Get it") => ({ kind: "manual", itemId: id, qty: n, label });
  test(QU, "adding steps puts them at the end, or at the top", () => sandbox(() => {
    add([manual("melvorD:Feathers", 1, "a")]); add([manual("melvorD:Bronze_Bar", 1, "b")]); add([manual("melvorD:Iron_Bar", 1, "c")], true);
    eq(items().map((e) => e.label).join(","), "c,a,b");
  }));
  test(QU, "the same step isn't queued twice", () => sandbox(() => {
    eq(add([logStep()]), 1); eq(add([logStep()]), 0, "second add"); eq(items().length, 1);
    has(text(A().queue.dupHtml([logStep()])), "already in your queue");
  }));
  test(QU, "a partly duplicate plan only adds the new steps", () => sandbox(() => {
    add([logStep()]);
    has(text(A().queue.dupHtml([logStep(), manual("melvorD:Feathers", 1)])), "1 of 2 steps");
    eq(add([logStep(), manual("melvorD:Feathers", 1)]), 1); eq(items().length, 2);
  }));
  test(QU, "steps move up, down, to the top and get removed", () => sandbox(() => {
    add([manual("melvorD:Feathers", 1, "a"), manual("melvorD:Bronze_Bar", 1, "b"), manual("melvorD:Iron_Bar", 1, "c")]);
    const [a, b, c] = items(); Q().move(c.id, -1); eq(items().map((e) => e.label).join(""), "acb");
    Q().toTop(b.id); eq(items().map((e) => e.label).join(""), "bac");
    Q().move(b.id, 1); eq(items().map((e) => e.label).join(""), "abc");
    A().queue.remove(a.id); eq(items().map((e) => e.label).join(""), "bc");
  }));
  test(QU, "Clear Queue removes finished steps and Clear All empties it", () => sandbox(() => {
    add([manual("melvorD:Feathers", 1, "a"), manual("melvorD:Bronze_Bar", 1, "b")]);
    items()[0].status = "done"; Q().clearDone(); eq(items().length, 1); Q().clear(); eq(items().length, 0);
  }));
  test(QU, "the queue is saved per character and steps in progress come back as pending", () => sandbox(() => {
    add([manual("melvorD:Feathers", 1, "a")]);
    const key = Q().key(); has(key, game.characterName);
    const raw = JSON.parse(localStorage.getItem(key)); eq(raw.length, 1); eq(raw[0].label, "a");
    items()[0].status = "active"; items()[0].reason = "x"; Q().save(); Q().load();
    eq(items()[0].status, "pending"); eq(items()[0].reason, undefined);
  }));
  test(QU, "the menu button shows how many steps are left", () => sandbox(() => {
    add([manual("melvorD:Feathers", 1, "a"), manual("melvorD:Bronze_Bar", 1, "b")]);
    eq(document.querySelector("#aq-queue-btn .aq-count")?.textContent, "2");
    items()[0].status = "done"; Q().save(); eq(document.querySelector("#aq-queue-btn .aq-count")?.textContent, "1");
  }));
  test(QU, "unknown step kinds in a saved queue are dropped when it loads", () => sandbox(() => {
    localStorage.setItem(Q().key(), JSON.stringify([{ id: "x", kind: "nonsense", label: "bad", status: "pending" }, { id: "y", kind: "manual", itemId: "melvorD:Feathers", qty: 1, label: "good", status: "pending" }]));
    Q().load(); eq(items().map((e) => e.label).join(","), "good");
  }));

  // =================================================================================================================
  const RU = "Runner";
  test(RU, "a step you do yourself waits for you, then finishes when you have the item", () => sandbox(async () => {
    const feathers = "melvorD:Feathers", need = have(feathers) + 2;
    add([manual(feathers, need, "Get Feathers")]);
    A().runner.start(); await sleep(150);
    eq(items()[0].status, "waiting"); eq(A().runner.state, "paused"); has(R().message, "Your turn");
    give(feathers, 2); A().runner.start(); await sleep(150);
    eq(items()[0].status, "done");
  }));
  test(RU, "with Clear finished steps on, a done step leaves the queue and the rest stay", () => sandbox(async () => {
    A().settings.set("autoClear", true);
    const feathers = "melvorD:Feathers", need = have(feathers) + 2;
    add([manual(feathers, need, "Get Feathers"), manual("melvorD:Normal_Logs", have("melvorD:Normal_Logs") + 1000, "Get lots of logs")]);
    give(feathers, 2); A().runner.start(); await sleep(200);
    eq(items().map((e) => e.label).join(","), "Get lots of logs", "left in the queue:");
  }));
  test(RU, "clearing keeps a running goal's switch-gear step, and drops it once the goal is done", () => sandbox(() => {
    A().settings.set("autoClear", true);
    const q = Q();
    q.items = [
      { id: "s1", kind: "ask", what: "equip", parent: "g1", status: "done", label: "Switch to equipment set 2" },
      { id: "b1", kind: "skill", parent: "g1", status: "done", label: "a finished batch" },
      { id: "g1", kind: "train", skillId: "melvorD:Attack", status: "pending", label: "Attack goal" },
      { id: "x1", kind: "manual", status: "done", label: "something else that's done" },
    ];
    q.autoClear();
    eq(q.items.map((e) => e.id).join(","), "s1,g1", "kept:");
    q.items.find((e) => e.id === "g1").status = "done"; q.autoClear();
    eq(q.items.length, 0, "left after the goal is done:");
    // and nothing is cleared with the setting off
    A().settings.set("autoClear", false);
    q.items = [{ id: "x2", kind: "manual", status: "done", label: "done" }]; q.autoClear();
    eq(q.items.length, 1, "with it off:");
    q.items = []; q.save();
  }));
  test(RU, "an empty queue says so instead of starting",() => sandbox(() => { A().runner.start(); eq(A().runner.state, "idle"); has(R().message, "Nothing to run"); }));
  test(RU, "a gather step runs until it has enough, then the queue finishes", () => sandbox(async () => {
    liveOk(); A().settings.set("autoSell", false);
    add([logStep(2)]);
    const done = await runUntil(() => items()[0].status === "done", 25000);
    ok(done, `step didn't finish: ${items()[0].status} ${items()[0].reason ?? R().message}`);
    await sleep(1300); eq(A().runner.state, "idle", "queue state"); has(R().message, "finished");
  }), { live: true });
  test(RU, "auto-sell sells what a step made beyond what it needed", () => sandbox(async () => {
    liveOk(); A().settings.set("autoSell", true);
    add([logStep(1)]);
    // start the step, then pretend it made 3 more than asked
    A().runner.start(); await sleep(300);
    const e = items()[0]; ok(e.startQty !== undefined, "step didn't start");
    give("melvorD:Normal_Logs", 4); bankUndo.pop(); // these get sold, nothing to put back
    await waitFor(() => e.status === "done", 8000);
    // at least the 3 it was given; more if the woodcutting cut another log before the step saw it was done
    eq(e.status, "done"); const n = Number(/Sold (\d+) extra/.exec(e.sold ?? "")?.[1]); ok(n >= 3, `sold: ${e.sold}`);
  }), { live: true });
  test(RU, "auto-sell never touches what you owned before", () => sandbox(async () => {
    liveOk(); A().settings.set("autoSell", true);
    const before = give("melvorD:Normal_Logs", 5) && have("melvorD:Normal_Logs");
    add([logStep(1)]);
    A().runner.start(); await sleep(300);
    give("melvorD:Normal_Logs", 1); bankUndo.pop();
    await waitFor(() => items()[0].status === "done", 8000);
    ok(have("melvorD:Normal_Logs") >= before, `owned logs were sold: had ${before}, now ${have("melvorD:Normal_Logs")}`);
  }), { live: true });
  test(RU, "after Stop and Start, a sell-everything step still sells what it made before the Stop", () => sandbox(async () => {
    liveOk(); A().settings.set("autoSell", false);
    const logs = item("melvorD:Normal_Logs"), mine = have(logs);
    add([logStep(3, { sellAll: true })]);
    A().runner.start(); await waitFor(() => have(logs) >= mine + 1, 15000);
    A().runner.stop(); await sleep(300);
    eq(items()[0].base, mine, "remembered what you had");
    A().runner.start(); await waitFor(() => items()[0].status === "done", 20000);
    eq(items()[0].status, "done", items()[0].reason ?? R().message);
    eq(have(logs), mine, "logs made before the Stop weren't sold");
  }), { live: true });
  test(RU, "a finished goal set to sell sells what's left of what its steps made, and nothing you had before", () => sandbox(async () => {
    const bar = item("melvorD:Iron_Bar"), ore = item("melvorD:Iron_Ore");
    give(bar.id, 5); const mineBars = have(bar), mineOre = have(ore);
    const goal = { id: "g1", kind: "train", skillId: "melvorD:Smithing", sellMade: true, made: { [bar.id]: mineBars, [ore.id]: mineOre }, label: "sell test" };
    // the goal's steps left 7 bars and 3 ore over
    game.bank.addItem(bar, 7, false, false, true); game.bank.addItem(ore, 3, false, false, true);
    R().sellLeftovers(goal);
    eq(have(bar), mineBars, "bars:"); eq(have(ore), mineOre, "ore:"); has(goal.sold ?? "", "Sold 10 left over");
    // a goal without the setting leaves things alone
    game.bank.addItem(bar, 2, false, false, true); bankUndo.push(() => game.bank.removeItemQuantity(bar, 2, false));
    R().sellLeftovers({ ...goal, sellMade: false, sold: undefined }); eq(have(bar), mineBars + 2);
  }));
  test(RU, "a craft step uses what's in the bank", () => sandbox(async () => {
    liveOk();
    give("melvorD:Copper_Ore", 2); give("melvorD:Tin_Ore", 2);
    const bars = have("melvorD:Bronze_Bar");
    bankUndo.push(() => { const q = have("melvorD:Bronze_Bar") - bars; if (q > 0) game.bank.removeItemQuantity(item("melvorD:Bronze_Bar"), q, false); });
    add([{ kind: "craft", skillId: "melvorD:Smithing", actionId: "melvorD:Bronze_Bar", itemId: "melvorD:Bronze_Bar", qty: 2, label: "Smithing: make Bronze Bar" }]);
    const done = await runUntil(() => items()[0].status === "done", 20000);
    ok(done, `${items()[0].status} ${items()[0].reason ?? R().message}`);
  }), { live: true });
  test(RU, "a craft step that runs out of materials goes back and gets them", () => sandbox(async () => {
    liveOk();
    take("melvorD:Copper_Ore"); take("melvorD:Tin_Ore");
    add([{ kind: "craft", skillId: "melvorD:Smithing", actionId: "melvorD:Bronze_Bar", itemId: "melvorD:Bronze_Bar", qty: 1, label: "Smithing: make Bronze Bar" }]);
    A().runner.start(); await sleep(600);
    const kinds = items().map((e) => `${e.kind}:${e.itemId}`);
    ok(items().length > 1, `no restock steps were added: ${kinds} ${items()[0].reason ?? R().message}`);
    ok(kinds.some((k) => /Copper_Ore|Tin_Ore/.test(k)), `restock doesn't get ore: ${kinds}`);
  }), { live: true });
  test(RU, "a level goal plans steps above itself and finishes at the target", () => sandbox(async () => {
    liveOk();
    const wc = skill("Woodcutting"), target = Math.floor(wc.xp) + 25;
    add([{ kind: "train", skillId: wc.id, targetLevel: wc.level + 1, targetXp: target, qty: target, label: "Woodcutting: +25 XP" }]);
    A().runner.start(); await sleep(500);
    ok(items().length > 1, `no steps planned: ${items()[0].reason ?? R().message}`);
    eq(items()[items().length - 1].kind, "train", "goal stays at the bottom");
    const done = await waitFor(() => items().find((e) => e.kind === "train")?.status === "done", 30000, 300);
    ok(done, `goal didn't finish: ${R().message}`);
  }), { live: true });
  test(RU, "Stop puts the active step back to pending and stops the game action", () => sandbox(async () => {
    liveOk(); add([logStep(50)]); A().runner.start(); await sleep(800);
    eq(items()[0].status, "active"); ok(game.activeAction, "nothing running");
    A().runner.stop(); await sleep(200);
    eq(items()[0].status, "pending"); eq(game.activeAction, undefined, "game action"); eq(A().runner.state, "idle");
  }), { live: true });
  test(RU, "Pause stops the action and Start picks it back up", () => sandbox(async () => {
    liveOk(); add([logStep(50)]); A().runner.start(); await sleep(800);
    A().runner.pause(); await sleep(200);
    eq(A().runner.state, "paused"); ok(!game.activeAction, "still running");
    A().runner.start(); await sleep(800); ok(game.activeAction?.id === "melvorD:Woodcutting", "didn't restart");
  }), { live: true });
  test(RU, "Do this first runs a later step without moving it", () => sandbox(async () => {
    liveOk(); add([manual("melvorD:Iron_Bar", have("melvorD:Iron_Bar") + 999, "manual first"), logStep(50)]);
    const log = items()[1]; R().doFirst(log.id); await sleep(800);
    eq(items()[1].id, log.id, "step moved"); eq(log.status, "active"); eq(game.activeAction?.id, "melvorD:Woodcutting");
  }), { live: true });
  test(RU, "starting something yourself pauses the queue and leaves it running", () => sandbox(async () => {
    liveOk(); add([logStep(50)]); A().runner.start(); await sleep(800);
    const mining = skill("Mining"), rock = list(mining.actions).find((a) => a.id === "melvorD:Copper_Ore");
    mining.onRockClick(rock); await sleep(1600);
    eq(A().runner.state, "paused"); has(R().message, "something else"); eq(game.activeAction, mining, "your action was stopped");
  }), { live: true });
  test(RU, "the panel shows a time estimate for queued steps", () => sandbox(() => {
    add([logStep(10)]); const eta = R().eta(); ok(eta.ms > 0 && isFinite(eta.ms), `eta ${JSON.stringify(eta)}`);
  }));

  // =================================================================================================================
  const AS = "Asking first";
  test(AS, "a shop buy asks first, and Skip turns it into a step you do yourself", () => sandbox(async () => {
    A().settings.set("autoBuy", false);
    const it = "melvorD:Feathers";
    add([{ kind: "ask", what: "buy", itemId: it, qty: have(it) + 10, label: "Buy Feathers" }]);
    A().runner.start(); await waitFor(swalOpen, 3000);
    has(swalTitle(), "Buy from the shop");
    eq(A().runner.state, "paused");
    swalButton(".swal2-cancel").click(); await sleep(600);
    eq(items()[0].kind, "manual", "skip should make it manual");
  }));
  test(AS, "with auto-buy on, the shop buy happens without asking", () => sandbox(async () => {
    A().settings.set("autoBuy", true);
    const it = "melvorD:Feathers", before = have(it);
    add([{ kind: "ask", what: "buy", itemId: it, qty: before + 10, label: "Buy Feathers" }]);
    A().runner.start(); await sleep(400);
    ok(!swalOpen(), "it asked anyway");
    eq(items()[0].status, "done", items()[0].reason ?? R().message); ok(have(it) >= before + 10, "nothing bought");
    bankUndo.push(() => { const q = have(it) - before; if (q > 0) game.bank.removeItemQuantity(item(it), q, false); });
  }));
  test(AS, "an optional buy that's skipped just carries on", () => sandbox(async () => {
    A().settings.set("autoBuy", false);
    add([{ kind: "ask", what: "buy", itemId: "melvorD:Compost", qty: have("melvorD:Compost") + 5, optional: true, skipFlag: "noCompost", label: "Buy Compost" }]);
    A().runner.start(); await waitFor(swalOpen, 3000);
    swalButton(".swal2-cancel").click(); await sleep(600);
    eq(items()[0].status, "done"); eq(items()[0].sold, "Skipped");
  }));
  test(AS, "the Agility builder asks before building, and Skip spends nothing", () => sandbox(async () => {
    // a full course is hidden from the builder for the test only (in memory), so there's always a slot to offer
    const built = game.agility.activeCourse.builtObstacles, saved = [...built.entries()];
    try {
      built.clear();
      const picks = S().plan.agilityPicks();
      if (!picks.length) skip("no Agility obstacle you can build");
      add(S().plan.buildSteps(picks.slice(0, 1)));
      const gp = game.gp.amount;
      A().runner.start(); await waitFor(() => /Agility obstacle/.test(swalTitle()), 4000, 100); await sleep(500);
      has(swalTitle(), "Build an Agility obstacle"); has(SwalLocale.getPopup().textContent, "can't be undone");
      swalButton(".swal2-cancel").click(); await sleep(800);
      eq(items()[0].sold, "Skipped"); eq(game.gp.amount, gp, "GP spent"); eq(built.size, 0, "something was built");
    } finally { for (const [k, v] of saved) built.set(k, v); }
  }));

  // =================================================================================================================
  const TR = "Training";
  const trainable = () => S().skills.list().filter((s) => S().skills.isTrainable(s));
  test(TR, "every trainable skill has methods", () => {
    const none = trainable().filter((s) => !S().skills.methodsOf(s).length).map((s) => s.name);
    eq(none.join(", "), "", "skills with no methods:");
  });
  test(TR, "every skill can plan the next level, or says why not", () => {
    const bad = [];
    for (const sk of trainable()) {
      const cap = S().skills.levelCap(sk); if (sk.level >= cap) continue;
      try {
        const plan = S().plan.trainPlan(sk, sk.level + 1, null);
        if (!plan.batches.length && !S().plan.blockedWhy(sk) && !S().plan.goalFirst(sk) && !(sk.id === "melvorD:Agility" && S().plan.agilityPicks().length)) bad.push(`${sk.name}: no plan and no reason`);
      } catch (e) { bad.push(`${sk.name}: ${e.message}`); }
    }
    eq(bad.join("; "), "");
  });
  test(TR, "planning ten levels ahead works for every skill", () => {
    const bad = [];
    for (const sk of trainable()) {
      const L = Math.min(S().skills.levelCap(sk), sk.level + 10); if (L <= sk.level) continue;
      try { const p = S().plan.trainPlan(sk, L, null); if (p.batches.length && !(p.totalMs > 0) && p.blocked == null) bad.push(`${sk.name}: no time`); }
      catch (e) { bad.push(`${sk.name}: ${e.message}`); }
    }
    eq(bad.join("; "), "");
  });
  test(TR, "every item you can make plans out, or says what's missing", () => {
    const bad = [];
    for (const sk of trainable()) for (const m of firstUnlocked(sk).slice(-3)) {
      try {
        const miss = S().plan.itemMissing(m.product, 5);
        if (miss.length) continue;
        const rows = S().plan.buildRows(m.product, have(m.product) + 5);
        if (!S().plan.toEntries(rows).length) bad.push(`${sk.name}: ${m.product.name} gave no steps`);
      } catch (e) { bad.push(`${sk.name}: ${m.product?.name}: ${e.message}`); }
    }
    eq(bad.join("; "), "");
  });
  test(TR, "XP and levels line up", () => {
    const { xpAt, levelIn } = S().skills;
    for (const L of [2, 10, 50, 99]) { ok(xpAt(L) > xpAt(L - 1), `xpAt ${L}`); }
    eq(xpAt(1), 0);
    ok(typeof levelIn === "function");
  });
  test(TR, "combat skills find a safe fight or say why not", () => {
    const bad = [];
    for (const id of ["Attack", "Strength", "Defence", "Hitpoints", "Ranged", "Magic", "Prayer", "Slayer"]) {
      const sk = skill(id);
      try { const c = S().plan.trainCands(sk); if (!c.length && !S().plan.blockedWhy(sk) && !S().plan.goalFirst(sk)) bad.push(`${id}: no fight and no reason`); }
      catch (e) { bad.push(`${id}: ${e.message}`); }
    }
    eq(bad.join("; "), "");
  });
  test(TR, "Ranged with no bow on switches to the set that has one, or waits", () => sandbox(() => {
    const sk = skill("Ranged");
    const plan = S().plan.trainPlan(sk, sk.level + 1, null);
    if (!plan.batches.length) { ok(S().plan.blockedWhy(sk) || S().plan.goalFirst(sk), "no plan and no reason"); return; }
    const b = plan.batches[0]; ok(b.c.a, "no method");
  }));
  test(TR, "a fight step is built the way the queue expects", () => {
    const cow = game.monsters.getObjectByID("melvorD:Cow"); ok(cow, "no Cow");
    const id = S().fightId(cow); ok(/^fight:.+:melvorD:Cow$/.test(id), `fightId ${id}`);
  });
  test(TR, "the Train window opens, previews every skill, and adds a goal", () => sandbox(async () => {
    await openTrain();
    const sel = $("mst-tr-skill"); ok(sel, "no skill picker");
    const bad = [];
    for (const o of [...sel.options]) {
      const s = $("mst-tr-skill"); s.value = o.value;
      const t0 = performance.now(); s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(0); const dt = performance.now() - t0;
      await sleep(120); const prev = $("mst-tr-prev")?.textContent ?? "";
      if (!prev.trim()) bad.push(`${o.textContent}: empty preview`);
      if (dt > 1000) bad.push(`${o.textContent}: took ${Math.round(dt)} ms to show`);
    }
    eq(bad.join("; "), "", "previews:");
    // pick Woodcutting and add it
    const s = $("mst-tr-skill"); s.value = "melvorD:Woodcutting"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    swalButton(".swal2-deny").click();
    await waitFor(() => items().some((e) => e.kind === "train"), 4000, 100);
    const goal = items().find((e) => e.kind === "train" && e.skillId === "melvorD:Woodcutting"); ok(goal, "no goal was added");
    has(goal.label, "Woodcutting: reach level");
  }));
  const stubSmith = async (over, fn) => {
    const sm = game.smithing, saved = Object.fromEntries(Object.keys(over).map((k) => [k, Object.getOwnPropertyDescriptor(sm, k)]));
    try { for (const [k, f] of Object.entries(over)) sm[k] = f(sm[k].bind(sm)); S()._dev.secMemo.m.clear(); await fn(sm); }
    finally { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(sm, k, d); else delete sm[k]; } S()._dev.secMemo.m.clear(); }
  };
  const ironBars = (rows) => rows.find((r) => r.item.id === "melvorD:Iron_Bar")?.qty ?? 0;
  test(TR, "the chance to keep materials means fewer bars get planned, in both windows", () => stubSmith({ getPreservationChance: (o) => (a) => (a?.product?.id === "melvorD:Iron_Platebody" ? 20 : o(a)) }, () => {
    const plate = item("melvorD:Iron_Platebody");
    eq(ironBars(S().plan.buildRows(plate, 1000, true)), 4000, "training planner:");
    eq(ironBars(T()._dev.buildRows(plate, 1000)), 4000, "Township planner:");
  }));
  test(TR, "with a high keep chance, running short still gets enough for a full craft", () => sandbox(() => stubSmith({ getPreservationChance: (o) => (a) => (a?.product?.id === "melvorD:Bronze_Platebody" ? 60 : o(a)) }, async () => {
    const sm = game.smithing, m = S().skills.methodsOf(sm).find((x) => x.product?.id === "melvorD:Bronze_Platebody");
    if (!m || m.level > sm.level) skip("Bronze Platebody is locked");
    const bar = "melvorD:Bronze_Bar", per = m.options[0].costs.find((k) => k.item.id === bar)?.quantity ?? 5;
    take(bar, have(bar)); give(bar, per - 2);
    const e = { kind: "craft", skillId: sm.id, actionId: m.id, itemId: m.product.id, qty: 2, startQty: have(m.product.id), label: "t" };
    const r = S()._dev.restockCraft(e);
    ok(r.ok, r.reason);
    const bars = r.entries.find((x) => x.itemId === bar);
    ok(bars && have(bar) + bars.qty >= per, `restock tops up to ${have(bar) + (bars?.qty ?? 0)} bars, a craft needs ${per}`);
    // and the planners plan at least one craft's worth too
    const plate = item(m.product.id);
    ok((S().plan.buildRows(plate, 1, true).find((x) => x.item.id === bar)?.qty ?? 0) + have(bar) >= per, "training planner plans too few bars for one");
    ok((T()._dev.buildRows(plate, 1).find((x) => x.item.id === bar)?.qty ?? 0) + have(bar) >= per, "Township planner plans too few bars for one");
  })));
  test(TR, "the chance to make double means fewer crafts",() => stubSmith({ getDoublingChance: (o) => (a) => (a?.product?.id === "melvorD:Iron_Platebody" ? 100 : o(a)) }, () => {
    const plate = item("melvorD:Iron_Platebody");
    eq(ironBars(S().plan.buildRows(plate, 1000, true)), 2500, "bars for 1,000 with every craft doubled:");
  }));
  test(TR, "XP bonuses count when working out how many crafts a level takes", () => stubSmith({ modifyXP: (o) => (x, a) => o(x, a) * 2 }, () => {
    const m = S().skills.methodsOf(game.smithing).find((x) => x.product?.id === "melvorD:Iron_Platebody");
    eq(Math.round(m.xp), Math.round(m.a.baseExperience * 2), "XP per craft:");
  }));
  test(TR, "a level goal plans about an hour of work at a time", () => {
    const sm = game.smithing, L = Math.min(99, sm.level + 30);
    const r = S()._dev.Trainer.plan({ id: "g", kind: "train", skillId: sm.id, targetLevel: L, targetXp: S().skills.xpAt(L), qty: S().skills.xpAt(L) });
    if (!r.ok) skip(r.reason);
    const last = r.entries[r.entries.length - 1], m = S().skills.methodById(sm, last.actionId), c = S().plan.trainCands(sm).find((x) => x.a === m);
    ok(c, "the batch's method isn't a candidate");
    const crafts = Math.ceil(last.qty / S().plan.trainCands(sm).find((x) => x.a === m).per);
    ok(crafts * c.ms <= 3600000 * 1.05, `batch is ${Math.round(crafts * c.ms / 60000)} min`);
  });
  test(TR, "the skill picker shows icons, splits combat from non-combat, and picking a skill works", () => sandbox(async () => {
    await openTrain();
    const pop = SwalLocale.getPopup();
    pop.querySelector("[data-mst-pick]").click(); await sleep(150);
    const heads = [...pop.querySelectorAll(".mst-pick-head")].map((h) => h.textContent);
    eq(heads.join(","), "Combat,Non-combat", "headings:");
    const items = [...pop.querySelectorAll(".mst-pick-item")];
    ok(items.length && items.every((b) => b.querySelector("img")), "every skill should have an icon");
    const firstNon = pop.querySelectorAll(".mst-pick-items")[1].querySelector(".mst-pick-item");
    ok(!["Attack", "Strength", "Defence", "Hitpoints", "Ranged", "Magic", "Prayer", "Slayer"].includes(firstNon.querySelector("span").textContent), "a combat skill is under Non-combat");
    const wc = items.find((b) => b.dataset.mstSkill === "melvorD:Woodcutting"); wc.click(); await sleep(250);
    eq($("mst-tr-skill").value, "melvorD:Woodcutting", "picked:"); ok(!pop.querySelector(".mst-pick-list"), "the list should close");
    has(pop.querySelector("[data-mst-pick]").textContent, "Woodcutting"); has($("mst-tr-prev").textContent, "Woodcutting");
  }));
  test(TR, "the Train window can switch to making an item", () => sandbox(async () => {
    await openTrain();
    const s = $("mst-tr-skill"); s.value = "melvorD:Smithing"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    const g = $("mst-tr-goal"); g.value = "make"; g.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    ok($("mst-tr-item"), "no item picker"); has($("mst-tr-prev").textContent, "Make");
  }));
  test(TR, "the item list is grouped by material, in the game's order", () => sandbox(async () => {
    await openTrain();
    const s = $("mst-tr-skill"); s.value = "melvorD:Smithing"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    const g = $("mst-tr-goal"); g.value = "make"; g.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    const groups = [...$("mst-tr-item").querySelectorAll("optgroup")].map((o) => o.label);
    ok(groups.length > 3, "no groups");
    eq(groups.slice(0, 3).join(","), "Standard Bars,Bronze Gear,Iron Gear", "first groups:");
    const bronze = [...$("mst-tr-item").querySelectorAll('optgroup[label="Bronze Gear"] option')].map((o) => o.textContent);
    ok(bronze.length > 3 && bronze.every((t) => t.startsWith("Bronze")), `Bronze Gear holds ${bronze.join(", ")}`);
    // Woodcutting has no groups, so it stays one list
    const s2 = $("mst-tr-skill"); s2.value = "melvorD:Woodcutting"; s2.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    const g2 = $("mst-tr-goal"); g2.value = "make"; g2.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    ok($("mst-tr-item") && !$("mst-tr-item").querySelector("optgroup"), "Woodcutting shouldn't be grouped");
  }));
  test(TR, "switching the goal redraws the form before the plan is worked out", () => sandbox(async () => {
    await openTrain();
    const s = $("mst-tr-skill"); s.value = "melvorD:Smithing"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    const g = $("mst-tr-goal");
    g.value = "make"; g.dispatchEvent(new Event("change", { bubbles: true }));
    ok($("mst-tr-item"), "the item list should show straight away");
    ok(await waitFor(() => /Make/.test($("mst-tr-prev")?.textContent ?? ""), 2000, 30), "the plan never filled in");
  }));

  // =================================================================================================================
  const TW = "Township";
  const allGoals = () => list(game.township.tasks.tasks).flatMap((t) => t.goals?.allGoals ?? []);
  test(TW, "every Township task goal can be described", () => {
    const bad = [], types = new Set();
    for (const g of allGoals()) {
      const d = T()._dev.describeGoal(g);
      if (!d) { types.add(g.constructor?.name); continue; }
      try { ok(d.title); text(d.body()); d.queue?.(); } catch (e) { bad.push(`${g.constructor?.name} ${d.title}: ${e.message}`); }
    }
    eq(bad.slice(0, 8).join("; "), "", `${bad.length} goals failed:`);
    if (types.size) console.log("[AQ test] goal types with no play button:", [...types].join(", "));
  });
  test(TW, "the task list shows a play button on every goal", async () => {
    const goals = [...document.querySelectorAll("township-task-goal")];
    if (!goals.length) skip("open Township > Tasks first to check the buttons");
    const missing = goals.filter((g) => !g.querySelector(".fa-play")).length;
    eq(missing, 0, "goals without a play button:");
  });
  test(TW, "an item task opens a plan window that adds its steps", () => sandbox(async () => {
    await closeSwal();
    const addBtn = () => [...(SwalLocale.getPopup()?.querySelectorAll(".swal2-actions button") ?? [])].find((b) => b.offsetParent && /Add to queue/.test(b.textContent));
    T().showItem("melvorD:Bronze_Bar", have("melvorD:Bronze_Bar") + 5); await waitFor(() => /Bronze Bar/.test(swalTitle()) && addBtn(), 4000, 100); await sleep(400);
    has(swalTitle(), "Bronze Bar");
    const btn = addBtn();
    ok(btn, "no Add to queue button"); btn.click(); await sleep(500);
    ok(items().some((e) => e.itemId === "melvorD:Bronze_Bar"), "steps weren't added");
  }));
  test(TW, "XP tasks become a goal the planner runs", () => {
    const wc = skill("Woodcutting"), e = T()._dev.xpEntry(wc, Math.floor(wc.xp) + 1000);
    eq(e.kind, "train"); eq(e.xpGoal, true); ok(e.targetLevel >= wc.level);
    has(text(T()._dev.xpSection(wc, Math.floor(wc.xp) + 1000)), "XP");
  });
  test(TW, "monster tasks become fight steps", () => {
    const cow = game.monsters.getObjectByID("melvorD:Cow");
    const es = T()._dev.killEntry({ monster: cow, quantity: 5 }, false);
    ok(Array.isArray(es) && es.length, "no entries"); const k = es.find((e) => e.kind === "kill"); ok(k, `no kill step: ${es.map((e) => e.kind)}`);
  });
  test(TW, "items that only drop find a way to get them", () => {
    const bad = [];
    for (const id of ["melvorD:Bird_Nest", "melvorD:Bones", "melvorD:Feathers"]) {
      try { const e = T()._dev.dropEntry(item(id), 1); if (!e) bad.push(`${id}: nothing`); } catch (err) { bad.push(`${id}: ${err.message}`); }
    }
    eq(bad.join("; "), "");
  });
  test(TW, "recipes that run short can farm random drops through the planner", () => {
    const rows = S().plan.buildRows(item("melvorD:Bird_Nest"), have("melvorD:Bird_Nest") + 1);
    ok(S().plan.toEntries(rows).length, "no step for Bird Nest");
  });
  test(TW, "the Fights don't need auto eat switch exists", () => {
    try { const v = mod.getContext("actionQueue").settings.section("Township Task Helper").get("noAutoEat"); ok(typeof v === "boolean"); }
    catch (e) { if (/getContext/.test(String(e))) skip("mod.getContext isn't available here"); throw e; }
  });

  // =================================================================================================================
  const CB = "Combat";
  test(CB, "a fight step runs a safe fight and counts kills", () => sandbox(async () => {
    liveOk();
    const chicken = game.monsters.getObjectByID("melvorD:Chicken");
    const es = T()._dev.killEntry({ monster: chicken, quantity: 1 }, false).filter((e) => e.kind === "kill");
    if (!es.length) skip("no fight step for Chicken");
    add(es);
    const done = await runUntil(() => items().every((e) => e.status === "done"), 90000);
    ok(done, `${items().map((e) => e.status + " " + (e.reason ?? "")).join("; ")} ${R().message}`);
  }), { live: true });

  test(CB, "a goal that switches gear switches back on Stop, and again on Start", () => sandbox(async () => {
    liveOk();
    // the game won't switch sets mid-fight, so let any fight from an earlier test end first
    try { if (game.activeAction) game.stopActiveAction(); } catch (e) { /* ignore */ }
    await waitFor(() => !game.combat.isActive && !game.activeAction, 4000); await sleep(800);
    const pl = game.combat.player, mine = pl.selectedEquipmentSet;
    const id = ["Ranged", "Attack", "Strength", "Magic"].find((n) => /switches to it/.test(S().plan.goalFirst(skill(n)) ?? ""));
    if (!id) skip("none of your other equipment sets has a weapon a goal would switch to");
    const sk = skill(id ?? "Ranged"), Lv = sk.level + 1;
    add([{ kind: "train", skillId: sk.id, targetLevel: Lv, targetXp: S().skills.xpAt(Lv), qty: S().skills.xpAt(Lv), label: `${sk.name} gear test` }]);
    A().runner.start(); await sleep(2500);
    if (!items().some((e) => e.what === "equip")) skip("no goal here needed a gear switch");
    if (pl.selectedEquipmentSet === mine) skip("the switch didn't happen (waiting for you to equip one)");
    A().runner.stop(); await sleep(300);
    eq(pl.selectedEquipmentSet, mine, "set after Stop");
    await waitFor(() => !game.combat.isActive && !game.activeAction, 3000); await sleep(800); // let the fight end before starting again
    A().runner.start(); await waitFor(() => pl.selectedEquipmentSet !== mine, 5000);
    ok(pl.selectedEquipmentSet !== mine, "didn't switch again after Start");
    A().runner.stop(); await sleep(300);
    eq(pl.selectedEquipmentSet, mine, "set after the second Stop");
  }), { live: true });

  // monsters with a fight the queue knows: one it won't run alone but you can eat yourself through, one that can one-hit you
  const fightable = () => list(game.monsters).filter((m) => S().fightId(m));
  const eatYourselfMonster = () => fightable().find((m) => { const D = T()._dev; return !D.queueSafety(m).ok && D.queueSafety(m, true).ok && !D.areaMissing(m).length; });
  test(CB, "a fight the queue won't run alone offers the eat-yourself box, and Add stays off until it's ticked", () => sandbox(async () => {
    const m = eatYourselfMonster(); if (!m) skip("every fight is either safe for you or too dangerous");
    await closeSwal();
    T()._dev.fire(m.name, () => T()._dev.selfEatSection(m), () => {}); await waitFor(() => SwalLocale.getPopup()?.querySelector("[data-mbd-selfeat]"), 3000, 100); await sleep(500);
    const pop = SwalLocale.getPopup(), box = pop.querySelector("[data-mbd-selfeat]");
    has(pop.textContent, "dying loses an item");
    ok(pop.querySelector(".swal2-deny").disabled, "Add to queue should be off before ticking");
    box.click(); await sleep(100);
    ok(!pop.querySelector(".swal2-deny").disabled, "Add to queue should be on after ticking");
    const e = T()._dev.killEntry({ monster: m, quantity: 1 }, false)[0]; eq(e.selfEat, true, "the step should remember the choice"); has(e.label, "you eat yourself");
    box.click(); await sleep(100); ok(pop.querySelector(".swal2-deny").disabled, "unticking turns it back off");
  }));
  test(CB, "a monster that can one-hit you can't be added, even if you'd eat yourself", () => {
    const m = fightable().find((x) => /one hit/.test(T()._dev.queueSafety(x, true).why ?? ""));
    if (!m) skip("nothing here can hit for more than your HP");
    const html = T()._dev.selfEatSection(m);
    ok(!/data-mbd-selfeat/.test(html), "there shouldn't be a box"); has(text(html), "can't run this fight");
  });
  test(CB, "a fight you said you'd eat yourself for gets past the auto eat check", () => {
    // checked without fighting: these monsters hit harder than your auto eat, so a real fight here isn't something to test with
    const m = eatYourselfMonster(); if (!m) skip("every fight is either safe for you or too dangerous");
    const Tr = S()._dev.Trainer, base = { kind: "kill", monsterId: m.id, skillId: "melvorD:Hitpoints", actionId: S().fightId(m), qty: 1 };
    eq(Tr.check({ ...base, selfEat: true })?.why ?? null, null, "with the box ticked it should pass:");
    has(Tr.check(base)?.why ?? "", "not safe", "without the box:");
  });
  test(CB, "a dungeon boss runs the whole dungeon instead of stopping", () => sandbox(async () => {
    liveOk();
    // the easiest dungeon you can run, and only one that can't take half your HP in a hit (it runs for a few seconds for real)
    const hp = game.combat.player.stats.maxHitpoints;
    const dg = list(game.dungeons).map((d) => ({ d, b: d.monsters?.[d.monsters.length - 1] }))
      .filter((x) => x.b && S().fightId(x.b)?.includes(`:${x.d.id}:`) && T()._dev.queueSafety(x.b, true).ok && !T()._dev.areaMissing(x.b).length)
      .map((x) => ({ ...x, max: Math.max(...[...new Set(x.d.monsters)].map((y) => T()._dev.fightSafety(y).max ?? Infinity)) }))
      .filter((x) => x.max * 2 < hp).sort((a, b) => a.max - b.max)[0]?.d;
    // start at full HP (it runs a few seconds of a real fight)
    try { game.combat.player.setHitpoints(hp); } catch (e) { /* older game */ }
    if (game.combat.player.hitpoints < hp * 0.9) skip("your HP isn't full");
    if (!dg) skip("no dungeon you can run");
    const boss = dg.monsters[dg.monsters.length - 1];
    add([{ kind: "kill", monsterId: boss.id, skillId: "melvorD:Hitpoints", actionId: S().fightId(boss), qty: 1, label: `Defeat ${boss.name} (you eat yourself)`, selfEat: true }]);
    A().runner.start(); await sleep(4000);
    ok(items()[0].status === "active", `${items()[0].status}: ${items()[0].reason ?? R().message}`);
    eq(game.combat.selectedArea, dg, "not in the dungeon");
  }), { live: true });
  test(CB, "level goals never pick a dungeon fight", () => {
    const bad = [];
    for (const n of ["Attack", "Strength", "Defence", "Hitpoints", "Ranged", "Magic", "Prayer", "Slayer"]) for (const c of S().plan.trainCands(skill(n))) if (c.a.dungeon) bad.push(`${n}: ${c.a.name}`);
    eq(bad.join("; "), "");
  });

  const PR = "Prayer";
  const prayerFight = (id) => S().skills.methodById(skill("Prayer"), S().fightId(game.monsters.getObjectByID(id)) ?? "");
  test(PR, "a monster with no bones and an empty bank gives no Prayer XP in the plan", () => sandbox(() => {
    for (const it of list(game.items)) if (it.prayerPoints > 0 && have(it)) take(it.id);
    const noBones = list(game.monsters).find((m) => !m.bones?.item && S().fightId(m) && prayerFight(m.id));
    if (!noBones) skip("no monster without bones");
    S()._dev.secMemo.m.clear();
    eq(prayerFight(noBones.id).xp, 0, `${noBones.name} XP:`);
    ok(prayerFight("melvorD:Chicken").xp > 0, "Chicken should give some");
  }));
  test(PR, "out of points, a fight that drops bones keeps going", () => sandbox(async () => {
    const pl = game.combat.player, pts = pl.prayerPoints;
    for (const it of list(game.items)) if (it.prayerPoints > 0 && have(it)) take(it.id);
    try {
      pl.prayerPoints = 0;
      eq(prayerFight("melvorD:Chicken").check(), null, "Chicken:");
      const noBones = list(game.monsters).find((m) => !m.bones?.item && S().fightId(m) && prayerFight(m.id));
      if (noBones) has(prayerFight(noBones.id).check()?.why ?? "", "out of prayer points");
    } finally { pl.prayerPoints = pts; }
  }));
  test(PR, "bones in the loot window get picked up and buried when points run low", () => sandbox(async () => {
    const pl = game.combat.player, pts = pl.prayerPoints, bones = item("melvorD:Bones"), loot = game.combat.loot;
    for (const it of list(game.items)) if (it.prayerPoints > 0 && have(it)) take(it.id);
    try {
      pl.prayerPoints = 0;
      loot.add(bones, 3, true);
      prayerFight("melvorD:Chicken").check();
      ok(!(loot.drops ?? []).some((d) => d.item === bones), "the bones are still in the loot window");
      ok(pl.prayerPoints > 0, "no points from burying");
    } finally { pl.prayerPoints = pts; const q = have(bones); if (q) game.bank.removeItemQuantity(bones, q, false); }
  }));
  test(PR, "a Prayer goal from zero points and no bones earns Prayer XP", () => sandbox(async () => {
    liveOk();
    const pl = game.combat.player, pr = skill("Prayer");
    try { pl.setHitpoints(pl.stats.maxHitpoints); } catch (e) { /* ignore */ }
    for (const it of list(game.items)) if (it.prayerPoints > 0 && have(it)) take(it.id);
    pl.prayerPoints = 0; const xp0 = pr.xp;
    add([{ kind: "train", skillId: pr.id, targetLevel: pr.level + 1, targetXp: S().skills.xpAt(pr.level + 1), qty: S().skills.xpAt(pr.level + 1), label: "Prayer test" }]);
    A().runner.start();
    ok(await waitFor(() => pr.xp > xp0 + 0.5, 40000, 500), `no Prayer XP: ${items().map((e) => `${e.kind}:${e.status} ${e.reason ?? ""}`).join(", ")} ${R().message}`);
    ok(A().runner.state === "running", `stopped: ${R().message}`);
  }), { live: true });

  const FP = "Fight prayers";
  const keepChoice = async (fn) => { const k = "aq-fight-prayer", was = localStorage.getItem(k); try { await fn(); } finally { if (was === null) localStorage.removeItem(k); else localStorage.setItem(k, was); } };
  test(FP, "the Train window offers a prayer for combat skills only", () => sandbox(() => keepChoice(async () => {
    if (!S().prayers.usable().length) skip("no prayer at your level");
    await openTrain();
    const pick = async (id) => { const s = $("mst-tr-skill"); s.value = id; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(80); return !!$("mst-tr-prayer"); };
    eq(await pick("melvorD:Defence"), true, "Defence:"); eq(await pick("melvorD:Attack"), true, "Attack:");
    eq(await pick("melvorD:Woodcutting"), false, "Woodcutting:"); eq(await pick("melvorD:Prayer"), false, "Prayer:");
    eq([...$("mst-tr-skill").options].length > 0, true);
  })));
  test(FP, "a combat goal keeps the prayer, the fights it plans get it, and the choice is remembered", () => sandbox(() => keepChoice(async () => {
    if (!S().prayers.usable().length) skip("no prayer at your level");
    localStorage.removeItem("aq-fight-prayer");
    await openTrain();
    const s = $("mst-tr-skill"); s.value = "melvorD:Defence"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(80);
    eq($("mst-tr-prayer").value, "", "off by default");
    const p = $("mst-tr-prayer"); p.value = "auto"; p.dispatchEvent(new Event("change", { bubbles: true })); await sleep(50);
    swalButton(".swal2-deny").click(); await waitFor(() => items().some((e) => e.kind === "train"), 4000, 100);
    const goal = items().find((e) => e.kind === "train"); eq(goal?.prayer, "auto"); has(goal.label, "with prayer");
    eq(localStorage.getItem("aq-fight-prayer"), "auto", "remembered:");
    const r = S()._dev.Trainer.plan(goal); ok(r.ok, r.reason);
    for (const x of r.entries.filter((x) => String(x.actionId).startsWith("fight:"))) eq(x.prayer, "auto", x.label);
  })));
  test(FP, "Automatic picks a prayer that fits the skill", () => {
    const D = skill("Defence"), p = S().prayers.auto(D);
    if (!p) skip("no defensive prayer at your level");
    ok(/Evasion|Damage Reduction/i.test(p.stats.describePlain()), `${p.name} for Defence`);
    const st = S().prayers.auto(skill("Strength")); if (st) ok(/Melee Maximum Hit/i.test(st.stats.describePlain()), `${st.name} for Strength`);
  });
  test(FP, "a fight with a prayer turns it on from bones the fight drops, and never stops for lack of points", () => sandbox(async () => {
    const pl = game.combat.player, pts = pl.prayerPoints, bones = item("melvorD:Bones"), loot = game.combat.loot, pr = S().prayers.usable()[0];
    if (!pr) skip("no prayer at your level");
    for (const it of list(game.items)) if (it.prayerPoints > 0 && have(it)) take(it.id);
    const m = S().skills.methodById(skill("Defence"), S().fightId(game.monsters.getObjectByID("melvorD:Chicken")));
    const e = { kind: "skill", skillId: "melvorD:Defence", actionId: m.id, prayer: pr.id };
    try {
      pl.prayerPoints = 0;
      eq(m.check(e), null, "no points and no bones:");
      loot.add(bones, 5, true); m.check(e);
      ok(pl.prayerPoints > 0, "didn't bury"); ok(pl.activePrayers.has(pr), "prayer isn't on");
    } finally { if (pl.activePrayers.has(pr)) pl.togglePrayer(pr); pl.prayerPoints = pts; const q = have(bones); if (q) game.bank.removeItemQuantity(bones, q, false); }
  }));
  test(FP, "with the prayer off, a fight leaves prayers alone", () => sandbox(async () => {
    const pl = game.combat.player, pts = pl.prayerPoints;
    const m = S().skills.methodById(skill("Defence"), S().fightId(game.monsters.getObjectByID("melvorD:Chicken")));
    try { pl.prayerPoints = 50; m.check({ kind: "skill", skillId: "melvorD:Defence", actionId: m.id }); eq(pl.activePrayers.size, 0, "a prayer got turned on"); }
    finally { pl.prayerPoints = pts; }
  }));
  test(FP, "a Township monster task opens with your last prayer and adds it to the fight", () => sandbox(() => keepChoice(async () => {
    const pr = S().prayers.usable()[0]; if (!pr) skip("no prayer at your level");
    const goal = list(game.township.tasks.tasks).flatMap((t) => t.goals?.allGoals ?? []).find((g) => g.constructor.name === "TownshipMonsterGoal" && g.monster && !T()._dev.areaMissing(g.monster).length);
    if (!goal) skip("no monster task you can do");
    localStorage.setItem("aq-fight-prayer", pr.id);
    await closeSwal();
    const el = document.createElement("township-task-goal"); document.body.appendChild(el);
    try {
      el.setGoal(goal); el.querySelector(".mbd-th-btn").click();
      await waitFor(() => SwalLocale.getPopup()?.querySelector("[data-mbd-prayer]"), 4000, 100); await sleep(400);
      eq(SwalLocale.getPopup().querySelector("[data-mbd-prayer]").value, pr.id, "preselected:");
      const add = [...SwalLocale.getPopup().querySelectorAll(".swal2-actions button")].find((b) => b.offsetParent && /Add to queue/.test(b.textContent));
      if (!add || add.disabled) skip("this fight can't be added right now");
      add.click(); await waitFor(() => items().length, 3000, 100);
      eq(items().find((x) => x.kind === "kill")?.prayer, pr.id, "kill step prayer:");
    } finally { el.remove(); }
  })));

  // =================================================================================================================
  const MX = "More skills";
  test(MX, "Farming waits for crops, works on the next step meanwhile, then harvests", () => sandbox(async () => {
    liveOk();
    const f = game.farming, pot = item("melvorD:Potatoes");
    const plot = list(f.plots).find((p) => p.category?.id === "melvorD:Allotment" && p.state !== 0);
    if (!plot) skip("no unlocked Allotment plot");
    if (plot.state === 1 && have("melvorD:Potato_Seed") < 3) give("melvorD:Potato_Seed", 5);
    if (plot.state === 2 && plot.plantedRecipe?.product !== pot) skip("the plot is growing something else");
    const origChance = f.getPlotGrowthChance;
    A().settings.set("sideJobs", true); A().settings.set("autoBuy", false);
    try {
      f.getPlotGrowthChance = () => 100;
      add([{ kind: "craft", skillId: "melvorD:Farming", actionId: "melvorD:Potatoes", itemId: "melvorD:Potatoes", altIndex: 0, qty: 1, label: "Farming: make Potatoes" }, logStep(200)]);
      A().runner.start(); await sleep(1500);
      if (swalOpen()) { swalButton(".swal2-cancel")?.click(); await sleep(800); } // compost offer
      ok(plot.state === 2 || plot.state === 3, `nothing planted (plot state ${plot.state}): ${items()[0].reason ?? R().message}`);
      if (plot.state === 2) { eq(game.activeAction?.id, "melvorD:Woodcutting", "should cut logs while the crop grows"); try { f.growthTimerMap.get(plot)?.start(200); } catch (e) { /* ignore */ } }
      await waitFor(() => plot.state === 3, 5000);
      items()[0].readyAt = Date.now() - 1; // as if the wait had passed
      ok(await waitFor(() => items()[0].status === "done", 10000), `didn't harvest: ${items()[0].info ?? items()[0].reason ?? R().message}`);
    } finally { f.getPlotGrowthChance = origChance; }
  }), { live: true });
  test(MX, "Alt Magic casts on something the queue can make and reaches the goal", () => sandbox(async () => {
    liveOk();
    // Just Learning needs runes and something to cast on: put some in the bank first
    for (const [id, n] of [["melvorF:Nature_Rune", 20], ["melvorD:Air_Rune", 20], ["melvorD:Fire_Rune", 40], ["melvorD:Iron_Arrowtips", 10]]) if (item(id)) give(id, n);
    S()._dev.secMemo.m.clear(); await sleep(1100); // let anything a test before this cached roll over
    const mg = skill("Magic"), c = S().plan.trainPlan(mg, mg.level + 1, null).batches[0]?.c;
    if (!c || !c.opt?.costs?.length) skip("no Alt Magic method at this level");
    for (const k of c.opt.costs) give(k.item.id, k.quantity * 10);
    const xp0 = Math.floor(mg.xp), xpEach = c.a.baseExperience ?? c.a.xp ?? 5;
    add([{ kind: "train", skillId: mg.id, targetLevel: mg.level + 1, targetXp: xp0 + xpEach, qty: xp0 + xpEach, label: "Magic: one cast" }]);
    ok(await runUntil(() => items().find((e) => e.kind === "train")?.status === "done", 20000), `${items().map((e) => e.label + " " + e.status + " " + (e.reason ?? "")).join("; ")} ${R().message}`);
  }), { live: true });
  test(MX, "Stardust plans an Astrology step with a constellation picker", () => sandbox(async () => {
    const it = item("melvorF:Stardust"); if (!it) skip("no Stardust in this game");
    const e = T()._dev.dropEntry(it, 5); ok(e, "no step"); eq(e.skillId, "melvorD:Astrology");
    await closeSwal(); T().showItem(it.id, have(it) + 5); await waitFor(() => /Stardust/.test(swalTitle()), 4000, 100); await sleep(400);
    ok(SwalLocale.getPopup().querySelector("[data-mbd-astro]"), "no constellation picker");
  }));
  test(MX, "Thieving only picks a target that's safe", () => {
    const sk = skill("Thieving"), p = S().plan.trainPlan(sk, sk.level + 1, null);
    if (!p.batches.length) { ok(S().plan.blockedWhy(sk), "no plan and no reason"); return; }
    const m = S().skills.methodById(sk, p.batches[0].c.a.id); ok(!m?.safe || m.safe().ok !== false, "picked an unsafe target");
  });

  // =================================================================================================================
  const SR = "Sources";
  test(SR, "a herb is planned from Farming, with an unlock step when no Herb plot is open", () => sandbox(async () => {
    const f = game.farming, herb = item("melvorD:Garum_Herb"), plots = list(f.plots).filter((p) => p.category?.id === "melvorD:Herb");
    const saved = plots.map((p) => p.state);
    try {
      // with every Herb plot locked (in memory only), the plan asks to unlock one first
      for (const p of plots) p.state = 0;
      const es = S().plan.toEntries(S().plan.buildRows(herb, have(herb) + 1));
      ok(es.some((e) => e.kind === "craft" && e.skillId === "melvorD:Farming"), `no Farming step: ${es.map((e) => e.label)}`);
      ok(es.some((e) => e.what === "plot"), `no unlock step: ${es.map((e) => e.label)}`);
      eq(es.findIndex((e) => e.what === "plot") < es.findIndex((e) => e.skillId === "melvorD:Farming" && e.kind === "craft"), true, "unlock comes first");
    } finally { plots.forEach((p, i) => { p.state = saved[i]; }); }
  }));
  test(SR, "the unlock-a-plot step asks first, and Skip spends nothing", () => sandbox(async () => {
    const f = game.farming, p = list(f.plots).find((x) => x.state === 0 && (x.level ?? 1) <= f.level);
    if (!p) skip("no locked plot at your Farming level");
    const gp = game.gp.amount;
    add([{ kind: "ask", what: "plot", skillId: "melvorD:Farming", actionId: p.id, qty: 1, label: "unlock test" }]);
    A().runner.start(); await waitFor(() => /Farming plot/.test(swalTitle()), 4000, 100); await sleep(500);
    has(swalTitle(), "Unlock a Farming plot"); has(SwalLocale.getPopup().textContent, "can't be undone");
    swalButton(".swal2-cancel").click(); await sleep(800);
    eq(p.state, 0, "the plot got unlocked"); eq(game.gp.amount, gp, "GP spent");
  }));
  test(SR, "Thieving loot counts as a source, but only from targets that are safe", () => {
    const D = T()._dev, th = skill("Thieving");
    const npc = list(th.actions).find((a) => (a.lootTable?.drops ?? []).length);
    const it = npc.lootTable.drops[0].item;
    const o = D.farmSkills(it).find((x) => x.skill === th && x.a === npc);
    ok(o, `${npc.name} isn't listed as a source of ${it.name}`);
    const safe = S().skills.methodById(th, npc.id)?.safe?.().ok !== false;
    eq(o.open, (npc.level ?? 1) <= th.level && safe, "open should follow level and safety");
  });
  test(SR, "things you open are planned (get them, then open them)", () => {
    const D = T()._dev;
    const it = list(game.items).find((x) => { if (S().items.crafter(x.id) || S().items.gatherer(x.id) || S().items.shopOnly(x)) return false; const e = D.dropEntry(x, 1); return e?.what === "open"; });
    if (!it) skip("nothing here comes only from something you can open");
    const e = D.dropEntry(it, 1);
    ok(e.before?.length, "no steps to get the container"); ok(e.openId && e.openN > 0, "no open step");
    const es = S().plan.toEntries(S().plan.buildRows(it, have(it) + 1));
    eq(es[es.length - 1].what, "open", "open comes last"); ok(es.length >= 2, "the container step is missing");
  });
  test(SR, "an open step opens what the plan collected, without asking", () => sandbox(async () => {
    const nest = item("melvorD:Bird_Nest"); if (!nest?.dropTable) skip("no Bird Nest");
    give(nest.id, 2);
    const before = have(nest);
    add([{ kind: "ask", what: "open", openId: nest.id, openN: 2, itemId: nest.dropTable.drops[0].item.id, qty: 1, label: "Open test" }]);
    A().runner.start(); await sleep(500);
    ok(!swalOpen(), "it asked");
    // a full bank can't take what's inside: the step stops and says so instead of crashing
    if (items()[0].status === "blocked") { has(items()[0].reason, "too full"); return; }
    eq(items()[0].status, "done", items()[0].reason ?? R().message); eq(have(nest), before - 2, "nests opened");
    bankUndo.pop(); // the nests are gone
  }));
  test(SR, "Ash and other byproducts plan as Firemaking, and Perfect dishes as Cooking", () => {
    const D = T()._dev;
    const ash = list(game.items).find((x) => x.name === "Ash"), shrimp = item("melvorD:Shrimp_Perfect");
    if (ash) { const e = D.dropEntry(ash, 2); ok(e, "no source for Ash"); eq(e.skillId, "melvorD:Firemaking"); ok(e.yieldPer > 0, "no yield"); }
    if (shrimp && game.cooking.getRecipePerfectChance(list(game.cooking.actions).find((a) => a.perfectItem === shrimp)) > 0) { const e = D.dropEntry(shrimp, 1); ok(e, "no source for a Perfect dish"); eq(e.skillId, "melvorD:Cooking"); }
  });
  test(SR, "a byproduct step gets its own logs when it runs out", () => sandbox(async () => {
    liveOk();
    const ash = list(game.items).find((x) => x.name === "Ash"); if (!ash) skip("no Ash");
    const e = T()._dev.dropEntry(ash, 1); if (!e) skip("no source for Ash");
    const m = S().skills.methodById(skill(e.skillId), e.actionId), logs = m.options[0].costs[0]?.item;
    take(logs.id); const ash0 = have(ash);
    bankUndo.push(() => { const q = have(ash) - ash0; if (q > 0) game.bank.removeItemQuantity(ash, q, false); });
    add([{ ...e, itemId: ash.id, qty: 1 }]);
    A().runner.start(); await sleep(1500);
    ok(items().length > 1 && items()[0].itemId === logs.id, `didn't add a step for ${logs.name}: ${items().map((x) => x.label + " " + x.status + " " + (x.reason ?? "")).join("; ")}`);
  }), { live: true });
  test(SR, "an Archaeology goal with no dig site found surveys and travels toward one", () => {
    const ar = game.archaeology, site = list(ar.actions).find((x) => x.poi?.hex), Dv = S()._dev;
    const saved = list(ar.actions).map((x) => [x, x.poi?.isDiscovered, x.maps, x.selectedMapIndex]), can = ar.canExcavate;
    let res;
    try {
      for (const [x] of saved) { if (x.poi) x.poi.isDiscovered = false; x.maps = []; x.selectedMapIndex = -1; }
      ar.canExcavate = () => false;
      res = Dv.Trainer.plan({ id: "g", kind: "train", skillId: ar.id, targetLevel: ar.level + 1, targetXp: S().skills.xpAt(ar.level + 1), qty: S().skills.xpAt(ar.level + 1) });
    } finally { for (const [x, d, m, i] of saved) { if (x.poi) x.poi.isDiscovered = d; x.maps = m; x.selectedMapIndex = i; } ar.canExcavate = can; }
    if (!res.ok) { has(res.reason, "dig site"); return; }
    eq(res.setup, true, "setup flag"); ok(res.entries.length === 1, "one hop at a time");
    const e = res.entries[0]; ok(e.actionId === "cartography:survey" || e.what === "travel", `unexpected step ${e.label}`); ok(e.hexQ !== undefined, "no hex");
    ok(site, "no site");
  });
  test(SR, "a found dig site with a map gets the map and tools picked", () => sandbox(async () => {
    const ar = game.archaeology, site = list(ar.actions).find((x) => x.maps?.some((m) => m.charges > 0));
    if (!site) skip("no dig site with a map");
    const i = site.selectedMapIndex, tools = [...(site.selectedTools ?? [])];
    try {
      ar.deselectMap?.(site); for (const t of tools) try { ar.setToolAsInactive(site, t); } catch (e) { /* ignore */ }
      Q().items = []; add([{ kind: "train", skillId: ar.id, targetLevel: ar.level + 1, targetXp: S().skills.xpAt(ar.level + 1), qty: S().skills.xpAt(ar.level + 1), label: "dig test" }]);
      A().runner.start(); await sleep(800); A().runner.stop();
      ok(site.selectedMap, "no map picked"); ok(site.selectedTools?.length, "no tools picked");
    } finally { if (i >= 0 && site.selectedMapIndex !== i) try { ar.setMapAsActive(site, i); } catch (e) { /* ignore */ } }
  }));
  test(SR, "Rags to Riches II and III train Magic and count as a way to get gems", () => {
    const mg = skill("Magic"), names = S().skills.methodsOf(mg).map((m) => m.name);
    ok(names.some((n) => /Rags to Riches II$/.test(n)), "no Rags to Riches II"); ok(names.some((n) => /Rags to Riches III$/.test(n)), "no Rags to Riches III");
    ok(T()._dev.farmSkills(item("melvorD:Topaz")).some((o) => /Rags to Riches/.test(o.a.name)), "not a gem source");
  });

  // =================================================================================================================
  const MT = "Mastery tokens";
  const withToken = async (fn) => {
    const tok = item("melvorD:Mastery_Token_Woodcutting"), wc = skill("Woodcutting"), realm = tok.realm, pool0 = wc.getMasteryPoolXP(realm);
    try { await fn({ tok, wc, realm, pool0 }); }
    finally { const q = have(tok); if (q > 0) game.bank.removeItemQuantity(tok, q, false); const g = wc.getMasteryPoolXP(realm) - pool0; if (g) wc.addMasteryPoolXP(realm, -g); }
  };
  test(MT, "tokens are claimed while the queue runs, with one message", () => sandbox(() => withToken(async ({ tok, wc, realm, pool0 }) => {
    liveOk();
    if (have(tok)) skip("you already have Woodcutting tokens");
    A().settings.set("autoTokens", true); A()._dev.Tokens.told = 0;
    const notes = [], on = window.notifyPlayer; window.notifyPlayer = (s, m) => notes.push(m);
    try {
      game.bank.addItem(tok, 2, false, false, true);
      add([logStep(500)]); A().runner.start(); await waitFor(() => !have(tok), 4000);
    } finally { window.notifyPlayer = on; }
    eq(have(tok), 0, "tokens left"); ok(wc.getMasteryPoolXP(realm) > pool0, "pool didn't grow");
    eq(notes.filter((m) => /mastery token/.test(m)).length, 1, "messages");
  })), { live: true });
  test(MT, "with the setting off, tokens stay in the bank", () => sandbox(() => withToken(async ({ tok }) => {
    liveOk();
    A().settings.set("autoTokens", false);
    game.bank.addItem(tok, 1, false, false, true); const n = have(tok);
    add([logStep(500)]); A().runner.start(); await sleep(2500);
    eq(have(tok), n);
  })), { live: true });
  test(MT, "tokens past a full pool stay in the bank", () => sandbox(() => withToken(async ({ tok, wc }) => {
    const proto = Object.getPrototypeOf(wc), cap = Object.getOwnPropertyDescriptor(wc, "getMasteryPoolCap");
    A().settings.set("autoTokens", true);
    try {
      wc.getMasteryPoolCap = (r) => wc.getMasteryPoolXP(r) + Math.floor(wc.getBaseMasteryPoolCap(r) * (tok.percent / 100)) * 1.5; // room for one
      game.bank.addItem(tok, 3, false, false, true); const n = have(tok);
      A()._dev.claimTokens();
      eq(have(tok), n - 1, "should claim exactly one");
    } finally { if (cap) Object.defineProperty(wc, "getMasteryPoolCap", cap); else delete wc.getMasteryPoolCap; void proto; }
  })));

  // =================================================================================================================
  const RC = "Recipes";
  test(RC, "every potion tier comes from its recipe", () => {
    const hl = game.herblore, bad = [];
    for (const r of list(hl.actions).filter((x) => !x.realm || x.realm.id === "melvorD:Melvor")) for (const p of r.potions ?? []) { const c = S().items.index().crafters.get(p.id)?.[0]; if (c?.a?.id !== r.id) bad.push(p.name); }
    eq(bad.slice(0, 8).join(", "), "", "potions without their recipe:");
  });
  test(RC, "a higher tier potion asks for the mastery it needs", () => {
    const hl = game.herblore, r = list(hl.actions).find((x) => hl.getPotionTier(x) < 3 && (!x.realm || x.realm.id === "melvorD:Melvor"));
    if (!r) skip("every recipe is at tier IV");
    const t = hl.getPotionTier(r) + 1, p = r.potions[t], miss = S().plan.itemMissing(p, 1, true).map((x) => x.text).join("; ");
    has(miss, `${r.name} mastery`, "missing:");
    if (r.level > hl.level) return; // the level check answers first when starting it
    const res = S()._dev.startAction({ kind: "craft", skillId: hl.id, actionId: r.id, itemId: p.id, qty: 1 });
    eq(res.ok, false); has(res.reason, "mastery");
  });
  test(RC, "the tier your mastery is at has no mastery warning", () => {
    const hl = game.herblore, r = list(hl.actions)[0], p = r.potions[hl.getPotionTier(r)];
    eq(S().items.potionGap(p), null);
  });
  test(RC, "a lower tier than you brew now says so", () => {
    const hl = game.herblore, r = list(hl.actions)[0], orig = hl.getPotionTier;
    try { hl.getPotionTier = () => 2; const g = S().items.potionGap(r.potions[0]); ok(g, "no gap"); has(g.why, "higher tier"); }
    finally { hl.getPotionTier = orig; }
  });
  test(RC, "Divine Potion IV lists everything it needs instead of no source", () => {
    const p = item("melvorF:Divine_Potion_IV"); if (!p) skip("no Divine Potion IV");
    const miss = S().plan.itemMissing(p, 1, true).map((x) => `${x.text} for ${x.forName}`).join("; ");
    if (skill("Herblore").level < 57) has(miss, "57 Herblore");
    if (game.herblore.getPotionTier(game.herblore.getRecipeForPotion(p)) < 3) has(miss, "mastery 90");
    ok(!/No source found/.test(T()._dev.itemSection(p, 1)), "the Township window says no source");
  });
  test(RC, "a Magic or Farming source you're not high enough for is named", () => {
    const dust = item("melvorF:Holy_Dust"), mg = skill("Magic");
    const sp = list(game.altMagic.actions).find((x) => x.produces === dust);
    if (!sp || sp.level <= mg.level) skip("you can already cast Blessed Offering");
    const miss = S().plan.itemMissing(dust, 1, true).map((x) => x.text);
    ok(miss.includes(`${sp.level} Magic`), `got ${miss.join("; ")}`);
  });
  test(RC, "items only a spell makes plan through Magic, and Bones still come from monsters", () => {
    const urn = item("melvorF:Small_Urn_Enchanted"); if (!urn) skip("no Enchanted Urn");
    const row = T()._dev.buildRows(urn, 1).find((r) => r.item === urn);
    eq(row?.recipe?.c?.skill?.id, "melvorD:Magic", "urn recipe:");
    const bones = item("melvorD:Bones"); ok(!T()._dev.buildRows(bones, 1).find((r) => r.item === bones)?.recipe, "Bones became a recipe");
  });
  test(RC, "everything a skill makes has a source the queue knows about", () => {
    const isItem = (v) => v && typeof v === "object" && typeof v.id === "string" && game.items.getObjectByID(v.id) === v;
    const made = new Map();
    for (const sk of list(game.skills)) for (const a of list(sk.actions)) {
      if (a.realm && a.realm.id !== "melvorD:Melvor") continue;
      for (const k of Object.keys(a)) {
        if (/cost|consum|require|fuel|oil|log$|input|discovered/i.test(k)) continue;
        const v = a[k], put = (it) => made.set(it.id, `${sk.localID}.${k}`);
        if (isItem(v)) put(v); else if (Array.isArray(v)) for (const x of v) { if (isItem(x)) put(x); else if (isItem(x?.item)) put(x.item); } else if (v?.drops) for (const d of v.drops) if (isItem(d?.item)) put(d.item);
      }
    }
    const D = T()._dev, none = [];
    for (const [id, where] of made) {
      const it = item(id), row = D.buildRows(it, 1).find((r) => r.item === it);
      if (row?.recipe || D.isFarmItem(it) || D.isAstroItem?.(it)) continue;
      if (/No source found/.test(D.itemSection(it, 1))) none.push(`${it.name} (${where})`);
    }
    eq(none.slice(0, 10).join("; "), "", `${none.length} with no source:`);
  });

  // =================================================================================================================
  const UP = "Upgrades";
  const roomy = async (fn) => { const b = game.bank, d = Object.getOwnPropertyDescriptor(b, "maximumSlots"), real = b.maximumSlots; Object.defineProperty(b, "maximumSlots", { get: () => real + 5, configurable: true }); try { await fn(); } finally { if (d) Object.defineProperty(b, "maximumSlots", d); else delete b.maximumSlots; } };
  const sHelm = () => list(game.items).find((i) => i.name === "(S) Bronze Helmet");
  test(UP, "(G) Adamant Shield plans through both upgrades, the same in both windows", () => {
    const g = item("melvorD:Adamant_Shield_T_G"); if (!g) skip("no (G) Adamant Shield");
    const a = S().plan.toEntries(S().plan.buildRows(g, 1, true)), b = T()._dev.toEntries(T()._dev.buildRows(g, 1));
    const ups = a.filter((e) => e.what === "upgrade").map((e) => e.label);
    eq(ups.join(" > "), "Upgrade to (S) Adamant Shield > Upgrade to (G) Adamant Shield");
    eq(a[a.length - 1].what, "upgrade", "last step"); ok(a.some((e) => e.itemId === "melvorD:Gold_Bar"), "no Gold Bars");
    eq(b.map((e) => e.label).join("|"), a.map((e) => e.label).join("|"), "the Township window plans it differently:");
    ok(!/No source found/.test(T()._dev.itemSection(g, 1)), "the window says no source");
  });
  test(UP, "upgrades never replace a skill, the shop or a drop that already gives the item", () => {
    const bad = [];
    for (const [id, cs] of S().items.index().crafters) {
      if (cs[0].skill.id !== S().items.UPGRADE) continue;
      const it = item(id);
      if (S().skills.list().some((sk) => S().skills.methodsOf(sk).some((m) => m.product === it))) bad.push(`${it.name} (skill)`);
      if (A().shop.for(it)) bad.push(`${it.name} (shop)`);
    }
    eq(bad.slice(0, 6).join(", "), "");
    ok(!T()._dev.buildRows(item("melvorD:Bones"), 1).find((r) => r.item.id === "melvorD:Bones")?.recipe, "Bones");
  });
  test(UP, "an upgrade asks first, and Skip spends nothing", () => sandbox(async () => {
    const s = sHelm(); if (!s) skip("no (S) Bronze Helmet");
    give("melvorD:Bronze_Helmet", 1); give("melvorD:Silver_Bar", 10);
    const gp = game.gp.amount, n = have(s);
    add([{ itemId: s.id, qty: n + 1, kind: "ask", what: "upgrade", label: "upgrade test" }]);
    A().runner.start(); await waitFor(() => /Upgrade an item/.test(swalTitle()), 4000, 100); await sleep(500);
    has(SwalLocale.getPopup().textContent, "5,000 GP");
    swalButton(".swal2-cancel").click(); await sleep(800);
    eq(items()[0].kind, "manual", "skip should make it a step you do yourself"); eq(game.gp.amount, gp, "GP"); eq(have(s), n, "upgraded anyway");
  }));
  test(UP, "Upgrade spends the cost and gives the item", () => sandbox(() => roomy(async () => {
    const s = sHelm(); if (!s) skip("no (S) Bronze Helmet");
    give("melvorD:Bronze_Helmet", 1); give("melvorD:Silver_Bar", 10);
    const gp = game.gp.amount, n = have(s);
    bankUndo.push(() => { const q = have(s) - n; if (q > 0) game.bank.removeItemQuantity(s, q, false); });
    add([{ itemId: s.id, qty: n + 1, kind: "ask", what: "upgrade", label: "upgrade test" }]);
    A().runner.start(); await waitFor(() => /Upgrade an item/.test(swalTitle()), 4000, 100); await sleep(500);
    swalButton(".swal2-confirm").click(); await waitFor(() => items()[0].status === "done", 4000);
    eq(items()[0].status, "done", items()[0].reason ?? R().message); eq(have(s), n + 1, "item"); eq(gp - game.gp.amount, 5000, "GP spent");
  })));
  test(UP, "an upgrade with no room in the bank stops and says so", () => sandbox(async () => {
    const s = sHelm(); if (!s) skip("no (S) Bronze Helmet");
    give("melvorD:Bronze_Helmet", 1); give("melvorD:Silver_Bar", 10);
    const b = game.bank, d = Object.getOwnPropertyDescriptor(b, "maximumSlots"), used = b.occupiedSlots ?? b.items.size, gp = game.gp.amount;
    Object.defineProperty(b, "maximumSlots", { get: () => used, configurable: true });
    try {
      add([{ itemId: s.id, qty: have(s) + 1, kind: "ask", what: "upgrade", label: "upgrade test", answer: "yes" }]);
      A().runner.start(); await sleep(600);
    } finally { if (d) Object.defineProperty(b, "maximumSlots", d); else delete b.maximumSlots; }
    if (have(s)) return; // you already had one, so it stacked
    eq(items()[0].status, "blocked"); has(items()[0].reason, "bank full"); eq(game.gp.amount, gp, "GP");
  }));
  test(UP, "Township steps for things you open include getting them first", () => {
    const D = T()._dev, it = list(game.items).find((x) => !S().items.crafter(x.id) && !S().items.gatherer(x.id) && !S().items.shopOnly(x) && D.dropEntry(x, 1)?.what === "open");
    if (!it) skip("nothing here comes only from something you can open");
    const es = D.toEntries(D.buildRows(it, have(it) + 1));
    ok(es.every((e) => !("before" in e)), "a step still carries its first steps inside it"); ok(es.length >= 2, "the container step is missing");
  });

  // =================================================================================================================
  const PN = "Panel";
  test(PN, "the panel opens, lists steps and its buttons work", () => sandbox(async () => {
    add([logStep(50)]);
    A().panel.open(); await sleep(200);
    const p = document.getElementById("aq-queue-panel"); ok(p && p.style.display !== "none", "panel didn't open");
    has(p.textContent, "Normal Logs");
    const click = async (act) => { const b = p.querySelector(`[data-act="${act}"]`); ok(b, `no ${act} button`); b.click(); await sleep(400); };
    if (!document.hidden) { await click("start"); eq(A().runner.state, "running"); await click("pause"); eq(A().runner.state, "paused"); await click("stop"); eq(A().runner.state, "idle"); }
    A().panel.close(); await sleep(100); ok(p.style.display === "none", "panel didn't close");
  }));

  test(PN, "the buttons stay on screen on pages without the skill bar", async () => {
    const back = game.openPage, pages = (id) => game.pages.getObjectByID(id);
    const shown = (el) => { const r = el?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    try {
      changePage(pages("melvorD:Bank"), -1, undefined, false, false); await sleep(400);
      const fb = document.getElementById("aq-float-bar"), q = document.getElementById("aq-queue-btn"), t = document.getElementById("mst-train-btn");
      ok(fb?.contains(q) && fb.contains(t), "buttons didn't move to the floating bar on the Bank page");
      ok(shown(q) && shown(t), "buttons aren't visible on the Bank page");
      changePage(pages("melvorD:Woodcutting"), -1, undefined, false, false); await sleep(400);
      const bar = document.getElementById("skill-footer-minibar");
      ok(bar.contains(q) && bar.contains(t), "buttons didn't go back to the skill bar");
      eq(getComputedStyle(fb).display, "none");
    } finally { if (back && back !== game.openPage) changePage(back, -1, undefined, false, false); }
  });

  // =================================================================================================================
  const run = async (opts = {}) => {
    const { live = true, group = null, only = null } = opts;
    const results = [];
    const t0 = Date.now();
    window.AQTests.last = { running: true, results };
    for (const t of TESTS) {
      if (group && t.group !== group) continue;
      if (only && !only.test(t.name)) continue;
      const r = { group: t.group, name: t.name, status: "pass", ms: 0, note: "" };
      const s = Date.now();
      if (t.live && !live) { r.status = "skip"; r.note = "live tests off"; }
      else {
        try { await t.fn(); }
        catch (e) { if (e instanceof Skip) { r.status = "skip"; r.note = e.message; } else { r.status = "FAIL"; r.note = e.message; console.error(`[AQ test] ${t.group}: ${t.name}`, e); } }
      }
      r.ms = Date.now() - s;
      results.push(r);
    }
    const count = (s) => results.filter((r) => r.status === s).length;
    const summary = { version: A()?.version, passed: count("pass"), failed: count("FAIL"), skipped: count("skip"), total: results.length, seconds: Math.round((Date.now() - t0) / 100) / 10 };
    console.table(results.filter((r) => r.status !== "pass").map((r) => ({ group: r.group, test: r.name, result: r.status, note: r.note })));
    console.log(`%cAction Queue ${summary.version}: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.seconds}s)`, `font-weight:bold;color:${summary.failed ? "#e0505c" : "#30c78d"}`);
    window.AQTests.last = { running: false, summary, results };
    return window.AQTests.last;
  };
  window.AQTests = { run, tests: TESTS.map((t) => `${t.group}: ${t.name}`), last: null };
  console.log(`AQTests loaded (${TESTS.length} tests). Run: await AQTests.run()`);
})();

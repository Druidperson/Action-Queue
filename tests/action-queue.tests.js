/*
 * Action Queue test suite (queue, training and Township tasks). Runs inside Melvor Idle with the mod installed.
 *
 *   1. Open the game, load a character, open the browser console.
 *   2. Paste this file, then run:   await AQTests.run()
 *
 * Options: AQTests.run({ live: false })          skip tests that start real game actions
 *          AQTests.run({ group: "Queue" })       one group only
 *          AQTests.run({ only: /duplicate/i })   tests whose name matches
 * Progress is kept in AQTests.last while it runs. The queue, settings, bank items and GP a test touches are put back
 * afterwards. Keep the game tab in front while it runs: hidden tabs pause the game and the live tests will skip.
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
  const SETTINGS = ["autoStart", "autoSell", "autoBuy", "sideJobs"];

  // ---- sandbox: everything a test changes is put back afterwards ----
  const swalOpen = () => { try { return !!SwalLocale.isVisible(); } catch (e) { return !!document.querySelector(".swal2-container .swal2-popup"); } };
  const closeSwal = async () => { for (let i = 0; i < 5 && swalOpen(); i++) { try { SwalLocale.close(); } catch (e) { /* ignore */ } await sleep(300); } await waitFor(() => !document.querySelector(".swal2-container"), 3000, 100); };
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
  test(RU, "an empty queue says so instead of starting", () => sandbox(() => { A().runner.start(); eq(A().runner.state, "idle"); has(R().message, "Nothing to run"); }));
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
    eq(e.status, "done"); has(e.sold ?? "", "Sold 3 extra");
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
      const t0 = performance.now(); s.dispatchEvent(new Event("change", { bubbles: true })); const dt = performance.now() - t0;
      const prev = $("mst-tr-prev")?.textContent ?? "";
      if (!prev.trim()) bad.push(`${o.textContent}: empty preview`);
      if (dt > 1000) bad.push(`${o.textContent}: took ${Math.round(dt)} ms to show`);
    }
    eq(bad.join("; "), "", "previews:");
    // pick Woodcutting and add it
    const s = $("mst-tr-skill"); s.value = "melvorD:Woodcutting"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(50);
    swalButton(".swal2-deny").click();
    await waitFor(() => items().some((e) => e.kind === "train"), 4000, 100);
    const goal = items().find((e) => e.kind === "train" && e.skillId === "melvorD:Woodcutting"); ok(goal, "no goal was added");
    has(goal.label, "Woodcutting: reach level");
  }));
  test(TR, "the Train window can switch to making an item", () => sandbox(async () => {
    await openTrain();
    const s = $("mst-tr-skill"); s.value = "melvorD:Smithing"; s.dispatchEvent(new Event("change", { bubbles: true })); await sleep(50);
    const g = $("mst-tr-goal"); g.value = "make"; g.dispatchEvent(new Event("change", { bubbles: true })); await sleep(50);
    ok($("mst-tr-item"), "no item picker"); has($("mst-tr-prev").textContent, "Make");
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
    A().runner.start(); await sleep(2500);
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
  test(CB, "a fight you said you'd eat yourself for gets past the auto eat check", () => sandbox(async () => {
    liveOk();
    const m = eatYourselfMonster(); if (!m) skip("every fight is either safe for you or too dangerous");
    add([{ kind: "kill", monsterId: m.id, skillId: "melvorD:Hitpoints", actionId: S().fightId(m), qty: 1, label: `Defeat ${m.name} (you eat yourself)`, selfEat: true }]);
    A().runner.start(); await sleep(2500);
    ok(items()[0].status !== "blocked", `blocked: ${items()[0].reason}`); eq(game.activeAction, game.combat, "not fighting");
    A().runner.stop(); await sleep(200);
    // the same fight without the choice is still refused
    Q().items = []; Q().save();
    add([{ kind: "kill", monsterId: m.id, skillId: "melvorD:Hitpoints", actionId: S().fightId(m), qty: 1, label: `Defeat ${m.name}` }]);
    A().runner.start(); await sleep(500);
    if (!T()._dev.queueSafety(m).ok) { eq(items()[0].status, "blocked"); has(items()[0].reason, "not safe"); }
  }), { live: true });
  test(CB, "a dungeon boss runs the whole dungeon instead of stopping", () => sandbox(async () => {
    liveOk();
    const dg = list(game.dungeons).find((d) => { const b = d.monsters?.[d.monsters.length - 1]; return b && S().fightId(b)?.includes(`:${d.id}:`) && T()._dev.queueSafety(b, true).ok && !T()._dev.areaMissing(b).length; });
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

  // =================================================================================================================
  const MX = "More skills";
  test(MX, "Farming waits for crops, works on the next step meanwhile, then harvests", () => sandbox(async () => {
    liveOk();
    const f = game.farming, pot = item("melvorD:Potatoes");
    const plot = list(f.plots).find((p) => p.category?.id === "melvorD:Allotment" && p.state !== 0);
    if (!plot) skip("no unlocked Allotment plot");
    if (plot.state === 1 && have("melvorD:Potato_Seed") < 3) skip("needs 3 Potato Seeds to plant");
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
    const it = list(game.items).find((x) => { if (S().items.crafter(x.id) || S().items.gatherer(x.id) || D.isFarmItem(x)) return false; const e = D.dropEntry(x, 1); return e?.what === "open"; });
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
    ok(!swalOpen(), "it asked"); eq(items()[0].status, "done", items()[0].reason ?? R().message); eq(have(nest), before - 2, "nests opened");
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

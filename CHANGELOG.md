# Changelog

## 2.1.0
- Monster tasks that aren't safe while you're away (Mumma Chicken, say, when it hits harder than where your auto eat starts) aren't flat out refused anymore. The task window says why, and you can tick "I'll stay and eat myself during this fight" to add it anyway. Add to queue stays off until you tick it. The queue then runs that fight without waiting for auto eat and gives you a heads up when it starts. If you don't eat in time you can die and lose an item, so only tick it if you'll be there.
- A monster that can kill you in one hit from full HP, or having no food equipped, still can't be added.
- Dungeon bosses work now. Mumma Chicken and other bosses run the whole dungeon from the first room instead of stopping with "the game wouldn't start it". The safety check counts every monster in the dungeon, and the time estimate counts full runs.
- Level goals never pick a dungeon fight.
- Fixed: the "Fights don't need auto eat" setting only changed what the task window said. The queue now follows it too.

## 2.0.1
- Stopping the queue, or removing a goal, now switches you back to your own equipment set if the goal had switched it. Before, it only switched back once the goal was done, so clearing a Ranged goal halfway left you on the bow set. Press Start again and it switches back to the right set.
- The queue panel fits on narrow screens and phones now instead of running off the left side.
- For mod makers: `hasTrainer` is a function now, since the game copies the API for `mod.api` and the old version always read false there.
- New test suite in `tests/action-queue.tests.js` that covers the queue, training, Township tasks, asking first, combat and the panel. Paste it into the console with the mod loaded and run `await AQTests.run()`.

## 2.0.0
- Skill Trainer and Township Task Helper are part of Action Queue again. It's one mod now, so you only need this one. If you still have Skill Trainer or Township Task Helper installed, uninstall them, the queue tells you if it finds them.
- Everything they did is still here: the Train window (chart button), the green play buttons on Township tasks, and the queue.
- Your saved queue and the queue settings carry over. The "Prefer mastery XP" and "Fights don't need auto eat" switches might be back to off, so check them in the mod settings if you used them.
- No more waiting a few seconds on load for the other mods, everything starts together.

## 1.2.0
- Action Queue now only runs the queue: the list, the panel, auto-start, auto-sell, auto-buy and working on other steps while crops grow. Everything about how to train a skill moved to Skill Trainer, so training steps need Skill Trainer installed. Without it, those steps wait with a note.
- The "Prefer mastery XP" setting moved to Skill Trainer.

## 1.1.0
- New setting: Buy from the shop without asking. Turn it on and steps that need feathers, Summoning shards or compost buy them right away. It's off by default, and there's a cart button for it on the queue panel too. Agility obstacles, Slayer tasks and dig site maps still ask.
- Alt Magic can now use Just Learning and Item Alchemy. The queue casts them on something it can gather or make itself, like arrowtips or bars, and counts the time to get it. Alchemy picks the item that makes the most GP among the fastest options. It never casts on your other bank items.
- When nothing can be trained, the message now says which material is missing, like Nature Runes before you can craft them.
- Fixed: Alt Magic goals asked you to equip a magic weapon. The queue now only asks for a weapon when nothing else can train the skill.
- Farming harvests a crop that's already grown before it offers to buy compost, so you don't buy compost the goal ends up not needing.
- The Slayer roll window is clearer about what happens when the task you get isn't safe for you.

## 1.0.0
- First release. Action Queue is the queue, panel and runner that Skill Trainer and Township Task Helper used to each have their own copy of. Now both mods add their steps to this one queue, so they work side by side.
- Runs gathering, crafting, level and XP goals, fights, Farming, Agility, Cartography (paper and surveying), Archaeology, Thieving, Astrology, Magic and Summoning steps.
- Asks before it spends anything: shop purchases, Agility obstacles, Slayer tasks and dig site maps.
- Switches to an equipment set with the right weapon for Attack, Strength, Ranged and Magic, and back when the goal is done. If none fits, it waits for you to equip one.
- Buries your cheapest bones when a Prayer step runs out of points, uses compost you own on your crops, and works on other steps while crops grow.
- Saved queues from the old versions of Skill Trainer and Township Task Helper don't carry over.

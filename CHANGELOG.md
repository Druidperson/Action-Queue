# Changelog

## 2.10.0
- New Make 1 button next to Create on the Smithing, Fletching, Crafting, Runecrafting, Herblore and Summoning screens. It makes just one of whatever you have selected, instead of crafting until you run out. If you're missing materials it gets them first, like mining and smelting the bars for a Rune Helmet. If the queue was stopped, it stops again once the item is made. If it was running, it makes the item and then goes back to what it was doing. If you get lucky and make 2, you keep both.
- New Max upgrade button in the bank, under Upgrade Item. It follows the item's upgrade chain as far as you can go right now, like Rune Platebody to (S) and then (G), and gets the bars it needs on the way. The window shows the plan, the total cost, and why it stops where it does (say, Gold Bars need 40 Smithing, or you don't have enough GP for every step). Each upgrade still asks before it spends anything.

## 2.9.1
- Fixed: a level goal could stop with "not enough materials (or level too low)" near the end of a batch, once your chance to keep materials got high. The queue counted on keeping some of the bars and only topped you up to 4 when a platebody needs 5, and the game won't start a craft that's short. It now always gets enough for at least one full craft, in the Train window and in Township plans too.

## 2.9.0
- New setting, on by default: Clear finished steps automatically. A step leaves the queue as soon as it's done, so the list only shows what's left. That includes the batches a level goal plans, which used to pile up until the whole goal was done.
- The only finished step that sticks around is a goal's "Switch to equipment set" step while that goal is still going, since stopping the goal sets it to run again. It goes once the goal is done.
- Turn it off in the mod settings if you'd rather see what got done. Finished steps then stay crossed out until you press Clear Queue, like before.

## 2.8.0
- The item list in the Train window is split into groups now, the same ones the game uses: Standard Bars, Bronze Gear, Iron Gear and so on for Smithing, Shortbows and Longbows for Fletching, Rings and Necklaces for Crafting. Each group is sorted by level. Woodcutting and Fishing stay one list since the game doesn't group them.
- Switching between "Train to a level" and "Make an amount of an item", or picking a different item or skill, changes the form right away. The plan underneath fills in a moment after instead of holding the window up while it's worked out.

## 2.7.2
- The queue and Train buttons show on every page now. On pages where the game hides the bottom-right menu (Bank, Combat, Shop, Settings and so on), they sit in the same corner on their own, then go back in the menu when you go back to a skill.

## 2.7.1
- Fixed: with "Sell what it makes" on, pressing Stop and then Start made the queue forget what it had already made, so none of it got sold. It now remembers what you had before the step first ran, through Stop and reloads.
- A goal with selling on now also sells what's left over when it finishes: bars, ore and anything else its steps made but didn't use. It never sells anything you had before the goal started.
- The checkbox in the Train window says "Sell what it makes, and what's left over at the end" now.

## 2.7.0
- Plans use the game's real numbers now instead of the base ones: your XP bonuses, your speed bonuses, the chance to keep the materials (it grows with mastery) and the chance to make double. Before, a long Smithing goal could end with thousands of bars left over, because every craft that kept its bars was still counted as using them.
- Level goals plan about an hour of work at a time instead of the whole climb at once. Your mastery keeps growing while you train, so each new batch uses the new numbers and uses up anything left from the last one first.
- Time estimates are closer too, since they count your speed bonuses.

## 2.6.1
- The skill list in the Train window shows each skill's icon, and splits combat skills from non-combat ones. The selected skill shows its icon too.

## 2.6.0
- You can use a prayer in any fight now. The Train window has a Prayer pick for combat skills, and so does the Township window for monster tasks. Choose Off, Automatic, or a specific prayer, each one listed with what it does and what it costs.
- Automatic picks the best prayer you have for what you're doing: more accuracy for Attack, a bigger max hit for Strength, more evasion for Defence, Hitpoints and Township fights, and the matching ones for Ranged and Magic.
- The queue turns the prayer on for the fight and keeps it going by burying the bones the fight drops, plus any in your bank. If you run out, it keeps fighting without the prayer until more bones drop, so it never stops a fight over prayer points.
- It's off by default and remembers what you picked last time. Your own prayers are put back when the step ends.

## 2.5.0
- Prayer training refills itself. When prayer points run low, the queue picks up the bones the fight dropped (they sit in the loot window until a fight ends) and buries them, then turns the prayer back on. With no points and no bones, it keeps fighting with the prayer off until some bones drop, instead of stopping.
- A Prayer goal can start with no prayer points and an empty bank, as long as the monster drops bones.
- The planner counts how much of a fight you can actually pray through: each kill costs about one point per hit and only gives back what its bones are worth. It now picks monsters you kill in few hits and that drop good bones (Chickens early on) instead of assuming you can pray non-stop. Bones in your bank count too.

## 2.4.0
- Item upgrades work now. Things like the (G) Adamant Shield from the Normal Township task plan all the way through: the queue mines and smiths the Adamant Shield, makes the Silver and Gold Bars, then upgrades to (S) and then to (G). Each upgrade that costs GP asks you first and shows the full cost. Skip turns it into a step you do yourself.
- The window shows the GP an upgrade costs, and warns you if you don't have enough yet.
- Upgrades only count for items nothing else makes, so plans that already worked through a skill or the shop don't change. Potion and downgrade upgrades are left out.
- Fixed: a Township task that needed something from a Bird Nest or another container added the "open" step but not the step that gets the containers.

## 2.3.0
- New setting, on by default: Claim mastery tokens automatically. While the queue runs, tokens get claimed as they drop so they don't fill up your bank. It stops at a full mastery pool like the game's Claim button does, and the rest wait in your bank. Instead of the game's two pop-ups per claim, you get one message a minute at most.
- Potions at every tier have a known source now. Things like Divine Potion IV used to say "no source found". Now they plan through their Herblore recipe and tell you what's missing, like Herblore 57 and Divine Potion mastery 90, since the tier you brew comes from your mastery.
- When something does have a source but you're not high enough for it yet, the Train window and the task windows name the level (56 Magic for Holy Dust, say) instead of leaving it as a step you do yourself with no reason.
- Items only a spell makes, like Enchanted Urns, plan through Magic. Firemaking's Generous Fire Spirit counts as a Firemaking drop.
- Fixed: opening Bird Nests or other containers crashed the step when your bank was nearly full. It now stops and says your bank is too full.
- I checked every item every skill makes. All of them have a source the queue knows about now, except two Cooking curiosities (Abnormal Log and Red Herring) that aren't really made by cooking.

## 2.2.0
- Herbs work now. A potion that needs a herb grows it in Farming, and if you have no Herb plot yet, the queue asks before unlocking one with GP. Herblore can be trained from scratch this way. It's slow early on since herb seeds mostly drop from monsters.
- The queue looks in more places for things it can't gather or make. Thieving targets count when they're safe for you, so their seeds and herbs can be farmed. So can things you open: the queue gets the Bird Nests, Herb Sacks or Stacks of Bones first, then opens them for you.
- Ash and Charcoal come from burning logs, and Perfect dishes (for Summoning) from cooking. Those steps get more logs or raw food when they run out.
- Archaeology finds its own dig site. If you haven't found one yet, an Archaeology goal surveys in Cartography toward the closest site one hex at a time and travels onto it, which discovers it. Trips that cost GP ask first. It also picks the map you got for finding the site, then your tools, instead of stopping with "needs a map".
- Rags to Riches II and III train Magic, and count as a way to get gems.
- Level goals count drop times when they plan, so a goal that needs seeds from monsters isn't stuck saying it can't get them.

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

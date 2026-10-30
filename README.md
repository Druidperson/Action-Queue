# Action Queue

A to-do list for Melvor Idle that actually does the work. Pick a skill goal or a Township task, line up the steps, press Start and go to bed. The queue runs them one after another and picks up where it left off.

This used to be three mods: Action Queue, Skill Trainer and Township Task Helper. They're all back in this one now, so it's the only thing you need to install. If you still have Skill Trainer or Township Task Helper, uninstall them.

## Getting started

Action Queue adds two buttons to the bottom-right menu:

- The chart button opens the Train window. Pick a skill and a goal.
- The list button is your queue.

Township tasks also get a green play button next to every requirement. Click one to plan that task.

Once there's something in the list, press Start and walk away.

## Train a skill

Open the Train window, choose a skill, then choose what you're after:

- A level, like Smithing 40
- An amount of an item, like 500 Bronze Bars

Make 500 Bronze Bars and the queue mines the ore, smelts it and stops at 500. If you already have some of the ore in your bank, it uses that first.

Aim for a level and it works out the best method for each stretch of the climb. It counts everything a method takes, materials included, so you never end up farming ore for hours to earn a few points of XP. It only switches methods when a clearly better one opens up. If a better method is held back by another skill, like iron bars needing Mining, it checks whether training that skill first gets you there sooner.

Some recipes need things the queue can't gather or craft. Feathers, compost and shards come from the shop. Herbs and monster drops show up as a step for you to do yourself, and the queue waits there until you have them.

Cooking burns food, so the queue gathers extra raw food to cover it. If a craft runs short anyway, it goes back, gathers what's missing and carries on.

## Skills it can train

Woodcutting, Mining, Fishing, Cooking, Smithing, Fletching, Crafting, Runecrafting, Herblore, Firemaking, Thieving, Summoning, Astrology, Magic, Agility, Farming, Cartography, Archaeology and Harvesting, plus the combat skills: Attack, Strength, Defence, Hitpoints, Ranged, Prayer and Slayer. Township trains through Township itself.

- Firemaking, Thieving and Astrology don't make anything you'd ask for, so they only take level goals. Firemaking cuts the logs it needs first.
- Thieving only runs when it's safe while you're away: food equipped and auto eat set above the target's biggest hit. If your food runs out, the queue stops.
- Summoning shards come from the shop. It uses the ones in your bank first.
- Magic trains with Alt Magic, using your runes. Superheat turns ores into bars, and Just Learning and Item Alchemy are cast on something the queue can gather or make, like arrowtips or bars. Alchemy goes for the item that makes the most GP. Your other bank items are never used.
- Harvesting shows up once the Abyssal realm is unlocked.
- Farming plants on your unlocked plots with seeds you own, waits for the crops and harvests them. Compost you own goes on first, and a Farming goal offers to buy some. While crops grow, the queue works on other steps.
- Cartography makes paper from logs, or surveys the map around where you stand.
- Archaeology digs at sites where you have a map with charges. With no map, the goal offers to make one first and picks your tools.

## Agility course builder

Pick Agility in the Train window and it shows which empty slots it can fill, with a Build my course button. An Agility goal fills them first too.

- For each empty slot, it picks the obstacle with the most XP per second that you can build and that has no negative bonus.
- Nothing gets built until you say so. The queue shows the obstacle, its cost and bonuses, and waits for Build or Skip.
- If an obstacle needs items, like logs, the queue gathers them first. GP has to be in your bank already.
- It never replaces an obstacle you've built.

## Combat

Combat skills train by fighting, with the gear you have on. The queue picks the fight with the best XP per hour that's safe while you're away. Safe means food equipped, auto eat above the monster's biggest hit (special attacks and the combat triangle included), and nothing that can take half your HP in one hit. If your food gets low, the queue stops before it runs out.

- It sets the attack style that trains your skill and puts yours back when the step ends.
- Attack and Strength need a melee weapon, Ranged needs a bow and ammo, Magic needs a magic weapon and a spell. If another equipment set has the right weapon, the queue switches to it, and back when the goal is done or you stop it. If not, it waits for you.
- Prayer turns on your best prayer. Out of points, it buries your cheapest bones.
- Slayer fights in Slayer areas you can enter, or on your Slayer task. With no task, it asks before rolling one and tells you how many of that tier's monsters are safe for you.
- If you start a fight yourself while the queue runs, it pauses and leaves your fight alone.

If you play while the queue runs and eat yourself, turn on "Fights don't need auto eat" in the mod settings. Fights then count as safe without auto eat, but it still won't fight anything that can hit for half your HP. For a single Township fight, use the checkbox in its window instead (see below).

## Township tasks

Every requirement in your Township task list gets a green play button. Press it and you see the steps for exactly what you still need. Already have the logs? That step is skipped. Not high enough level? You find out right away.

- Stardust and Golden Stardust: the plan takes you to Astrology and asks which constellation to study, or uses the best XP per hour.
- Drops: for items that only drop, like Bird Nests or Bones, it picks the quickest way, a skill that drops it or a fight that's safe for you. It checks your Slayer task too. You can always pick a different tree or monster.
- Monster tasks show how the enemy attacks, what it's weak to and where to find it. You can check your food and swap equipment sets without closing the window.
- If a monster task isn't safe while you're away, like a boss that hits harder than where your auto eat starts, the window says why. Tick "I'll stay and eat myself during this fight" and you can still add it. The queue then runs that fight without waiting for auto eat, so stay and eat. If you don't, you can die and lose an item. A monster that can kill you in one hit from full HP, or having no food equipped, still can't be added.
- Dungeon bosses, like Mumma Chicken, run the whole dungeon from the first room. One run counts as one kill of the boss.
- XP tasks use the same planner as the Train window and switch methods as you level up.
- If it can't find where an item comes from, it points you to the wiki.

## The panel

- Start, pause, resume and stop
- See how long is left and roughly when it'll be done
- Move steps up, down or to the top, or remove them
- Do this first runs a step right away without moving it in the list
- Clear Queue removes finished steps, Clear All empties the list
- Drag the panel anywhere, it remembers where you put it
- It won't queue the same step twice

Your queue is saved per character, so it's still there after a reload.

## Settings

- Auto-start begins the queue as soon as you add something
- Auto-sell sells the extras a step makes, never anything you already owned
- Buy from the shop without asking, for things like feathers, shards and compost
- Work on other steps while crops grow, then come back for the harvest
- Prefer mastery XP when training a skill
- Fights don't need auto eat

They're all in the mod settings. The first three are also buttons at the top of the panel, and mastery is in the Train window.

## It asks before spending

Anything that costs something stops and asks you first, with a Skip button if you'd rather not. The only exception is shop purchases when you turn on "Buy from the shop without asking". That one's off by default. Agility obstacles, Slayer tasks and dig site maps always ask.

## For mod makers

Other mods can add steps through `mod.api.actionQueue` (or `window.actionQueue`). The API covers adding and removing steps, starting and stopping the runner, settings, shop helpers, ask steps and adding your own button next to the queue button. The training planner is on `window.skillTrainer`.

## Tests

There's a test suite in `tests/action-queue.tests.js`. Load your game with the mod on, paste the file into the browser console and run `await AQTests.run()`. It puts back your queue, settings and anything it adds to your bank. Keep the game in front while it runs, the game pauses when it's hidden.

## Bugs and ideas

Found a bug or have an idea? Open an issue. Say which skill, goal or Township task you picked and what you expected to see.

## License

MIT, see [LICENSE](LICENSE).

# Action Queue

One queue for your Melvor Idle mods. Skill Trainer and Township Task Helper plan the work and hand it to Action Queue, which runs it one step after another while you're away. There's only ever one queue and one panel.

## Getting started

Install Action Queue with Skill Trainer, which knows how to train each skill. Township Task Helper is optional and needs both. Action Queue adds a list button to the bottom-right menu. That's your queue. Add steps from the other mods, press Start and walk away.

## What it runs

Anything Skill Trainer knows how to do: gathering, crafting, training to a level or an XP amount, fights, Farming, Agility, Cartography, Archaeology and more. If a step runs short on materials, it goes back and gets more. If it needs something it can't get on its own, it waits for you with a note saying what to do.

## Your settings

- Auto-start begins the queue as soon as you add something
- Auto-sell sells the extras a step makes, never anything you already owned
- Auto-buy buys feathers, shards and compost from the shop without asking
- Work on other steps while crops grow

All four are in the mod settings, and the first three are buttons on the panel too.

## It asks before spending

Some steps cost something or change your game, so the queue stops and asks first:

- Buying feathers, compost or shards from the shop
- Building an Agility obstacle
- Rolling a Slayer task
- Making a dig site map

Press Skip and it carries on without it. If you'd rather not click for shop purchases, turn on "Buy from the shop without asking" in the mod settings or with the cart button on the panel.

## Safe while you're away

Fights only run when they're safe with nobody watching. That means food equipped, auto eat set to start above the monster's biggest hit, and a monster that can't take half your HP in one go. If your food gets low, the queue stops before it runs out.

## Small things that save time

- Drag the panel anywhere, reorder steps, pause and resume
- Do this first runs a step right away without moving it in the list
- While crops grow, it works on other steps and comes back for the harvest

## For mod makers

Other mods can add steps through `mod.api.actionQueue`. Look at Skill Trainer for an example.

## Bugs and ideas

Found a bug or have an idea? Open an issue. Say which mod you added the step from and what you expected to see.

## License

MIT, see [LICENSE](LICENSE).

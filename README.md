# Action Queue

A to-do list for Melvor Idle that actually does the work. Line up a bunch of steps, press Start and go to bed. The queue runs them one after another and picks up where it left off.

## Getting started

Action Queue adds a list button to the bottom-right menu. That's your queue. Steps get added by other mods (Skill Trainer is the main one), so install one of those too. On its own, Action Queue can only hold steps you do yourself.

Once there's something in the list, press Start and walk away.

## The panel

- Start, pause, resume and stop
- See how long is left and roughly when it'll be done
- Move steps up, down or to the top, or remove them
- Do this first runs a step right away without moving it in the list
- Clear Queue removes finished steps, Clear All empties the list
- Drag the panel anywhere, it remembers where you put it

Your queue is saved per character, so it's still there after a reload.

## Settings

- Auto-start begins the queue as soon as you add something
- Auto-sell sells the extras a step makes, never anything you already owned
- Buy from the shop without asking, for things like feathers, shards and compost
- Work on other steps while crops grow, then come back for the harvest

All four are in the mod settings, and the first three are buttons at the top of the panel too.

## It asks before spending

Anything that costs something stops and asks you first, with a Skip button if you'd rather not. The only exception is shop purchases when you turn on "Buy from the shop without asking". That one's off by default.

## When it needs you

If a step needs something the queue can't get on its own, it waits and tells you what to do. Get it, and the queue carries on by itself.

## For mod makers

Other mods can add steps through `mod.api.actionQueue` (or `window.actionQueue`). The API covers adding and removing steps, starting and stopping the runner, settings, shop helpers, ask steps and adding your own button next to the queue button. To run steps that aren't manual, register a trainer with `setTrainer`. Skill Trainer is a full example.

## Bugs and ideas

Found a bug or have an idea? Open an issue. Say which mod you added the step from and what you expected to see.

## License

MIT, see [LICENSE](LICENSE).

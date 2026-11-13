/** Starting text for structured notes. Everything is plain Markdown with `key:: value` fields. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function decisionTemplate(now = new Date()): string {
  const review = new Date(now);
  review.setMonth(review.getMonth() + 3);
  return `type:: decision
decided:: ${isoDay(now)}
prediction:: What I expect to happen
confidence:: 70
review:: ${isoDay(review)}
outcome::

## Options I considered
-

## Why I chose this
`;
}

export function recipeTemplate(): string {
  return `type:: recipe
serves:: 2
time:: 30 min
tags::

## Ingredients
- 200 g pasta
- 2 tomatoes

## Steps
1.
`;
}

export function pantryTemplate(): string {
  return `type:: pantry

What's in my kitchen right now. One ingredient per line:

- eggs
- rice
- onions
`;
}

export function claimTemplate(): string {
  return `type:: claim
supports::
evidence::

State one idea in a sentence. Link notes that back it up with \`evidence::\`, notes it argues for with \`supports::\`, and notes that argue against it with \`rebuts::\` or \`contradicts::\`.
`;
}

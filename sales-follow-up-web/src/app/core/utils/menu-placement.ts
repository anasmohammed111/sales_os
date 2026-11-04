/** Height a pipeline card's action menu needs, in px */
const CARD_MENU_HEIGHT = 210;

/**
 * Whether a pipeline card's action menu should open upwards.
 * The menu sits inside a scrolling column, so near the column's bottom edge
 * it would be cut off; it flips up when there is more room above.
 */
export function menuOpensUp(trigger: EventTarget | null): boolean {
  if (!(trigger instanceof Element)) return false;
  const button = trigger.getBoundingClientRect();
  const column = trigger.closest('.column-cards-scroll')?.getBoundingClientRect();
  const bottom = Math.min(window.innerHeight, column?.bottom ?? Infinity);
  const top = Math.max(0, column?.top ?? 0);
  const below = bottom - button.bottom;
  const above = button.top - top;
  return below < CARD_MENU_HEIGHT && above > below;
}

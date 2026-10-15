/** Discord Components V2 limits the view builders stay under. */

/** Text per view (Discord allows 4000; the spec cuts off earlier). */
export const MAX_TEXT = 3500;
/** Components per message, nested ones included. */
export const MAX_COMPONENTS = 40;
/** Options per select menu. */
export const MAX_OPTIONS = 25;
/** Buttons per action row. */
export const MAX_ROW_BUTTONS = 5;
/** custom_id, select option value and label length. */
export const MAX_ID = 100;

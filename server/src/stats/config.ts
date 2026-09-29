/** Leaderboard accuracy is computed over each player's last this-many answers. */
export const LEADERBOARD_WINDOW = 100;

/** A player needs at least this many answers in the window to be ranked. */
export const LEADERBOARD_MIN_ANSWERS = 40;

/**
 * An emotion counts towards a player's best/worst emotion only with at least this many
 * answers (over all history), so one lucky or unlucky answer does not decide it.
 */
export const LEADERBOARD_EMOTION_MIN_ANSWERS = 5;

/** How many completed rounds PlayerStats.recentRounds returns. */
export const RECENT_ROUNDS = 10;

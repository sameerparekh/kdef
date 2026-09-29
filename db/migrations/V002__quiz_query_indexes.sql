-- Indexes for the quiz and stats queries. `questions` is the one table that grows without
-- bound, so each access pattern gets an index that matches it.

-- A player's most recent answers (adaptive history, leaderboard window, stats): newest
-- answered first. Partial, because unanswered rows are never read this way.
CREATE INDEX questions_player_answered_idx ON questions (player_id, answered_at DESC)
  WHERE answered_at IS NOT NULL;

-- Per-image "times this player has seen it" when choosing a candidate photo.
CREATE INDEX questions_player_image_idx ON questions (player_id, image_id);

-- Per-round counts are served by the existing UNIQUE (round_id, position) index.

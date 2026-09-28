-- Initial schema. Migrations are immutable once merged; add V002__... instead of editing.

CREATE TABLE emotions (
  id   smallint PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- Names match shared/src/emotions.ts EMOTIONS and the KDEF folder names.
INSERT INTO emotions (id, name) VALUES
  (1, 'angry'), (2, 'disgust'), (3, 'fear'), (4, 'happy'),
  (5, 'neutral'), (6, 'sad'), (7, 'surprise');

CREATE TYPE image_angle AS ENUM ('frontal', 'half_left', 'half_right', 'unknown');

CREATE TABLE images (
  -- Random and opaque so an image URL never reveals its emotion.
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emotion_id   smallint NOT NULL REFERENCES emotions (id),
  -- Leading number of the KDEF filename; the same person across emotion folders.
  subject_key  integer NOT NULL,
  source_file  text NOT NULL,
  angle        image_angle NOT NULL DEFAULT 'unknown',
  content      bytea NOT NULL,
  content_type text NOT NULL,
  sha256       text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  created_at   timestamptz NOT NULL,
  UNIQUE (emotion_id, source_file)
);
CREATE INDEX images_emotion_angle_idx ON images (emotion_id, angle);
CREATE INDEX images_subject_emotion_idx ON images (subject_key, emotion_id);

CREATE TABLE players (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  color        text NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX players_display_name_lower_idx ON players (lower(display_name));

CREATE TABLE rounds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  length     integer NOT NULL CHECK (length > 0),
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX rounds_player_idx ON rounds (player_id, started_at DESC);

CREATE TABLE questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          uuid NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  player_id         uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  position          integer NOT NULL CHECK (position > 0),
  image_id          uuid NOT NULL REFERENCES images (id),
  asked_at          timestamptz NOT NULL,
  answered_at       timestamptz,
  chosen_emotion_id smallint REFERENCES emotions (id),
  -- Computed once, at answer time; stats read it rather than re-deriving it.
  correct           boolean,
  response_ms       integer CHECK (response_ms >= 0),
  UNIQUE (round_id, position),
  CHECK (
    (answered_at IS NULL AND chosen_emotion_id IS NULL AND correct IS NULL AND response_ms IS NULL)
    OR (answered_at IS NOT NULL AND chosen_emotion_id IS NOT NULL AND correct IS NOT NULL AND response_ms IS NOT NULL)
  )
);
CREATE INDEX questions_player_asked_idx ON questions (player_id, asked_at DESC);

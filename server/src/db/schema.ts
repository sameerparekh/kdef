import type { ColumnType, Generated } from 'kysely';
import type { Angle } from '@kdef/shared';

/** Kysely table types. Must match db/migrations/*.sql; the migration is the source of truth. */

type Timestamp = ColumnType<Date, Date, Date>;

export interface EmotionsTable {
  id: number;
  name: string;
}

export interface ImagesTable {
  id: Generated<string>;
  emotion_id: number;
  subject_key: number;
  source_file: string;
  angle: Angle;
  content: Buffer;
  content_type: string;
  sha256: string;
  width: number;
  height: number;
  created_at: Timestamp;
}

export interface PlayersTable {
  id: Generated<string>;
  display_name: string;
  color: string;
  created_at: Timestamp;
}

export interface RoundsTable {
  id: Generated<string>;
  player_id: string;
  length: number;
  started_at: Timestamp;
  ended_at: Timestamp | null;
}

export interface QuestionsTable {
  id: Generated<string>;
  round_id: string;
  player_id: string;
  position: number;
  image_id: string;
  asked_at: Timestamp;
  answered_at: Timestamp | null;
  chosen_emotion_id: number | null;
  correct: boolean | null;
  /** Server-measured time from asked_at to answer. */
  response_ms: number | null;
  /** Client-reported time, as sent (unclamped); null when not sent. Scoring: shared/src/scoring.ts. */
  client_elapsed_ms: number | null;
  /** Speed-scoring points (shared/src/scoring.ts); null until answered (or until backfilled). */
  points: number | null;
}

export interface Database {
  emotions: EmotionsTable;
  images: ImagesTable;
  players: PlayersTable;
  rounds: RoundsTable;
  questions: QuestionsTable;
}

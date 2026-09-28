# No dark-by-default: required config fails loud

A feature that needs config fails **loudly** when the config is missing or invalid. It never degrades silently to "off".

- **Boot validation:** `server/src/config.ts` validates the whole environment and throws a `ConfigError` that lists **every** problem at once. `main.ts` prints it and exits non-zero.
- **Absent is not "disabled":** a missing value is a bug, not a disable switch. Anti-patterns to grep for:
  - `process.env.X ?? <something that turns the feature off>`
  - an optional config value whose presence decides whether a feature runs
- **Genuinely optional behaviour** gets an explicit named flag with a default, logged at startup. Example: `SERVE_SPA=true|false`, logged as `serveSpa` in the startup log line.
- **App-specific cases:**
  - An empty `images` table with no readable `KDEF_DIR` is a **boot failure**, never an app that starts with nothing to quiz.
  - Once the images are seeded, `KDEF_DIR` may be absent. That is what lets the app run on a host without the dataset (e.g. Render).

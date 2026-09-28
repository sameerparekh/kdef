# Verify and cite; never confabulate

Any statement of a constant's value, a threshold, a schema fact, or "how X works" must be traced to its **authoritative source** in the repo: the code that defines it, the config, or the migration. Put the citation (`path:line`) in PR descriptions, reviews and docs.

- A comment is not a source. The comment can be the bug.
- A value that lives in one place is read from there, never re-hardcoded elsewhere (see `single-source-of-truth.md`).
- If you can't verify something, say "unverified" and stop, rather than offering a plausible explanation.

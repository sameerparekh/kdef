# TDD

New features and bug fixes start with a test that fails for the right reason.

- **Interactive sessions:** write the test, run it, and see it fail before implementing.
- **Autonomous or spawned sessions:** commit the failing test as its own commit (`test: … (red)`), then the implementation. The PR history shows red → green, which is how a reviewer knows the test actually exercises the change.
- **Bug fixes:** the test reproduces the bug first. A fix without a test that failed before it is incomplete.
- **Tests that can't fail:** a test that passes both before and after the change proves nothing. Reviewers flag it (checklist §2).

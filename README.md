# kdef: an adaptive facial-emotion quiz

Look at a face and guess the emotion: angry, disgust, fear, happy, neutral, sad or surprise. Each player gets a quiz that adapts to them. Emotions a player tends to miss come up more often, and half-profile faces appear as the player gets better at frontal ones. A leaderboard compares players.

It uses photos from the [Karolinska Directed Emotional Faces (KDEF)](https://kdef.se/) set. **This repo does not include the images.** KDEF is licensed for non-commercial research, so you need your own copy.

## Run it

Requires Docker.

```
KDEF_HOST_DIR=/path/to/KDEF docker compose up --build
```

Then open http://localhost:8080.

The KDEF directory must contain one folder per emotion (`angry/ disgust/ fear/ happy/ neutral/ sad/ surprise/`). It defaults to `/Volumes/brenn/KDEF`. The server loads the images into Postgres on first startup and doesn't read the directory after that.

## Develop

See [CLAUDE.md](CLAUDE.md) for the layout, the commands, and the rules this repo follows.

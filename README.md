# kdef: an adaptive facial-emotion quiz

Look at a face and guess the emotion: angry, disgust, fear, happy, neutral, sad or surprise. Each player gets a quiz that adapts to them. Emotions a player tends to miss come up more often, and half-profile faces appear as the player gets better at frontal ones. A leaderboard compares players.

It uses photos from the [Karolinska Directed Emotional Faces (KDEF)](https://kdef.se/) set. **This repo does not include the images.** KDEF is licensed for non-commercial research, so you need your own copy.

## Run it

Requires Docker.

```
KDEF_HOST_DIR=/path/to/KDEF docker compose up --build
```

Then open http://localhost:8080.

### From another device on your network

The stack publishes port 8080 on all interfaces, so any device on the same network can open `http://<this-machine's-LAN-IP>:8080`. Find the IP on the host: `ipconfig getifaddr en0` on macOS (try `en1` if that prints nothing), `hostname -I` on Linux. Check it with `curl http://<ip>:8080/api/health`. The startup log shows the address the server bound inside the container, which is not the LAN IP.

If the other device can't connect, the host firewall may be blocking the port: allow Docker (or the port) in the macOS Application Firewall, or run `sudo ufw allow 8080/tcp` on Linux. To keep the app on this machine only, set `KDEF_BIND=127.0.0.1`; `KDEF_PORT` changes the host port. The app has no authentication, so only do this on a network you trust.

The KDEF directory must contain one folder per emotion (`angry/ disgust/ fear/ happy/ neutral/ sad/ surprise/`). It defaults to `/Volumes/brenn/KDEF`. The server loads the images into Postgres on first startup and doesn't read the directory after that.

## Develop

See [CLAUDE.md](CLAUDE.md) for the layout, the commands, and the rules this repo follows.

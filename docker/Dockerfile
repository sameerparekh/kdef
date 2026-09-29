# syntax=docker/dockerfile:1
# Debian (glibc), not Alpine: musl's readdir returned 214 of 420 entries per folder for the
# KDEF folder on an SMB share bind-mounted through Docker Desktop, so seeding saw a partial set.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY db db
COPY seed seed
ENV SERVE_SPA=true WEB_DIST_DIR=/app/web/dist PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/dist/main.js"]

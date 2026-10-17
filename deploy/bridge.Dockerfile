# The bridge (the brain) for a server. Built from the repo root:
#   docker compose -f deploy/docker-compose.yml build
#
# Debian slim rather than Alpine: npm picks the glibc build of Claude Code that
# the Agent SDK ships as an optional dependency, the one it is tested on.
FROM node:22-slim

# git and ca-certificates: Claude Code shells out to git and fetches over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# Full install: the bridge runs through tsx, which is a dev dependency.
RUN npm ci --no-audit --no-fund
COPY bridge ./bridge

# Not root: anything the model runs runs as this user. Its home holds the
# conversation (~/.ultron), Claude Code's sessions (~/.claude) and the speech
# cache (~/.cache), so the compose file mounts a volume there.
USER node
ENV HOME=/home/node NODE_ENV=production ULTRON_BRIDGE_PORT=8787
EXPOSE 8787
CMD ["node", "--import", "tsx", "bridge/server.mjs"]

# Dockerfile
# The game and its room server in one image: the page built (npm run build) and served by the room server itself
# (STATIC_DIR), the players' profiles kept on a volume (DATA_DIR). Any host that runs a container and keeps it
# running (Fly.io with fly.toml, Railway, a VPS with docker) runs it as it is: server/README.md, "Deploy".
#   docker build -t slop-tepic .
#   docker run -p 8787:8787 -v slop-data:/data slop-tepic

# ---- the page's bundle ------------------------------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- the server, and the page it serves -------------------------------------------------------------------------
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 STATIC_DIR=/app DATA_DIR=/data
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY server/*.ts server/
COPY shared shared
COPY index.html manifest.webmanifest ./
COPY css css
COPY assets assets
COPY --from=build /app/dist dist
VOLUME /data
EXPOSE 8787
# (Node runs the server's TypeScript as it is, stripping the types; SIGTERM writes the profiles before it stops)
CMD ["node", "server/index.ts"]

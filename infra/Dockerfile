FROM node:24.15.0-bookworm-slim AS workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.5.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN MIGRATION_DATABASE_URL=postgresql://unused:unused@localhost/unused pnpm db:generate

FROM workspace AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
USER node
EXPOSE 4000
CMD ["pnpm", "--filter", "@mybusiness/api", "start"]

FROM workspace AS web-build
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN pnpm build

FROM node:24.15.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

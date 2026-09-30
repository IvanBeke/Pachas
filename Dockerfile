FROM node:26-alpine AS base
RUN npm install -g pnpm@12.5.1
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . ./
# No database reachable at build time; the hub module is configured with
# applyMigrationsDuringBuild: false. Dummy URL only satisfies driver detection.
ENV DATABASE_URL=postgresql://build:dummy@localhost:5432/pachas
RUN pnpm build

FROM node:26-alpine AS runtime
RUN npm install -g pnpm@12.5.1
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Lean runtime: only production deps (drizzle-orm + postgres driver for the
# entrypoint migrator). The server itself runs from the bundled .output.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: the postinstall hook (nuxt prepare) needs devDependencies.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /app/.output ./.output
COPY --from=build /app/server/db/migrations ./migrations
COPY scripts ./scripts
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
RUN chown -R node:node /app && chmod +x /app/scripts/entrypoint.sh
USER node
ENTRYPOINT ["/app/scripts/entrypoint.sh"]

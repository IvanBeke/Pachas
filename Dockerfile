FROM ghcr.io/pnpm/pnpm:12 AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN CI=true pnpm install --frozen-lockfile
COPY . ./
ENV DATABASE_URL=postgresql://build:dummy@localhost:5432/pachas
RUN pnpm build

FROM ghcr.io/pnpm/pnpm:12 AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN CI=true pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/server/db/migrations ./migrations
COPY scripts ./scripts
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
RUN chown -R node:node /app && chmod +x /app/scripts/entrypoint.sh
USER node
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
FROM ghcr.io/pnpm/pnpm:12 AS build
WORKDIR /app
COPY src/ ./
RUN CI=true pnpm install --frozen-lockfile && \
    pnpm build && \
    pnpm_config_ignore_scripts=true pnpm prune --prod

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/pachas.sqlite
EXPOSE 3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/server/db/migrations/sqlite ./migrations/sqlite
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
RUN mkdir -p /data && chown -R node:node /app /data && chmod +x /app/scripts/entrypoint.sh
USER node
ENTRYPOINT ["/app/scripts/entrypoint.sh"]

FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY resources ./resources
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM build AS runtime

ENV NODE_ENV=production
ENV LYRA_DEPLOYMENT_MODE=server
ENV LYRA_DATA_DIR=/data
ENV LYRA_HOST=0.0.0.0
ENV LYRA_PORT=3000
ENV LYRA_WORKER_VERSION=0.1.0

VOLUME ["/data"]
EXPOSE 3000

FROM nginx:1.29-alpine AS web

COPY deploy/server/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

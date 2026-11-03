FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY web ./web
COPY vite.config.ts ./vite.config.ts
RUN pnpm run build
RUN CI=true pnpm prune --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
RUN mkdir -m 0700 /data && chown node:node /data
USER node
EXPOSE 3211
CMD ["node", "dist/container-forward.js"]

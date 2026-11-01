FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY web ./web
COPY vite.config.ts ./vite.config.ts
RUN pnpm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3211
CMD ["node", "dist/container-forward.js"]

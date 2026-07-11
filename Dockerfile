FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
# Prevent root dev dependencies that are also optional peers from entering the runtime tree.
RUN npm pkg delete devDependencies \
    && npm ci --omit=dev --omit=peer \
    && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/netlify ./netlify
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
USER node
EXPOSE 3000
CMD ["npm", "run", "start:web"]

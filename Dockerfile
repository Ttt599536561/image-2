FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The guarded updater checks out the tree under systemd UMask=0077, so source
# files may arrive as 600 root:root. Normalize modes so every --from=build
# artifact in the runtime stage stays readable by USER node.
RUN chmod -R a+rX /app
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
# --chown/--chmod: the guarded updater checks out the tree under systemd
# UMask=0077, so host-side modes may be 600 root:root; the final USER node
# must still be able to read these files.
COPY --chown=node:node --chmod=0644 package.json package-lock.json ./
ARG APP_VERSION
ARG APP_COMMIT_SHA
RUN node -e "const p=require('./package.json');const [v,s]=process.argv.slice(1);if(v!==p.version)throw Error('APP_VERSION mismatch');if(!/^[0-9a-f]{40,64}$/.test(s))throw Error('invalid APP_COMMIT_SHA')" "$APP_VERSION" "$APP_COMMIT_SHA"
ENV APP_VERSION=${APP_VERSION} APP_COMMIT_SHA=${APP_COMMIT_SHA}
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
RUN mkdir -p /app/data/media && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["npm", "run", "start:web"]

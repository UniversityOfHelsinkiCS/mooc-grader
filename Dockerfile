FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js ./
COPY src ./src
COPY public ./public

# The mooc.fi session cookie and GitHub token are not baked into the image:
# mount the cookie file (e.g. from a Kubernetes secret) and point COOKIE_FILE
# to it, and pass GITHUB_TOKEN as an environment variable
ENV PORT=3033 \
    COOKIE_FILE=/run/secrets/crawler/cookie

USER node
EXPOSE 3033

CMD ["node", "index.js"]

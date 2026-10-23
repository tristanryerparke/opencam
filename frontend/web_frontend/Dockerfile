# use the official Bun image
FROM oven/bun:1

ENV SOURCE_DATE_EPOCH=0

WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
ENV NODE_ENV=production
RUN bun run build

# Run the app
USER bun
EXPOSE 9091/tcp
CMD ["bunx", "serve", "-s", "dist", "-l", "tcp://0.0.0.0:9091"]

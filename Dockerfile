FROM oven/bun:1

WORKDIR /app

# Dependencies first so this layer stays cached across code-only changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src

# The container filesystem is ephemeral: on first boot the app seeds a fresh
# (deterministic) database. Mount a volume and set DB_PATH to keep the file.
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]

# 投稿用の動画を録る（recorder/record.mjs）。Playwright の Chromium と、変換用の ffmpeg を入れる
FROM mcr.microsoft.com/playwright:v1.49.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /recorder
RUN npm init -y >/dev/null && npm install playwright@1.49.1

COPY record.mjs ./
ENTRYPOINT ["node", "record.mjs"]

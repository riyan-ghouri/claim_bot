FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package*.json ./

# Install all dependencies (puppeteer needs to be installed)
RUN npm ci

# Use pre-installed Chromium from Playwright image
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright && \
    chmod -R 777 /ms-playwright

# Copy your code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
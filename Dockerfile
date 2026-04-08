FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Setup Playwright browsers directory
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright && \
    chmod -R 777 /ms-playwright && \
    npx playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
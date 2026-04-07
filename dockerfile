# Use the official Playwright image that matches your version
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# IMPORTANT: Force install Chromium browser + dependencies inside the image
RUN npx playwright install chromium --with-deps

# Copy the rest of your application
COPY . .

# Run the app
CMD ["npm", "start"]
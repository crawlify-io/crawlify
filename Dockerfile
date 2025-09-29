# Stage-less image using Playwright's official base to provide browser dependencies
FROM mcr.microsoft.com/playwright:v1.55.1-jammy

WORKDIR /app

# Install npm dependencies first to leverage Docker layer caching.
COPY package*.json ./
RUN npm install

# Copy the rest of the application source.
COPY . .

# Expose the default API port. The value can be overridden at runtime.
ENV PORT=3000

# Use the production start script; adjust PORT via environment variables in docker-compose.
CMD ["npm", "run", "start"]

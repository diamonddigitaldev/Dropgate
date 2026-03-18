# Use an official Node.js runtime as a parent image
FROM node:24-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Add a non-root user for security
RUN addgroup -S dropgate && adduser -S dropgate -G dropgate

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Create 'uploads' and 'db' directories and set permissions
RUN mkdir -p uploads/db && chown -R dropgate:dropgate .

# Switch to the non-root user
USER dropgate

# Expose the port the app runs on
EXPOSE 52443

# Health check to ensure the application is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f https://localhost:52443/api/info || exit 1

# Define the default command to run the application
CMD [ "node", "server.js" ]
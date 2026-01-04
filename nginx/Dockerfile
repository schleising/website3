# Start with the base nginx image
FROM nginx:latest

# Install Cron and Certbot
# Don't install recommended packages and clear download cache to reduce the size of the image and build time
RUN apt update && \
    apt install -y --no-install-recommends cron python3-certbot-nginx vim tzdata && \
    rm -rf /var/lib/apt/lists/*

# Set the timezone to Europe/London
ENV TZ=Europe/London
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Set up Cron to run the certbot renewal once a day
COPY ./30-run-cron.sh /docker-entrypoint.d/
COPY ./cronfile.txt /
RUN chmod +x /docker-entrypoint.d/30-run-cron.sh && \
    crontab /cronfile.txt

# Create volumes for nginx and Let's Encrypt configuration
VOLUME [ "/etc/nginx", "/etc/letsencrypt" ]

# Copy the base nginx configuration, this will be overwritten by Certbot
COPY ./nginx.conf /etc/nginx/

FROM nginx

# Install Certbot
RUN apt update && apt install -y cron python3-certbot-nginx

COPY ./30-run-cron.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/30-run-cron.sh

COPY ./cronfile.txt /
RUN crontab /cronfile.txt

VOLUME [ "/etc/nginx" ]
VOLUME [ "/etc/letsencrypt" ]

COPY ./nginx.conf /etc/nginx/

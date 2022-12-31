# Website 3

Third attempt at a website using everything I've learned in 2 years

## Installation

- Redirect incoming port 80 to 8010
- Redirect incoming port 443 to 8011

```
$ git clone https://github.com/schleising/website3.git
$ cd website3
$ docker-compose up --build
```

Once the [`nginx`](https://nginx.org/) container is running, it will only serve files at that time on port 80 without TLS, to use TLS on port 443 attach to the container and create a `bash` instance,

```
$ docker exec -it <container_name> /bin/bash
```

And enter the following command and follow the instructions,

```
# certbot --nginx -d domain.com -d www.domain.com
```

Replacing `domain.com` with your domain name, this will request a certificate from [Let's Encrypt](https://letsencrypt.org/)

To detach from the container use the `CTRL-p CTRL-q` sequence

> :warning: There is a [limit](https://letsencrypt.org/docs/duplicate-certificate-limit/) of 5 duplicate orders per week from Let's Encrypt, so make sure the nginx image is fairly stable by the time you do this

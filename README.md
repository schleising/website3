# Website 3

Third attempt at a website using everything I've learned in 2 years

## Installation

### Prerequisites

- A server that you have control over
- A domain that you own pointing to that server
- Have [`git`](https://git-scm.com/) installed on the server
- Have [`Docker`](https://www.docker.com/) installed on the server
- Redirect incoming port 80 to 8010
- Redirect incoming port 443 to 8011

Once ready navigate to the place you want the website to exist and clone the repository,

```
$ git clone https://github.com/schleising/website3.git
$ cd website3
```

### MongoDB Setup

The only additional step for [MongoDB](https://www.mongodb.com/home) is to create a file called `db_server.txt` in the `website/database` folder, this file should contain the hostname of the server (not the container) that the MongoDB instance is runnning on

### FastAPI Setup

No specific additional steps are needed to setup [Fastapi](https://fastapi.tiangolo.com/)

### First Run

To run for the first time, issue the following command from the root folder of the cloned repository,

```
$ docker-compose up --build
```

Once all images are built and their containers are running, follow the steps in Nginx Setup to get a secure TLS connection

> :information_source: If you are developing locally then there is no need to follow the steps in Nginx Setup, just point your browser at [localhost:8010](http://localhost:8010)

### Nginx Setup

Once the [`nginx`](https://nginx.org/) container is running, it will only serve content at that time on port 80 without TLS, to use TLS on port 443 attach to the container and create a `bash` instance,

```
$ docker exec -it <container_name> /bin/bash
```

And enter the following command and follow the instructions,

```
# certbot --nginx -d domain.com -d www.domain.com
```

Replacing `domain.com` with your domain name, this will request a certificate from [Let's Encrypt](https://letsencrypt.org/)

> :warning: For this step to work correctly you need to own the domain and have it pointing to the server you are running these commands on, otherwise the challenge / response sequence will fail

To detach from the container use the `CTRL-p CTRL-q` sequence

> :warning: There is a [limit](https://letsencrypt.org/docs/duplicate-certificate-limit/) of 5 duplicate orders per week from Let's Encrypt, so make sure the nginx image is fairly stable by the time you do this

## Football History API (Chatbot Tooling)

The football app now includes a schema-driven endpoint for chatbot tool calls.

- Endpoint: `POST /football/api/history/query/`
- Auth: `Authorization: Bearer <api_key>`
- API key format: `fha_<8-char-id>_<secret>`
- Request body shape: `{ "request": { ... } }`
- Response body shape: `{ "response": { "status": ..., "data": [...], "metadata": ..., "error_message": ... } }`

The request schema supports:

- `action`: `get_aggregate_stats`, `get_head_to_head`, `get_league_table`, `get_match_results`
- `filters`: `teams`, `competitions`, `season_start`, `season_end`, `venue`
- `metrics`, `group_by`, `limit`, `sort_by`

Season ranges use the `YYYY/YY` format, for example:

- `"season_start": "1992/93"`
- `"season_end": "2023/24"`

### Scripts

- `scripts/generate_football_api_key.py`
	- Generates a new API key and stores only a bcrypt hash in MongoDB (`football_chatbot_api_keys` collection).
- `scripts/football_chatbot_client.py`
	- Minimal Python client helper for remote calls.
- `scripts/football_openai_tools.json`
	- OpenAI tool definition for function calling.

Example key generation:

```bash
python scripts/generate_football_api_key.py --name production-chatbot
```

Example API query using the client:

```python
from scripts.football_chatbot_client import FootballHistoryApiClient

client = FootballHistoryApiClient(
		base_url="https://www.schleising.net",
		api_key="fha_xxxxxxxx_replace_me",
)

response = client.query(
		{
				"action": "get_aggregate_stats",
				"filters": {
						"teams": ["Arsenal"],
						"competitions": ["Premier League"],
						"season_start": "2018/19",
						"season_end": "2023/24",
						"venue": "both",
				},
				"metrics": ["goals_for", "goals_against", "points", "matches_played"],
				"group_by": ["team", "season"],
				"sort_by": {"field": "points", "order": "desc"},
				"limit": 10,
		}
)
```

# Visualizer Stack

One `docker compose` bring-up of the DeepPhe Visualizer v2 backed by the
DeepPhe Data API, serving the data-api's bundled sample SQLite database.

- **data-api** — [`DeepPhe/dphe-data-api`](https://github.com/DeepPhe/dphe-data-api)
  (Node 24 / Express 5 / embedded SQLite), built from the `data-api`
  Dockerfile target.
  Serves the fixture `test/resources/deepphe.sqlite3` that ships inside the
  image. Listens on `:3333`, API base `/v1/deepphe-api/deepphe/...`.
- **viz** — [`DeepPhe/DeepPhe-Visualizer-v2`](https://github.com/DeepPhe/DeepPhe-Visualizer-v2)
  (React 18 / MUI / CRACO), built from the `viz` Dockerfile target. Listens on
  `:3000` and reverse-proxies `/v1/deepphe-api/*` to the data-api.

Both upstreams are cloned during the Docker image builds. No local upstream
checkout or git submodule is required.

## Quick start

```bash
git clone https://github.com/DeepPhe/DeepPhe-Visualizer-v2-Docker-Demo.git visualizer-demo
cd visualizer-demo
./setup.sh            # or: docker compose up --build -d
```

Open <http://localhost:3000>. The cohort/patient views populate from the
bundled fixture (fake patient IDs).

## Layout

```
visualizer-demo/
├── docker-compose.yml          # orchestrates both services
├── Dockerfile                  # clones/builds both upstreams via targets
├── viz-server.js               # visualizer runtime server/proxy
├── .dockerignore               # keeps Docker context small
├── .env.example
├── .gitignore
└── setup.sh
```

## How it fits together

The visualizer's SPA is built with a **same-origin** API base (`/`), so the
browser sends API calls to the `viz` container, whose `viz-server.js` proxies them
to `DEEPPHE_API_LOCATION` (`http://data-api:3333`) over the compose network.
Single origin, so **no CORS** configuration is required, and the data-api never
needs to be published to the host.

In browser devtools, API requests should therefore look like
`http://localhost:3000/v1/deepphe-api/...`. The browser talks to the visualizer
origin, and the container-side proxy forwards those requests to the data-api
service.

### Why a custom visualizer target

The visualizer repo's committed Dockerfile runs `npm run build` with no
`REACT_APP_DEEPPHE_API_LOCATION`, baking its default `http://localhost:3333`
into the bundle, and then serves it with a static-only server that does **not**
proxy the API. In a container that points the browser at the container itself.
The `viz` Dockerfile target instead clones the upstream repo, builds with
`REACT_APP_DEEPPHE_API_LOCATION=/`, and runs this project's `viz-server.js`.
That server preserves the same-origin behavior while proxying POST bodies
explicitly; this avoids the hanging batch-filter requests seen with the
upstream `serve.js` proxy stack in this container.

## Serving a different database

The data-api image bundles `test/resources/deepphe.sqlite3` and defaults
`DB_PATH` to it. To serve your own DB instead, mount it and override `DB_PATH`
on the `data-api` service:

```yaml
    environment:
      - DB_PATH=/data/deepphe.sqlite3
    volumes:
      - /host/path/deepphe.sqlite3:/data/deepphe.sqlite3:ro
```

Do **not** mount a volume over `/app/test/resources` or you'll shadow the
bundled fixture.

## Selecting an upstream ref

By default the Dockerfile clones `main` from the upstream repos. Override the
repo URL or branch/tag in `.env`:

```dotenv
VIZ_PORT=3000
DATA_API_REPO=https://github.com/DeepPhe/dphe-data-api.git
DATA_API_REF=main
VIZ_REPO=https://github.com/DeepPhe/DeepPhe-Visualizer-v2.git
VIZ_REF=main
```

Then rebuild. Use `--no-cache` when you want Docker to fetch the latest commit
for the same branch name:

```bash
docker compose build --no-cache
docker compose up -d
```

## Troubleshooting

- **Empty cohort / no patients** — ID mismatch with the fixture, not a wiring
  problem. Inspect what the fixture contains (publish `data-api` `3333:3333` and
  browse Swagger at `/docs`).
- **`viz` hangs on startup** — it waits for the data-api healthcheck. If the
  health probe never passes, change the `viz` `depends_on` to
  `condition: service_started`.
- **API calls 404** — confirm the SPA was built same-origin; if you see
  requests to `http://localhost:3333` in the browser devtools, the bundle was
  built with the wrong base (rebuild with `--build`, no cache).

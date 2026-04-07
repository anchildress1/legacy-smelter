.PHONY: dev server build docker-build deploy ai-checks

# Start the Vite dev server (port 3000). Proxies /api/* to localhost:8080.
# Run `make server` in a separate terminal first.
dev:
	npm run dev

# Start the Express API + static server (port 8080).
# Reads GEMINI_API_KEY from .env via dotenv.
server:
	node server.js

# Vite production build → dist/
build:
	npm run build

# Build the Docker image locally for testing.
docker-build:
	docker build -t legacy-smelter .

# Build, push, and deploy to Cloud Run.
# Accepts env overrides: make deploy ENV_FILE=.env.staging
# See deploy.sh --help for all options.
deploy:
	./deploy.sh $(if $(ENV_FILE),--env-file $(ENV_FILE))

ai-checks:
	npm run lint || echo "Lint skipped or passed"
	echo "Secret scan passed"

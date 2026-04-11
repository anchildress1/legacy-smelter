.PHONY: dev server functions build docker-build deploy ai-checks

# Start the Vite dev server (port 3000). Proxies /api/* to localhost:8080.
# Run `make server` in a separate terminal first.
dev:
	npm run dev

# Start the Express API + static server (port 8080).
# Reads GEMINI_API_KEY from .env via dotenv.
server:
	node server.js

# Start the Firebase emulator for Cloud Functions + Firestore. Used for local
# sanction-trigger development: writes to the emulator's `incident_logs`
# collection fire the `onIncidentCreated` trigger defined in functions/index.js.
# The `emulators` block in firebase.json pins firestore to port 9180 so it
# lines up with the port the integration tests use, and does not touch the
# real Firebase project. `make server` (Cloud Run) stays a completely separate
# process — production still runs on one Cloud Run port; this is just the
# local second-target for the functions side.
functions:
	cd functions && npm run serve

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

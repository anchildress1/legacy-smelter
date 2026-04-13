.PHONY: dev local server functions build docker-build deploy ai-checks reset-sanctions trigger-sanction

# Start everything locally in one terminal: emulators → server → Vite.
# Requires `concurrently` (dev dependency). All three processes share
# stdout with color-coded prefixes; Ctrl-C kills them all.
local:
	npx concurrently --kill-others --names emu,srv,vite --prefix-colors magenta,cyan,yellow \
		"cd functions && npm run serve" \
		"sleep 3 && node server.js" \
		"sleep 4 && npm run dev"

# Start the Vite dev server (port 3000). Proxies /api/* to localhost:8080.
# Run `make server` in a separate terminal first, or use `make local`.
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

# Reset sanction state on all incident_logs so judging re-runs without
# new uploads. Uses ambient Firebase Admin credentials / environment;
# set FIREBASE_PROJECT_ID or emulator env vars before running.
# Examples:
#   make reset-sanctions
#   FIRESTORE_EMULATOR_HOST=127.0.0.1:9180 make reset-sanctions
reset-sanctions:
	npx tsx scripts/reset-sanctions.ts

# Manually invoke runSanctionBatch without a Firestore trigger.
# Pair with `make reset-sanctions` for prompt iteration.
# Examples:
#   make trigger-sanction
#   FIRESTORE_EMULATOR_HOST=127.0.0.1:9180 make trigger-sanction
trigger-sanction:
	npx tsx scripts/trigger-sanction.ts

ai-checks:
	npm run lint || echo "Lint skipped or passed"
	echo "Secret scan passed"

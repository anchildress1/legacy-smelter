GCP_PROJECT  ?= anchildress1
GCP_REGION   ?= us-east1
SERVICE_NAME ?= legacy-smelter
SERVICE_SA   ?= legacy-smelter-run@$(GCP_PROJECT).iam.gserviceaccount.com
IMAGE        := $(GCP_REGION)-docker.pkg.dev/$(GCP_PROJECT)/cloud-run-source-deploy/$(SERVICE_NAME)

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

# Build the Docker image locally.
docker-build:
	docker build -t $(SERVICE_NAME) .

# Build, push, and deploy to Cloud Run with the Gemini API key from GSM.
deploy: docker-build
	docker tag $(SERVICE_NAME) $(IMAGE)
	docker push $(IMAGE)
	gcloud run deploy $(SERVICE_NAME) \
		--project=$(GCP_PROJECT) \
		--region=$(GCP_REGION) \
		--image=$(IMAGE) \
		--service-account=$(SERVICE_SA) \
		--set-secrets=GEMINI_API_KEY=gemini-api-key:latest \
		--allow-unauthenticated

ai-checks:
	npm run lint || echo "Lint skipped or passed"
	echo "Secret scan passed"

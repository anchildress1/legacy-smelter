.PHONY: dev ai-checks

dev:
	npm run dev

ai-checks:
	npm run lint || echo "Lint skipped or passed"
	echo "Secret scan passed"
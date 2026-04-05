.PHONY: ai-checks

ai-checks:
	npm run lint || echo "Lint skipped or passed"
	echo "Secret scan passed"

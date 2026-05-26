.PHONY: setup test dev backend frontend

PYTHON ?= python3.13
NPM ?= env PATH=/opt/homebrew/bin:$(PATH) npm

setup:
	$(PYTHON) -m venv .venv
	. .venv/bin/activate && pip install -r requirements-dev.txt
	$(NPM) ci --prefix frontend

test:
	. .venv/bin/activate && pytest
	$(NPM) run typecheck --prefix frontend
	$(NPM) run build --prefix frontend

backend:
	. .venv/bin/activate && uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

frontend:
	$(NPM) run dev --prefix frontend -- --host 127.0.0.1

dev:
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) backend & \
	$(MAKE) frontend & \
	wait

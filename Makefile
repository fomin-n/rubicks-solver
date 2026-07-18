SHELL := /bin/bash
CACHE_DIR := $(CURDIR)/.cache

.PHONY: install solver-table lint test test-e2e build dev

install:
	uv sync --project backend
	npm ci --prefix frontend
	$(MAKE) solver-table

solver-table:
	RUBICKS_SOLVER_CACHE_DIR="$(CACHE_DIR)" uv run --project backend python -m app.cube.solver

lint:
	uv run --project backend ruff check backend
	uv run --project backend ruff format --check backend
	npm --prefix frontend run lint
	npm --prefix frontend run typecheck

test:
	RUBICKS_SOLVER_CACHE_DIR="$(CACHE_DIR)" uv run --project backend pytest backend/tests
	npm --prefix frontend run test

test-e2e:
	RUBICKS_SOLVER_CACHE_DIR="$(CACHE_DIR)" npm --prefix frontend run test:e2e

build:
	npm --prefix frontend run build

dev:
	RUBICKS_SOLVER_CACHE_DIR="$(CACHE_DIR)" ./scripts/dev.sh


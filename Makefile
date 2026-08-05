SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export PATH := /opt/homebrew/bin:/usr/local/bin:$(PATH)

.PHONY: all install default interactive menu install-all full submodules check help
.NOTPARALLEL:

all: install

default: install

install:
	@bash ./install.sh --default

interactive menu:
	@bash ./install.sh

install-all full:
	@bash ./install.sh --all

submodules:
	@git submodule update --init --recursive

check:
	@command -v git >/dev/null && git --version
	@command -v python3 >/dev/null && python3 --version
	@command -v zsh >/dev/null && zsh --version
	@command -v nvim >/dev/null && nvim --version | head -n 1
	@command -v vim >/dev/null && vim --version | head -n 1
	@command -v tmux >/dev/null && tmux -V
	@command -v amp >/dev/null && amp --version || true
	@command -v pi >/dev/null && pi --version || true
	@command -v claude >/dev/null && claude --version || true
	@command -v codex >/dev/null && codex --version || true
	@command -v opencode >/dev/null && opencode --version || true
	@command -v forge >/dev/null && forge --version || true
	@echo "✓ Tool check complete"

help:
	@echo "Dotfiles targets:"
	@echo "  make             Install the standard setup (./install.sh --default)"
	@echo "  make interactive Open the module picker (./install.sh)"
	@echo "  make install-all Install every module, including optional gstack"
	@echo "  make check       Print installed tool versions"

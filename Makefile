UUID := better-calendar-toggle@lurim412
SCHEMA_DIR := schemas
DIST := dist
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP := $(DIST)/$(UUID).shell-extension.zip

.PHONY: all check compile pack install enable disable clean

all: check pack

check:
	glib-compile-schemas --strict --dry-run $(SCHEMA_DIR)

compile:
	glib-compile-schemas --strict $(SCHEMA_DIR)

pack: compile
	mkdir -p $(DIST)
	rm -f $(ZIP)
	gnome-extensions pack --force --extra-source=src --extra-source=README.md --extra-source=CHANGELOG.md --extra-source=COPYING --out-dir=$(DIST) .
	@unzip -l $(ZIP) | grep -q 'src/models/alarmModel.js' || { echo "error: $(ZIP) is missing src/" >&2; rm -f $(ZIP); exit 1; }

install: pack
	rm -rf "$(INSTALL_DIR)"
	mkdir -p "$(INSTALL_DIR)"
	unzip -q "$(ZIP)" -d "$(INSTALL_DIR)"
	glib-compile-schemas "$(INSTALL_DIR)/$(SCHEMA_DIR)"
	@echo "Installed $(UUID) in $(INSTALL_DIR)"

enable: install
	gnome-extensions enable $(UUID)
	@echo "Enabled. On Wayland, log out and back in to load the new code."

disable:
	-gnome-extensions disable $(UUID)

clean:
	rm -rf $(DIST)
	rm -f $(SCHEMA_DIR)/gschemas.compiled
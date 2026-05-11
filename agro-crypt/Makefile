# agro-crypt Build System
# original Copyright (c) Ronan Le Meillat - SCTG Development 2008-2012
# restored from old backup for maintenance
#
# Updated and maintained by Ronan Le Meillat - SCTG Development 2026
# changelog 2026-02: 
#        Updated library URLs
#        Force target darwin64-x86_64-cc for macos builds (newer macs doesn't support 32-bit builds)
# Licensed under the MIT License

# Project configuration
PROJECT_NAME = agro-crypt
VERSION = 1.0.0
CC = gcc
AR = ar
CFLAGS = -std=c99 -Wall -Wextra -O2 -D_POSIX_C_SOURCE=200809L
LDFLAGS = -static

# Directory structure
LIBS_DIR = libs
SRC_DIR = src
BUILD_DIR = build
INSTALL_PREFIX = $(LIBS_DIR)/install

# Library versions and URLs
OPENSSL_VER = 1.0.0
OPENSSL_URL = https://github.com/openssl/openssl/releases/download/OpenSSL_1_0_0/openssl-1.0.0.tar.gz
OPENSSL_DIR = $(LIBS_DIR)/openssl-$(OPENSSL_VER)

LIBJPEG_VER = 7
LIBJPEG_URL = https://ijg.org/files/jpegsrc.v7.tar.gz
LIBJPEG_DIR = $(LIBS_DIR)/jpeg-7

ZBAR_VER = 0.10
ZBAR_URL = https://sourceforge.net/projects/zbar/files/zbar/0.10/zbar-$(ZBAR_VER).tar.bz2
ZBAR_DIR = $(LIBS_DIR)/zbar-$(ZBAR_VER)

QRENCODE_COMMIT = 8595f9012d6b10f9662c47862c7b11457f805da8
QRENCODE_DIR = $(LIBS_DIR)/libqrencode

# Include and library paths
INCLUDES = -I$(OPENSSL_DIR)/include -I$(INSTALL_PREFIX)/include -I$(LIBJPEG_DIR) -I$(ZBAR_DIR)/include -I$(QRENCODE_DIR) -I$(SRC_DIR)
LIBPATHS = -L$(INSTALL_PREFIX)
LIBS = -lqrencode -lzbar -ljpeg -lssl -lcrypto -lpng -liconv -lz -lm -lpthread -ldl

# Source files
SOURCES = main.c agro-crypto.c agro-qrcode.c
OBJECTS = $(SOURCES:%.c=%.o)
BINARY = $(PROJECT_NAME)
STATIC_LIB = lib$(PROJECT_NAME).a
LIB_OBJECTS = agro-crypto.o agro-qrcode.o

# Default target
.PHONY: all
all: $(BINARY) $(STATIC_LIB)

# Main binary
$(BINARY): $(OBJECTS)
	@echo "Linking $(PROJECT_NAME) binary..."
	$(CC) $(OBJECTS) $(LIBPATHS) $(LIBS) -o $@
	@echo "Build complete: $@"

# Static library (without main.o)
$(STATIC_LIB): $(LIB_OBJECTS)
	@echo "Creating static library..."
	$(AR) rcs $@ $(LIB_OBJECTS)
	@echo "Static library created: $@"

# Compile object files
%.o: %.c
	@echo "Compiling $<..."
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

# Download all libraries
.PHONY: get-libs
get-libs:
	@echo "=== Downloading dependencies ==="
	mkdir -p $(LIBS_DIR)
	
	@echo "Downloading OpenSSL $(OPENSSL_VER)..."
	cd $(LIBS_DIR) && if command -v wget >/dev/null 2>&1; then wget -nc $(OPENSSL_URL); elif command -v curl >/dev/null 2>&1; then [ -f openssl-$(OPENSSL_VER).tar.gz ] || curl -fL -o openssl-$(OPENSSL_VER).tar.gz $(OPENSSL_URL); else echo "Error: neither wget nor curl is installed" >&2; exit 1; fi && tar -xzf openssl-$(OPENSSL_VER).tar.gz

	@echo "Downloading libjpeg $(LIBJPEG_VER)..."
	cd $(LIBS_DIR) && if command -v wget >/dev/null 2>&1; then wget -nc $(LIBJPEG_URL); elif command -v curl >/dev/null 2>&1; then [ -f jpegsrc.v7.tar.gz ] || curl -fL -o jpegsrc.v7.tar.gz $(LIBJPEG_URL); else echo "Error: neither wget nor curl is installed" >&2; exit 1; fi && tar -xzf jpegsrc.v7.tar.gz

	@echo "Downloading zbar $(ZBAR_VER)..."
	cd $(LIBS_DIR) && if command -v wget >/dev/null 2>&1; then wget -nc $(ZBAR_URL); elif command -v curl >/dev/null 2>&1; then [ -f zbar-$(ZBAR_VER).tar.bz2 ] || curl -fL -o zbar-$(ZBAR_VER).tar.bz2 $(ZBAR_URL); else echo "Error: neither wget nor curl is installed" >&2; exit 1; fi && tar -xjf zbar-$(ZBAR_VER).tar.bz2

	@echo "Cloning libqrencode..."
	@if [ -d "$(QRENCODE_DIR)" ]; then \
		echo "libqrencode already present — fetching updates..."; \
		git -C "$(QRENCODE_DIR)" fetch --all --tags || true; \
	else \
		git clone https://github.com/fukuchi/libqrencode.git "$(QRENCODE_DIR)"; \
	fi
	cd $(QRENCODE_DIR) && git checkout $(QRENCODE_COMMIT)
	
	@echo "All dependencies downloaded."

# Build all dependencies
.PHONY: build-deps build-libs
build-deps: $(INSTALL_PREFIX)/.deps_built

# Build libraries from existing sources (no download)
.PHONY: build-libs
build-libs:
	@echo "=== Building libraries (static) — using existing sources only ==="
	mkdir -p $(INSTALL_PREFIX)
	
	@echo "Building OpenSSL..."
	if [ -f "$(OPENSSL_DIR)/libssl.a" ] && [ -f "$(OPENSSL_DIR)/libcrypto.a" ]; then \
	  echo "OpenSSL static libraries already present — skipping OpenSSL build"; \
	else \
	  cd $(OPENSSL_DIR) && \
	  if [ "`uname -s`" = "Darwin" ] && [ "`uname -m`" = "x86_64" ]; then \
	    echo "Detected macOS (Intel) — using darwin64-x86_64-cc target"; \
	    ./Configure darwin64-x86_64-cc --prefix="$(realpath $(INSTALL_PREFIX))" no-shared; \
	  else \
	    ./config --prefix="$(realpath $(INSTALL_PREFIX))" no-shared no-dso no-krb5 no-asm; \
	  fi; \
	  $(MAKE) -C $(OPENSSL_DIR) build_libs; \
	  cp $(OPENSSL_DIR)/lib/libssl.a $(INSTALL_PREFIX)/lib/; \
	  cp $(OPENSSL_DIR)/lib/libcrypto.a $(INSTALL_PREFIX)/lib/; \
	fi
	
	@echo "Building libjpeg..."
	if [ -f "$(LIBJPEG_DIR)/libjpeg.a" ] || [ -f "$(LIBJPEG_DIR)/.libs/libjpeg.a" ]; then \
	  echo "libjpeg static library already present — skipping libjpeg build"; \
	else \
	  cd $(LIBJPEG_DIR) && ./configure --prefix="$(realpath $(INSTALL_PREFIX))" --enable-static --disable-shared; \
	  $(MAKE) -C $(LIBJPEG_DIR); \
	  if [ -f "$(LIBJPEG_DIR)/.libs/libjpeg.a" ]; then cp $(LIBJPEG_DIR)/.libs/libjpeg.a $(LIBJPEG_DIR)/libjpeg.a; fi; \
	fi
	
	@echo "Building libqrencode..."
	if [ -f "$(QRENCODE_DIR)/libqrencode.a" ]; then \
	  echo "libqrencode static library already present — skipping libqrencode build"; \
	else \
	  cd $(QRENCODE_DIR) && ./autogen.sh; \
	  cd $(QRENCODE_DIR) && ./configure --prefix="$(realpath $(INSTALL_PREFIX))" --enable-static --disable-shared --without-tools; \
	  $(MAKE) -C $(QRENCODE_DIR); \
	  if [ -f "$(QRENCODE_DIR)/.libs/libqrencode.a" ]; then cp $(QRENCODE_DIR)/.libs/libqrencode.a $(QRENCODE_DIR)/libqrencode.a; fi; \
	  cp $(QRENCODE_DIR)/libqrencode.a $(INSTALL_PREFIX)/lib/; \
	fi
	
	@echo "Building zbar..."
	if [ -f "$(ZBAR_DIR)/libzbar.a" ] || [ -f "$(ZBAR_DIR)/.libs/libzbar.a" ]; then \
	  echo "zbar static library already present — skipping zbar build"; \
	else \
	  if [ ! -f "$(ZBAR_DIR)/configure" ]; then \
	  	echo "Generating configure for zbar (autoreconf -i)"; \
	    cd $(ZBAR_DIR) && autoreconf -i; \
	  fi; \
	  cd $(ZBAR_DIR) && ./configure --prefix="$(realpath $(INSTALL_PREFIX))" --enable-static --disable-shared --disable-video --disable-assert --without-x --without-xv --without-mozilla && make -j12 || true; \
	  if [ -f "$(ZBAR_DIR)/.libs/libzbar.a" ]; then cp $(ZBAR_DIR)/.libs/libzbar.a $(ZBAR_DIR)/libzbar.a; fi; \
	  cp $(ZBAR_DIR)/libzbar.a $(INSTALL_PREFIX)/lib/ ; \
	fi
	
	@echo "build-libs complete."

$(INSTALL_PREFIX)/.deps_built: | get-libs build-libs
	@touch $(INSTALL_PREFIX)/.deps_built
	@echo "All dependencies built and installed."

# Clean build artifacts
.PHONY: clean
clean:
	@echo "Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	@echo "Clean complete."

# Clean everything including downloaded libraries
.PHONY: distclean
distclean: clean
	@echo "Cleaning all dependencies..."
	rm -rf $(LIBS_DIR)
	@echo "Full clean complete."

# Help target
.PHONY: help
help:
	@echo "agro-crypt Makefile (make 3.81)"
	@echo ""
	@echo "Targets:"
	@echo "  all         - Build binary and static library (default)"
	@echo "  get-libs    - Download all dependencies"
	@echo "  build-libs  - Build dependencies from existing sources (no download)"
	@echo "  build-deps  - Download + build all dependencies"
	@echo "  clean       - Remove build artifacts"
	@echo "  distclean   - Remove build artifacts and libraries"
	@echo "  help        - Show this help message"
	@echo ""
	@echo "Output:"
	@echo "  Binary:     $(BINARY)"
	@echo "  Library:    $(STATIC_LIB)"


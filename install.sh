#!/bin/bash
set -euo pipefail

# Clark installer — downloads the latest release binary from GitHub.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/alexracape/clark/main/install.sh | bash
#
# Options (via environment variables):
#   CLARK_VERSION=v0.1.0  Install a specific version (default: latest)
#   INSTALL_DIR=~/.local/bin  Custom install directory (default: /usr/local/bin)

REPO="alexracape/clark"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux" ;;
  *)
    echo "Error: Unsupported operating system: $OS"
    echo "Clark currently supports macOS and Linux."
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64)        ARCH="x64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

TARGET="${PLATFORM}-${ARCH}"
BINARY_NAME="clark-${TARGET}"

# Determine version
if [ -z "${CLARK_VERSION:-}" ]; then
  echo "Fetching latest release..."
  CLARK_VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  if [ -z "$CLARK_VERSION" ]; then
    echo "Error: Could not determine latest version. Specify CLARK_VERSION manually."
    exit 1
  fi
fi

echo "Installing Clark ${CLARK_VERSION} for ${TARGET}..."

# Download binary and checksum
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${CLARK_VERSION}/${BINARY_NAME}"
CHECKSUM_URL="${DOWNLOAD_URL}.sha256"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL -o "${TMPDIR}/${BINARY_NAME}" "$DOWNLOAD_URL"
curl -fsSL -o "${TMPDIR}/${BINARY_NAME}.sha256" "$CHECKSUM_URL"

# Verify checksum
echo "Verifying checksum..."
cd "$TMPDIR"
if command -v sha256sum &>/dev/null; then
  sha256sum -c "${BINARY_NAME}.sha256"
elif command -v shasum &>/dev/null; then
  shasum -a 256 -c "${BINARY_NAME}.sha256"
else
  echo "Warning: No sha256sum or shasum found, skipping checksum verification."
fi

# Install
chmod +x "${TMPDIR}/${BINARY_NAME}"

if [ -w "$INSTALL_DIR" ]; then
  mv "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/clark"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/clark"
fi

echo ""
echo "Clark ${CLARK_VERSION} installed to ${INSTALL_DIR}/clark"
echo "Run 'clark --version' to verify."

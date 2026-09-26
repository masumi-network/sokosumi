#!/bin/sh

# Xcode Cloud runs this right after cloning, before resolving packages.
#
# CoreAPI builds its client with the `OpenAPIGenerator` build-tool plugin from
# apple/swift-openapi-generator. Xcode requires a one-time interactive "Trust &
# Enable" for SwiftPM plugins, which no CI machine can answer, so the build
# fails with:
#
#   Plugin "OpenAPIGenerator" from package "swift-openapi-generator" must be
#   enabled before it can be used
#
# Opting out of plugin/macro fingerprint validation is the supported way to
# pre-approve them on an ephemeral build machine.

set -e

defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES

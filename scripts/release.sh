#!/bin/bash
set -e

VERSION="${1}"

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.1.0"
  exit 1
fi

REPO_URL="https://github.com/ZiuChen/doubaoime-asr-nodejs"

echo "🚀 Releasing v${VERSION}..."
echo ""

# 1. Update version in package.json
echo "📝 Updating version..."
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" package.json
echo "  ✓ package.json"

# 2. Git commit and tag
echo ""
echo "📦 Creating git commit and tag..."
git add -A
git commit -m "release: v${VERSION}"
git tag "v${VERSION}"

# 3. Push (GitHub Actions will build and publish via OIDC)
echo ""
echo "⬆️  Pushing to remote..."
git push && git push --tags

echo ""
echo "✅ Tag v${VERSION} pushed! GitHub Actions will handle the release."
echo "   ${REPO_URL}/actions"

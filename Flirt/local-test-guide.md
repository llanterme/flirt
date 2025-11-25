# Local Railway Build Testing Guide

## 🚀 Option 1: Nixpacks (Most Accurate)

### Install Nixpacks
```bash
# macOS
brew install railwayapp/nixpacks/nixpacks

# Or via cargo (if you have Rust)
cargo install nixpacks
```

### Test Build Locally
```bash
# Navigate to your project
cd Flirt

# Build exactly like Railway (most accurate)
nixpacks build . --name flirt-test

# Run the built image
docker run -p 3001:3001 flirt-test

# Clean up when done
docker stop $(docker ps -q --filter ancestor=flirt-test)
docker rmi flirt-test
```

## 🎯 Option 2: Railway CLI (Runtime Testing)

### Install Railway CLI
```bash
# macOS
brew install railway

# Or via npm
npm install -g @railway/cli
```

### Test Runtime Locally
```bash
# Login and link project
railway login
railway link

# Test runtime (not build)
railway run npm start

# Test with production environment
railway run --environment production npm start
```

## 🐳 Option 2: Docker with Nixpacks

### Install Nixpacks
```bash
# macOS
brew install railwayapp/nixpacks/nixpacks

# Or via cargo
cargo install nixpacks
```

### Test Build
```bash
# Build with Nixpacks (exactly like Railway)
nixpacks build . --name flirt-test

# Run the built image
docker run -p 3001:3001 flirt-test
```

## 🛠️ Option 3: Manual Docker Test

Create a test Dockerfile that mimics Railway's environment:

### Create `Dockerfile.test`
```dockerfile
FROM ghcr.io/railwayapp/nixpacks:ubuntu-latest

WORKDIR /app
COPY . .

# Install Nix packages (same as nixpacks.toml)
RUN nix-env -iA nixpkgs.nodejs_22 nixpkgs.python311 nixpkgs.python311Packages.setuptools nixpkgs.pkg-config nixpkgs.sqlite nixpkgs.gcc nixpkgs.gnumake

# Install dependencies
RUN npm ci

# Test distutils
RUN python3.11 -c "import distutils; print('✅ distutils available')"

# Rebuild SQLite3
RUN PYTHON=python3.11 npm rebuild sqlite3 --build-from-source

# Start command
CMD ["npm", "start"]
```

### Build and Test
```bash
# Build test image
docker build -f Dockerfile.test -t flirt-local-test .

# Run test
docker run -p 3001:3001 flirt-local-test
```

## ⚡ Quick Test Script

Create this script for rapid testing:

### `test-build.sh`
```bash
#!/bin/bash
echo "🧪 Testing Railway build locally..."

# Option A: Railway CLI (fastest)
if command -v railway &> /dev/null; then
    echo "Using Railway CLI..."
    railway build --local
else
    # Option B: Nixpacks (most accurate)
    if command -v nixpacks &> /dev/null; then
        echo "Using Nixpacks..."
        nixpacks build . --name flirt-test
        docker run -d -p 3001:3001 --name flirt-test-container flirt-test
        echo "Test server running on http://localhost:3001"
        echo "Run 'docker stop flirt-test-container && docker rm flirt-test-container' to cleanup"
    else
        echo "❌ Please install Railway CLI or Nixpacks"
        echo "Railway CLI: brew install railway"
        echo "Nixpacks: brew install railwayapp/nixpacks/nixpacks"
    fi
fi
```

### Make executable and run:
```bash
chmod +x test-build.sh
./test-build.sh
```

## 🔍 What Each Method Tests

| Method | Speed | Accuracy | Use Case |
|--------|-------|----------|----------|
| Railway CLI | Fast | High | Quick validation |
| Nixpacks | Medium | Highest | Exact Railway simulation |
| Docker Manual | Slow | High | Custom debugging |

## 📋 Recommended Workflow

1. **Development**: Use Railway CLI for quick tests
2. **Before Push**: Use Nixpacks for final validation
3. **Debugging**: Use manual Docker for deep investigation

This way you can catch build issues locally before pushing to Railway! 🎯
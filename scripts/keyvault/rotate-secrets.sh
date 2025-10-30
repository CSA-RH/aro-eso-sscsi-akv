#!/bin/bash

# Rotate Secrets Script
# Rotates secrets in Azure Key Vault to demonstrate rotation handling

set -eo pipefail

# Source configuration
if [ -f "$(dirname "${BASH_SOURCE[0]}")/../../config.env" ]; then
    source "$(dirname "${BASH_SOURCE[0]}")/../../config.env"
elif [ -f "./config.env" ]; then
    source "./config.env"
else
    echo "Error: config.env not found. Please run ./bin/install azure first."
    exit 1
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================${NC}"
}

print_status() {
    echo -e "${YELLOW}➤${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

# Generate a new random value for a secret
generate_new_value() {
    local secret_name=$1
    local base_value=""
    
    case "$secret_name" in
        "database-password"|"rotating-database-password")
            # Generate a new database password
            base_value="SecureDB"
            ;;
        "api-key"|"rotating-api-key")
            # Generate a new API key
            base_value="sk"
            ;;
        "hello-world-secret")
            # Generate a new hello world message
            base_value="Hello from Azure Key Vault"
            ;;
        "jwt-secret"|"rotating-jwt-secret")
            # Generate a new JWT secret
            base_value="jwt"
            ;;
        *)
            base_value="secret"
            ;;
    esac
    
    # Add timestamp and random suffix
    local timestamp=$(date +%s)
    local random=$(openssl rand -hex 4 | tr '[:lower:]' '[:upper:]')
    echo "${base_value}_${timestamp}_${random}"
}

# Rotate a secret in Key Vault
rotate_secret() {
    local secret_name=$1
    local new_value=$(generate_new_value "$secret_name")
    
    print_status "Rotating secret: $secret_name"
    
    if az keyvault secret set \
        --vault-name "${ACTUAL_KEYVAULT_NAME}" \
        --name "$secret_name" \
        --value "$new_value" \
        --only-show-errors &>/dev/null; then
        print_success "Secret '$secret_name' rotated successfully"
        echo "  New value: ${new_value:0:50}..."
        return 0
    else
        print_error "Failed to rotate secret '$secret_name'"
        return 1
    fi
}

# Rotate all rotating secrets
rotate_all() {
    print_header "Rotating All Secrets"
    
    local secrets=(
        "database-password"
        "api-key"
        "hello-world-secret"
        "rotating-database-password"
        "rotating-api-key"
        "rotating-jwt-secret"
    )
    
    local rotated=0
    local failed=0
    
    for secret_name in "${secrets[@]}"; do
        # Check if secret exists before trying to rotate
        if az keyvault secret show \
            --vault-name "${ACTUAL_KEYVAULT_NAME}" \
            --name "$secret_name" \
            --only-show-errors &>/dev/null; then
            if rotate_secret "$secret_name"; then
                rotated=$((rotated + 1))
            else
                failed=$((failed + 1))
            fi
        else
            print_status "Secret '$secret_name' not found, skipping..."
        fi
    done
    
    echo ""
    print_success "Rotation complete: $rotated rotated, $failed failed"
}

# Rotate specific secret
rotate_specific() {
    local secret_name=$1
    
    if [ -z "$secret_name" ]; then
        print_error "Secret name required"
        echo "Usage: $0 <secret-name>"
        echo ""
        echo "Available secrets:"
        echo "  database-password"
        echo "  api-key"
        echo "  hello-world-secret"
        echo "  rotating-database-password"
        echo "  rotating-api-key"
        echo "  rotating-jwt-secret"
        exit 1
    fi
    
    print_header "Rotating Secret: $secret_name"
    
    if rotate_secret "$secret_name"; then
        exit 0
    else
        exit 1
    fi
}

# Main
if [ "$#" -eq 0 ]; then
    rotate_all
elif [ "$1" = "--all" ] || [ "$1" = "all" ]; then
    rotate_all
else
    rotate_specific "$1"
fi


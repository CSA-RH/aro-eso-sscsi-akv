#!/bin/bash

# Azure Key Vault Secret Population Script
# This script populates Azure Key Vault with example secrets for Secrets Store CSI driver demo

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[HEADER]${NC} $1"
}

# Function to check if Azure CLI is installed and logged in
check_azure_cli() {
    print_status "Checking Azure CLI..."
    
    if ! command -v az &> /dev/null; then
        print_error "Azure CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if logged in
    if ! az account show &> /dev/null; then
        print_error "Not logged in to Azure CLI. Please run 'az login' first."
        exit 1
    fi
    
    print_status "Azure CLI is ready"
}

# Function to get user input
get_user_input() {
    echo "Please provide the following information:"
    read -p "Azure Key Vault Name: " KEYVAULT_NAME
    read -p "Resource Group: " RESOURCE_GROUP
    read -p "Location (e.g., eastus): " LOCATION
    
    # Validate inputs
    if [[ -z "$KEYVAULT_NAME" || -z "$RESOURCE_GROUP" || -z "$LOCATION" ]]; then
        print_error "All fields are required"
        exit 1
    fi
}

# Function to create Key Vault if it doesn't exist
create_keyvault() {
    print_status "Checking if Key Vault exists..."
    
    if az keyvault show --name "$KEYVAULT_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        print_status "Key Vault '$KEYVAULT_NAME' already exists"
    else
        print_status "Creating Key Vault '$KEYVAULT_NAME'..."
        az keyvault create \
            --name "$KEYVAULT_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --location "$LOCATION" \
            --sku standard \
            --enable-rbac-authorization true
        print_status "Key Vault created successfully"
    fi
}

# Function to populate basic secrets
populate_basic_secrets() {
    print_header "Populating Basic Secrets"
    
    # Database password
    print_status "Creating database-password secret..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "database-password" \
        --value "SuperSecureDatabasePassword123!" \
        --description "Database password for the application"
    
    # API key
    print_status "Creating api-key secret..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "api-key" \
        --value "sk-1234567890abcdef1234567890abcdef" \
        --description "API key for external services"
    
    # JWT secret
    print_status "Creating jwt-secret secret..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "jwt-secret" \
        --value "jwt-super-secret-key-for-signing-tokens-2024" \
        --description "JWT signing secret"
    
    # Redis password
    print_status "Creating redis-password secret..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "redis-password" \
        --value "RedisSecurePassword456!" \
        --description "Redis cache password"
    
    # Hello World secret
    print_status "Creating hello-world-secret secret..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "hello-world-secret" \
        --value "Hello World Secret from Azure Key Vault!" \
        --description "Hello World secret for demo purposes"
    
    print_status "Basic secrets created successfully"
}

# Function to populate environment-specific secrets
populate_environment_secrets() {
    print_header "Populating Environment-Specific Secrets"
    
    # Production secrets
    print_status "Creating production secrets..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-database-password" \
        --value "ProdDatabasePassword789!" \
        --description "Production database password"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-api-key" \
        --value "prod-sk-abcdef1234567890abcdef1234567890" \
        --description "Production API key"
    
    # Staging secrets
    print_status "Creating staging secrets..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-database-password" \
        --value "StagingDatabasePassword456!" \
        --description "Staging database password"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-api-key" \
        --value "staging-sk-1234567890abcdef1234567890abcdef" \
        --description "Staging API key"
    
    # Development secrets
    print_status "Creating development secrets..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-database-password" \
        --value "DevDatabasePassword123!" \
        --description "Development database password"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-api-key" \
        --value "dev-sk-abcdef1234567890abcdef1234567890" \
        --description "Development API key"
    
    # Shared secrets
    print_status "Creating shared secrets..."
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-jwt-secret" \
        --value "SharedJWTSecretKey2024!" \
        --description "Shared JWT secret across environments"
    
    print_status "Environment-specific secrets created successfully"
}

# Function to create self-signed certificates for demo
create_demo_certificates() {
    print_header "Creating Demo Certificates"
    
    # Create temporary directory for certificates
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Generate private key
    print_status "Generating private key..."
    openssl genrsa -out webapp.key 2048
    
    # Generate certificate signing request
    print_status "Generating certificate signing request..."
    openssl req -new -key webapp.key -out webapp.csr -subj "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=webapp.demo.com"
    
    # Generate self-signed certificate
    print_status "Generating self-signed certificate..."
    openssl x509 -req -days 365 -in webapp.csr -signkey webapp.key -out webapp.crt
    
    # Upload certificate to Key Vault
    print_status "Uploading webapp-tls-cert to Key Vault..."
    az keyvault certificate import \
        --vault-name "$KEYVAULT_NAME" \
        --name "webapp-tls-cert" \
        --file webapp.crt \
        --password ""
    
    # Generate wildcard certificate
    print_status "Generating wildcard certificate..."
    openssl req -new -key webapp.key -out wildcard.csr -subj "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=*.demo.com"
    openssl x509 -req -days 365 -in wildcard.csr -signkey webapp.key -out wildcard.crt
    
    print_status "Uploading wildcard-tls-cert to Key Vault..."
    az keyvault certificate import \
        --vault-name "$KEYVAULT_NAME" \
        --name "wildcard-tls-cert" \
        --file wildcard.crt \
        --password ""
    
    # Generate API gateway certificate
    print_status "Generating API gateway certificate..."
    openssl req -new -key webapp.key -out api-gateway.csr -subj "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=api.demo.com"
    openssl x509 -req -days 365 -in api-gateway.csr -signkey webapp.key -out api-gateway.crt
    
    print_status "Uploading api-gateway-cert to Key Vault..."
    az keyvault certificate import \
        --vault-name "$KEYVAULT_NAME" \
        --name "api-gateway-cert" \
        --file api-gateway.crt \
        --password ""
    
    # Clean up temporary files
    cd - > /dev/null
    rm -rf "$TEMP_DIR"
    
    print_status "Demo certificates created successfully"
}

# Function to create encryption keys
create_encryption_keys() {
    print_header "Creating Encryption Keys"
    
    # Generate encryption key
    print_status "Creating encryption-key..."
    az keyvault key create \
        --vault-name "$KEYVAULT_NAME" \
        --name "encryption-key" \
        --kty RSA \
        --size 2048 \
        --ops encrypt decrypt sign verify wrapKey unwrapKey
    
    # Generate shared encryption key
    print_status "Creating shared-encryption-key..."
    az keyvault key create \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-encryption-key" \
        --kty RSA \
        --size 2048 \
        --ops encrypt decrypt sign verify wrapKey unwrapKey
    
    print_status "Encryption keys created successfully"
}

# Function to display summary
display_summary() {
    print_header "Key Vault Population Summary"
    
    echo "Key Vault: $KEYVAULT_NAME"
    echo "Resource Group: $RESOURCE_GROUP"
    echo "Location: $LOCATION"
    echo ""
    
    print_status "Secrets created:"
    echo "  - database-password"
    echo "  - api-key"
    echo "  - jwt-secret"
    echo "  - redis-password"
    echo "  - hello-world-secret"
    echo "  - prod-database-password"
    echo "  - prod-api-key"
    echo "  - staging-database-password"
    echo "  - staging-api-key"
    echo "  - dev-database-password"
    echo "  - dev-api-key"
    echo "  - shared-jwt-secret"
    echo ""
    
    print_status "Certificates created:"
    echo "  - webapp-tls-cert"
    echo "  - wildcard-tls-cert"
    echo "  - api-gateway-cert"
    echo ""
    
    print_status "Keys created:"
    echo "  - encryption-key"
    echo "  - shared-encryption-key"
    echo ""
    
    print_warning "Next steps:"
    echo "1. Update your SecretProviderClass examples with this Key Vault name"
    echo "2. Grant your Managed Identity access to this Key Vault"
    echo "3. Test the Secrets Store CSI driver with the example pods"
}

# Main function
main() {
    print_header "Azure Key Vault Secret Population Script"
    print_status "This script will populate your Key Vault with example secrets for demo purposes"
    
    # Check prerequisites
    check_azure_cli
    
    # Get user input
    get_user_input
    
    # Create Key Vault if needed
    create_keyvault
    
    # Populate secrets
    populate_basic_secrets
    populate_environment_secrets
    create_demo_certificates
    create_encryption_keys
    
    # Display summary
    display_summary
    
    print_status "Key Vault population completed successfully!"
}

# Run main function
main "$@"

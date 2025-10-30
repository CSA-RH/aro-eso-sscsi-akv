#!/bin/bash

# Azure Key Vault Environment-Specific Secrets Script
# This script creates environment-specific secrets for different deployment environments

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

# Function to get user input
get_user_input() {
    echo "Please provide the following information:"
    read -p "Azure Key Vault Name: " KEYVAULT_NAME
    read -p "Resource Group: " RESOURCE_GROUP
    
    if [[ -z "$KEYVAULT_NAME" || -z "$RESOURCE_GROUP" ]]; then
        print_error "Key Vault name and Resource Group are required"
        exit 1
    fi
}

# Function to create production secrets
create_production_secrets() {
    print_header "Creating Production Environment Secrets"
    
    # Database secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-database-password" \
        --value "ProdDB2024!SuperSecurePassword" \
        --description "Production database password"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-database-connection-string" \
        --value "Server=prod-db.database.windows.net;Database=MyApp;User Id=appuser;Password=ProdDB2024!SuperSecurePassword;" \
        --description "Production database connection string"
    
    # API secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-api-key" \
        --value "prod-sk-1234567890abcdef1234567890abcdef1234567890" \
        --description "Production API key"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-external-api-key" \
        --value "prod-external-9876543210fedcba9876543210fedcba" \
        --description "Production external API key"
    
    # Authentication secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-jwt-secret" \
        --value "prod-jwt-super-secret-key-2024-production-only" \
        --description "Production JWT secret"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-oauth-client-secret" \
        --value "prod-oauth-client-secret-1234567890abcdef" \
        --description "Production OAuth client secret"
    
    # Cache secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-redis-password" \
        --value "ProdRedis2024!SecurePassword" \
        --description "Production Redis password"
    
    # Monitoring secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "prod-monitoring-api-key" \
        --value "prod-monitoring-abcdef1234567890abcdef1234567890" \
        --description "Production monitoring API key"
    
    print_status "Production secrets created successfully"
}

# Function to create staging secrets
create_staging_secrets() {
    print_header "Creating Staging Environment Secrets"
    
    # Database secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-database-password" \
        --value "StagingDB2024!SecurePassword" \
        --description "Staging database password"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-database-connection-string" \
        --value "Server=staging-db.database.windows.net;Database=MyAppStaging;User Id=appuser;Password=StagingDB2024!SecurePassword;" \
        --description "Staging database connection string"
    
    # API secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-api-key" \
        --value "staging-sk-abcdef1234567890abcdef1234567890abcdef" \
        --description "Staging API key"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-external-api-key" \
        --value "staging-external-fedcba9876543210fedcba9876543210" \
        --description "Staging external API key"
    
    # Authentication secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-jwt-secret" \
        --value "staging-jwt-secret-key-2024-staging-only" \
        --description "Staging JWT secret"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-oauth-client-secret" \
        --value "staging-oauth-client-secret-fedcba9876543210" \
        --description "Staging OAuth client secret"
    
    # Cache secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-redis-password" \
        --value "StagingRedis2024!SecurePassword" \
        --description "Staging Redis password"
    
    # Monitoring secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "staging-monitoring-api-key" \
        --value "staging-monitoring-fedcba9876543210fedcba9876543210" \
        --description "Staging monitoring API key"
    
    print_status "Staging secrets created successfully"
}

# Function to create development secrets
create_development_secrets() {
    print_header "Creating Development Environment Secrets"
    
    # Database secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-database-password" \
        --value "DevDB2024!Password" \
        --description "Development database password"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-database-connection-string" \
        --value "Server=dev-db.database.windows.net;Database=MyAppDev;User Id=appuser;Password=DevDB2024!Password;" \
        --description "Development database connection string"
    
    # API secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-api-key" \
        --value "dev-sk-1234567890abcdef1234567890abcdef1234567890" \
        --description "Development API key"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-external-api-key" \
        --value "dev-external-1234567890abcdef1234567890abcdef" \
        --description "Development external API key"
    
    # Authentication secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-jwt-secret" \
        --value "dev-jwt-secret-key-2024-development-only" \
        --description "Development JWT secret"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-oauth-client-secret" \
        --value "dev-oauth-client-secret-1234567890abcdef" \
        --description "Development OAuth client secret"
    
    # Cache secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-redis-password" \
        --value "DevRedis2024!Password" \
        --description "Development Redis password"
    
    # Monitoring secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "dev-monitoring-api-key" \
        --value "dev-monitoring-1234567890abcdef1234567890abcdef" \
        --description "Development monitoring API key"
    
    print_status "Development secrets created successfully"
}

# Function to create shared secrets
create_shared_secrets() {
    print_header "Creating Shared Secrets"
    
    # Shared across all environments
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-jwt-secret" \
        --value "shared-jwt-secret-key-2024-all-environments" \
        --description "Shared JWT secret across all environments"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-encryption-key" \
        --value "shared-encryption-key-2024-all-environments" \
        --description "Shared encryption key across all environments"
    
    # Third-party service secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-sendgrid-api-key" \
        --value "SG.shared-sendgrid-api-key-1234567890abcdef" \
        --description "Shared SendGrid API key"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-stripe-secret-key" \
        --value "sk_test_shared-stripe-secret-key-1234567890abcdef" \
        --description "Shared Stripe secret key"
    
    # Internal service secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "shared-internal-api-key" \
        --value "shared-internal-api-key-1234567890abcdef" \
        --description "Shared internal API key"
    
    print_status "Shared secrets created successfully"
}

# Function to create feature flag secrets
create_feature_flag_secrets() {
    print_header "Creating Feature Flag Secrets"
    
    # Feature flag API keys
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "feature-flag-api-key" \
        --value "ff-api-key-1234567890abcdef1234567890abcdef" \
        --description "Feature flag service API key"
    
    # A/B testing secrets
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "ab-testing-api-key" \
        --value "ab-testing-api-key-1234567890abcdef" \
        --description "A/B testing service API key"
    
    print_status "Feature flag secrets created successfully"
}

# Function to display summary
display_summary() {
    print_header "Environment-Specific Secrets Summary"
    
    echo "Key Vault: $KEYVAULT_NAME"
    echo "Resource Group: $RESOURCE_GROUP"
    echo ""
    
    print_status "Production secrets created:"
    echo "  - prod-database-password"
    echo "  - prod-database-connection-string"
    echo "  - prod-api-key"
    echo "  - prod-external-api-key"
    echo "  - prod-jwt-secret"
    echo "  - prod-oauth-client-secret"
    echo "  - prod-redis-password"
    echo "  - prod-monitoring-api-key"
    echo ""
    
    print_status "Staging secrets created:"
    echo "  - staging-database-password"
    echo "  - staging-database-connection-string"
    echo "  - staging-api-key"
    echo "  - staging-external-api-key"
    echo "  - staging-jwt-secret"
    echo "  - staging-oauth-client-secret"
    echo "  - staging-redis-password"
    echo "  - staging-monitoring-api-key"
    echo ""
    
    print_status "Development secrets created:"
    echo "  - dev-database-password"
    echo "  - dev-database-connection-string"
    echo "  - dev-api-key"
    echo "  - dev-external-api-key"
    echo "  - dev-jwt-secret"
    echo "  - dev-oauth-client-secret"
    echo "  - dev-redis-password"
    echo "  - dev-monitoring-api-key"
    echo ""
    
    print_status "Shared secrets created:"
    echo "  - shared-jwt-secret"
    echo "  - shared-encryption-key"
    echo "  - shared-sendgrid-api-key"
    echo "  - shared-stripe-secret-key"
    echo "  - shared-internal-api-key"
    echo ""
    
    print_status "Feature flag secrets created:"
    echo "  - feature-flag-api-key"
    echo "  - ab-testing-api-key"
    echo ""
    
    print_warning "Next steps:"
    echo "1. Update your SecretProviderClass examples with environment-specific secrets"
    echo "2. Create separate SecretProviderClasses for each environment"
    echo "3. Test the Secrets Store CSI driver with environment-specific configurations"
}

# Main function
main() {
    print_header "Azure Key Vault Environment-Specific Secrets Script"
    print_status "This script will create environment-specific secrets for different deployment environments"
    
    # Get user input
    get_user_input
    
    # Create secrets for each environment
    create_production_secrets
    create_staging_secrets
    create_development_secrets
    create_shared_secrets
    create_feature_flag_secrets
    
    # Display summary
    display_summary
    
    print_status "Environment-specific secrets creation completed successfully!"
}

# Run main function
main "$@"

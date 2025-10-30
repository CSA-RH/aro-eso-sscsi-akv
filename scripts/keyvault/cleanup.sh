#!/bin/bash

# Azure Key Vault Cleanup Script
# This script removes demo secrets from Azure Key Vault

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
    
    # Confirmation prompt
    echo ""
    print_warning "This will delete ALL secrets, certificates, and keys from the Key Vault!"
    print_warning "Key Vault: $KEYVAULT_NAME"
    print_warning "Resource Group: $RESOURCE_GROUP"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " CONFIRM
    
    if [[ "$CONFIRM" != "yes" ]]; then
        print_status "Operation cancelled"
        exit 0
    fi
}

# Function to delete secrets
delete_secrets() {
    print_header "Deleting Secrets"
    
    # List of secrets to delete
    local secrets=(
        "database-password"
        "api-key"
        "jwt-secret"
        "redis-password"
        "prod-database-password"
        "prod-api-key"
        "prod-database-connection-string"
        "prod-external-api-key"
        "prod-jwt-secret"
        "prod-oauth-client-secret"
        "prod-redis-password"
        "prod-monitoring-api-key"
        "staging-database-password"
        "staging-api-key"
        "staging-database-connection-string"
        "staging-external-api-key"
        "staging-jwt-secret"
        "staging-oauth-client-secret"
        "staging-redis-password"
        "staging-monitoring-api-key"
        "dev-database-password"
        "dev-api-key"
        "dev-database-connection-string"
        "dev-external-api-key"
        "dev-jwt-secret"
        "dev-oauth-client-secret"
        "dev-redis-password"
        "dev-monitoring-api-key"
        "shared-jwt-secret"
        "shared-encryption-key"
        "shared-sendgrid-api-key"
        "shared-stripe-secret-key"
        "shared-internal-api-key"
        "feature-flag-api-key"
        "ab-testing-api-key"
        "rotating-database-password"
        "rotating-api-key"
        "rotating-jwt-secret"
        "rotating-redis-password"
        "rotating-external-api-key"
        "rotating-monitoring-api-key"
        "versioned-database-password"
        "specific-version-api-key"
        "expiring-database-password"
        "expiring-api-key"
        "tagged-database-password"
        "tagged-api-key"
        "tagged-jwt-secret"
        "rotation-test-password"
        "rotation-test-api-key"
    )
    
    for secret in "${secrets[@]}"; do
        if az keyvault secret show --vault-name "$KEYVAULT_NAME" --name "$secret" &> /dev/null; then
            print_status "Deleting secret: $secret"
            az keyvault secret delete --vault-name "$KEYVAULT_NAME" --name "$secret" --yes
        else
            print_warning "Secret '$secret' not found, skipping"
        fi
    done
    
    print_status "Secrets deletion completed"
}

# Function to delete certificates
delete_certificates() {
    print_header "Deleting Certificates"
    
    # List of certificates to delete
    local certificates=(
        "webapp-tls-cert"
        "wildcard-tls-cert"
        "api-gateway-cert"
        "lb-tls-cert"
        "db-tls-cert"
        "multi-domain-cert"
        "microservices-cert"
    )
    
    for cert in "${certificates[@]}"; do
        if az keyvault certificate show --vault-name "$KEYVAULT_NAME" --name "$cert" &> /dev/null; then
            print_status "Deleting certificate: $cert"
            az keyvault certificate delete --vault-name "$KEYVAULT_NAME" --name "$cert" --yes
        else
            print_warning "Certificate '$cert' not found, skipping"
        fi
    done
    
    print_status "Certificates deletion completed"
}

# Function to delete keys
delete_keys() {
    print_header "Deleting Keys"
    
    # List of keys to delete
    local keys=(
        "encryption-key"
        "shared-encryption-key"
    )
    
    for key in "${keys[@]}"; do
        if az keyvault key show --vault-name "$KEYVAULT_NAME" --name "$key" &> /dev/null; then
            print_status "Deleting key: $key"
            az keyvault key delete --vault-name "$KEYVAULT_NAME" --name "$key" --yes
        else
            print_warning "Key '$key' not found, skipping"
        fi
    done
    
    print_status "Keys deletion completed"
}

# Function to delete all secrets (alternative method)
delete_all_secrets() {
    print_header "Deleting All Secrets (Alternative Method)"
    
    print_status "Retrieving all secrets..."
    local secrets=$(az keyvault secret list --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv)
    
    if [[ -z "$secrets" ]]; then
        print_warning "No secrets found in Key Vault"
        return
    fi
    
    for secret in $secrets; do
        print_status "Deleting secret: $secret"
        az keyvault secret delete --vault-name "$KEYVAULT_NAME" --name "$secret" --yes
    done
    
    print_status "All secrets deleted"
}

# Function to delete all certificates (alternative method)
delete_all_certificates() {
    print_header "Deleting All Certificates (Alternative Method)"
    
    print_status "Retrieving all certificates..."
    local certificates=$(az keyvault certificate list --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv)
    
    if [[ -z "$certificates" ]]; then
        print_warning "No certificates found in Key Vault"
        return
    fi
    
    for cert in $certificates; do
        print_status "Deleting certificate: $cert"
        az keyvault certificate delete --vault-name "$KEYVAULT_NAME" --name "$cert" --yes
    done
    
    print_status "All certificates deleted"
}

# Function to delete all keys (alternative method)
delete_all_keys() {
    print_header "Deleting All Keys (Alternative Method)"
    
    print_status "Retrieving all keys..."
    local keys=$(az keyvault key list --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv)
    
    if [[ -z "$keys" ]]; then
        print_warning "No keys found in Key Vault"
        return
    fi
    
    for key in $keys; do
        print_status "Deleting key: $key"
        az keyvault key delete --vault-name "$KEYVAULT_NAME" --name "$key" --yes
    done
    
    print_status "All keys deleted"
}

# Function to purge deleted items
purge_deleted_items() {
    print_header "Purging Deleted Items"
    
    print_status "Purging deleted secrets..."
    local deleted_secrets=$(az keyvault secret list-deleted --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv)
    
    if [[ -n "$deleted_secrets" ]]; then
        for secret in $deleted_secrets; do
            print_status "Purging deleted secret: $secret"
            az keyvault secret purge --vault-name "$KEYVAULT_NAME" --name "$secret"
        done
    fi
    
    print_status "Purging deleted certificates..."
    local deleted_certs=$(az keyvault certificate list-deleted --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv)
    
    if [[ -n "$deleted_certs" ]]; then
        for cert in $deleted_certs; do
            print_status "Purging deleted certificate: $cert"
            az keyvault certificate purge --vault-name "$KEYVAULT_NAME" --name "$cert"
        done
    fi
    
    print_status "Purging deleted keys..."
    local deleted_keys=$(az keyvault key list-deleted --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv)
    
    if [[ -n "$deleted_keys" ]]; then
        for key in $deleted_keys; do
            print_status "Purging deleted key: $key"
            az keyvault key purge --vault-name "$KEYVAULT_NAME" --name "$key"
        done
    fi
    
    print_status "Deleted items purged"
}

# Function to display cleanup summary
display_cleanup_summary() {
    print_header "Cleanup Summary"
    
    echo "Key Vault: $KEYVAULT_NAME"
    echo "Resource Group: $RESOURCE_GROUP"
    echo ""
    
    print_status "Cleanup completed successfully!"
    print_warning "Note: Deleted items are in soft-delete state for 90 days"
    print_warning "Use 'purge_deleted_items' function to permanently remove them"
}

# Function to show remaining items
show_remaining_items() {
    print_header "Remaining Items in Key Vault"
    
    print_status "Remaining secrets:"
    az keyvault secret list --vault-name "$KEYVAULT_NAME" --query "[].{Name:name,Enabled:attributes.enabled}" -o table
    
    print_status "Remaining certificates:"
    az keyvault certificate list --vault-name "$KEYVAULT_NAME" --query "[].{Name:name,Enabled:attributes.enabled}" -o table
    
    print_status "Remaining keys:"
    az keyvault key list --vault-name "$KEYVAULT_NAME" --query "[].{Name:name,Enabled:attributes.enabled}" -o table
}

# Main function
main() {
    print_header "Azure Key Vault Cleanup Script"
    print_status "This script will remove demo secrets from your Key Vault"
    
    # Get user input
    get_user_input
    
    # Delete specific demo items
    delete_secrets
    delete_certificates
    delete_keys
    
    # Alternative: Delete all items (uncomment if needed)
    # delete_all_secrets
    # delete_all_certificates
    # delete_all_keys
    
    # Show remaining items
    show_remaining_items
    
    # Display summary
    display_cleanup_summary
    
    print_status "Cleanup completed successfully!"
}

# Run main function
main "$@"

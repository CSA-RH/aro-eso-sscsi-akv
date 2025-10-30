#!/bin/bash

# Azure Resources Setup Script for Secrets Store CSI Driver
# This script creates Azure resources needed for the Secrets Store CSI driver

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load configuration
if [ -f "config.env" ]; then
    source config.env
    echo -e "${GREEN}✓ Configuration loaded from config.env${NC}"
else
    echo -e "${RED}✗ config.env not found. Please create it first.${NC}"
    exit 1
fi

# Function to print headers
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# Function to print status
print_status() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to create service principal
create_service_principal() {
    if [ "${AUTH_METHOD}" = "service-principal" ]; then
        print_header "Creating Azure Service Principal"
        
        print_status "Creating service principal for Key Vault access..."
        SP_OUTPUT=$(az ad sp create-for-rbac \
            --name "${SERVICE_PRINCIPAL_NAME}" \
            --role "Key Vault Secrets User" \
            --scopes "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${KEYVAULT_NAME}" \
            --output json)
        
        SP_CLIENT_ID=$(echo $SP_OUTPUT | jq -r '.appId')
        SP_CLIENT_SECRET=$(echo $SP_OUTPUT | jq -r '.password')
        
        print_status "Granting additional Key Vault permissions..."
        az role assignment create \
            --assignee "${SP_CLIENT_ID}" \
            --role "Key Vault Certificates Officer" \
            --scope "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${KEYVAULT_NAME}"
        
        az role assignment create \
            --assignee "${SP_CLIENT_ID}" \
            --role "Key Vault Crypto Officer" \
            --scope "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${KEYVAULT_NAME}"
        
        print_success "Service Principal created: ${SP_CLIENT_ID}"
        
        # Update config.env with new values
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/SERVICE_PRINCIPAL_CLIENT_ID=.*/SERVICE_PRINCIPAL_CLIENT_ID=\"${SP_CLIENT_ID}\"/" config.env
            sed -i '' "s/SERVICE_PRINCIPAL_CLIENT_SECRET=.*/SERVICE_PRINCIPAL_CLIENT_SECRET=\"${SP_CLIENT_SECRET}\"/" config.env
        else
            sed -i "s/SERVICE_PRINCIPAL_CLIENT_ID=.*/SERVICE_PRINCIPAL_CLIENT_ID=\"${SP_CLIENT_ID}\"/" config.env
            sed -i "s/SERVICE_PRINCIPAL_CLIENT_SECRET=.*/SERVICE_PRINCIPAL_CLIENT_SECRET=\"${SP_CLIENT_SECRET}\"/" config.env
        fi
        
        print_success "Updated config.env with new service principal credentials"
    else
        print_status "Skipping Service Principal creation (using Workload Identity)"
    fi
}

# Function to create managed identity
create_managed_identity() {
    if [ "${AUTH_METHOD}" = "workload-identity" ]; then
        print_header "Creating Azure Managed Identity"
        
        print_status "Creating managed identity..."
        az identity create \
            --name "${MANAGED_IDENTITY_NAME}" \
            --resource-group "${AZURE_RESOURCE_GROUP}"
        
        MANAGED_IDENTITY_CLIENT_ID=$(az identity show \
            --name "${MANAGED_IDENTITY_NAME}" \
            --resource-group "${AZURE_RESOURCE_GROUP}" \
            --query 'clientId' -o tsv)
        
        print_status "Granting Key Vault permissions to managed identity..."
        MANAGED_IDENTITY_OBJECT_ID=$(az identity show \
            --name "${MANAGED_IDENTITY_NAME}" \
            --resource-group "${AZURE_RESOURCE_GROUP}" \
            --query 'principalId' -o tsv)
        
        az role assignment create \
            --assignee-object-id "${MANAGED_IDENTITY_OBJECT_ID}" \
            --role "Key Vault Secrets User" \
            --scope "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${KEYVAULT_NAME}" \
            --assignee-principal-type ServicePrincipal
        
        az role assignment create \
            --assignee-object-id "${MANAGED_IDENTITY_OBJECT_ID}" \
            --role "Key Vault Certificates Officer" \
            --scope "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${KEYVAULT_NAME}" \
            --assignee-principal-type ServicePrincipal
        
        az role assignment create \
            --assignee-object-id "${MANAGED_IDENTITY_OBJECT_ID}" \
            --role "Key Vault Crypto Officer" \
            --scope "/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${AZURE_RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${KEYVAULT_NAME}" \
            --assignee-principal-type ServicePrincipal
        
        print_success "Managed Identity created: ${MANAGED_IDENTITY_CLIENT_ID}"
        
        # Update config.env with new values
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/MANAGED_IDENTITY_CLIENT_ID=.*/MANAGED_IDENTITY_CLIENT_ID=\"${MANAGED_IDENTITY_CLIENT_ID}\"/" config.env
        else
            sed -i "s/MANAGED_IDENTITY_CLIENT_ID=.*/MANAGED_IDENTITY_CLIENT_ID=\"${MANAGED_IDENTITY_CLIENT_ID}\"/" config.env
        fi
        
        print_success "Updated config.env with new managed identity client ID"
    else
        print_status "Skipping Managed Identity creation (using Service Principal)"
    fi
}

# Function to create federated credentials
create_federated_credentials() {
    if [ "${AUTH_METHOD}" = "workload-identity" ]; then
        print_header "Creating Federated Credentials"
        
        print_status "Creating federated credential for main ServiceAccount..."
        az identity federated-credential create \
            --name "aro-secrets-store-csi-federated-credential" \
            --identity-name "${MANAGED_IDENTITY_NAME}" \
            --resource-group "${AZURE_RESOURCE_GROUP}" \
            --issuer "${OIDC_ISSUER_URL}" \
            --subject "system:serviceaccount:${NAMESPACE}:${SERVICE_ACCOUNT_NAME}"
        
        print_status "Creating federated credential for test ServiceAccount..."
        az identity federated-credential create \
            --name "aro-secrets-store-test-federated-credential" \
            --identity-name "${MANAGED_IDENTITY_NAME}" \
            --resource-group "${AZURE_RESOURCE_GROUP}" \
            --issuer "${OIDC_ISSUER_URL}" \
            --subject "system:serviceaccount:${TEST_NAMESPACE}:${TEST_SERVICE_ACCOUNT}"
        
        print_success "Federated credentials created"
    else
        print_status "Skipping Federated Credentials creation (using Service Principal)"
    fi
}

# Function to get OIDC issuer URL
get_oidc_issuer() {
    if [ "${AUTH_METHOD}" = "workload-identity" ]; then
        print_header "Getting OIDC Issuer URL"
        
        print_status "Getting OIDC issuer from cluster..."
        OIDC_ISSUER=$(oc get authentication cluster -o jsonpath='{.spec.serviceAccountIssuer}')
        
        if [ -z "$OIDC_ISSUER" ]; then
            print_status "Getting OIDC issuer from Azure CLI..."
            OIDC_ISSUER=$(az aro show \
                --subscription "${AZURE_SUBSCRIPTION_ID}" \
                --name "${AZURE_CLUSTER_NAME}" \
                --resource-group "${AZURE_RESOURCE_GROUP}" \
                --query "clusterProfile.oidcIssuer" \
                --output tsv)
        fi
        
        if [ -z "$OIDC_ISSUER" ] || [ "$OIDC_ISSUER" = "null" ]; then
            print_error "OIDC issuer is not configured on this ARO cluster."
            echo ""
            echo -e "${YELLOW}This cluster needs to be upgraded or configured for Workload Identity.${NC}"
            echo ""
            echo -e "${YELLOW}Options:${NC}"
            echo "1. Upgrade the ARO cluster to a version that supports OIDC issuer"
            echo "2. Switch to Service Principal authentication (recommended for now)"
            echo "3. Manually configure OIDC issuer (requires Azure support)"
            echo ""
            echo -e "${YELLOW}To switch to Service Principal authentication:${NC}"
            echo "1. Edit config.env and set: AUTH_METHOD=\"service-principal\""
            echo "2. Run this script again"
            echo ""
            read -p "Do you want to continue with Service Principal setup instead? (y/n): " switch_to_sp
            
            if [ "$switch_to_sp" = "y" ] || [ "$switch_to_sp" = "Y" ]; then
                print_status "Switching to Service Principal authentication..."
                # Use a more compatible approach for macOS sed
                if [[ "$OSTYPE" == "darwin"* ]]; then
                    # macOS sed requires empty string for in-place editing
                    sed -i '' 's/AUTH_METHOD="workload-identity"/AUTH_METHOD="service-principal"/' config.env
                else
                    # Linux sed
                    sed -i 's/AUTH_METHOD="workload-identity"/AUTH_METHOD="service-principal"/' config.env
                fi
                source config.env
                print_success "Switched to Service Principal authentication"
                return 0
            else
                print_error "Cannot proceed without OIDC issuer configuration."
                exit 1
            fi
        fi
        
        print_success "OIDC Issuer URL: ${OIDC_ISSUER}"
        
        # Update config.env with OIDC issuer
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|OIDC_ISSUER_URL=.*|OIDC_ISSUER_URL=\"${OIDC_ISSUER}\"|" config.env
        else
            sed -i "s|OIDC_ISSUER_URL=.*|OIDC_ISSUER_URL=\"${OIDC_ISSUER}\"|" config.env
        fi
        
        print_success "Updated config.env with OIDC issuer URL"
    else
        print_status "Skipping OIDC issuer setup (using Service Principal)"
    fi
}

# Function to show summary
show_summary() {
    print_header "Azure Resources Summary"
    
    echo -e "${YELLOW}Authentication Method: ${AUTH_METHOD}${NC}"
    echo ""
    
    if [ "${AUTH_METHOD}" = "workload-identity" ]; then
        echo -e "${YELLOW}Managed Identity:${NC}"
        echo "• Client ID: ${MANAGED_IDENTITY_CLIENT_ID}"
        echo "• Name: ${MANAGED_IDENTITY_NAME}"
        echo ""
        echo -e "${YELLOW}OIDC Configuration:${NC}"
        echo "• Issuer URL: ${OIDC_ISSUER_URL}"
    else
        echo -e "${YELLOW}Service Principal:${NC}"
        echo "• Client ID: ${SERVICE_PRINCIPAL_CLIENT_ID}"
        echo "• Name: ${SERVICE_PRINCIPAL_NAME}"
    fi
    
    echo ""
    echo -e "${YELLOW}Key Vault:${NC}"
    echo "• Name: ${KEYVAULT_NAME}"
    echo "• URL: ${KEYVAULT_URL}"
    
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Run the installation script: ./install.sh"
    echo "2. Test with the appropriate authentication method"
}

# Main function
main() {
    print_header "Azure Resources Setup for Secrets Store CSI Driver"
    
    # Check if Azure CLI is logged in
    if ! az account show &> /dev/null; then
        print_error "Not logged in to Azure CLI. Please run 'az login' first."
        exit 1
    fi
    
    get_oidc_issuer
    create_service_principal
    create_managed_identity
    create_federated_credentials
    show_summary
    
    print_success "Azure resources setup completed!"
}

# Run main function
main "$@"

#!/bin/bash

# Script to populate Azure Key Vault with RBAC-specific secrets
# This demonstrates different access patterns for multi-tenant environments

set -e

# Source configuration
source config.env

print_header() {
    echo "========================================"
    echo "$1"
    echo "========================================"
}

print_status() {
    echo "→ $1"
}

print_success() {
    echo "✓ $1"
}

print_error() {
    echo "✗ $1"
}

# Function to create RBAC-specific secrets
create_rbac_secrets() {
    print_header "Creating RBAC-specific secrets in Azure Key Vault"
    
    print_status "Creating namespace-specific secrets..."
    
    # Namespace-specific secrets (using test namespace)
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "namespace-${TEST_NAMESPACE}-db-password" \
        --value "NamespaceSpecificDBPassword-${TEST_NAMESPACE}-123!" \
        --description "Database password specific to ${TEST_NAMESPACE} namespace"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "namespace-${TEST_NAMESPACE}-api-key" \
        --value "ns-${TEST_NAMESPACE}-api-key-$(date +%s)" \
        --description "API key specific to ${TEST_NAMESPACE} namespace"
    
    print_status "Creating environment-specific secrets..."
    
    # Environment-specific secrets
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "dev-database-url" \
        --value "postgresql://dev-db.example.com:5432/devdb" \
        --description "Development database URL"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "dev-redis-password" \
        --value "dev-redis-password-$(date +%s)" \
        --description "Development Redis password"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "dev-jwt-secret" \
        --value "dev-jwt-secret-$(openssl rand -hex 32)" \
        --description "Development JWT secret"
    
    print_status "Creating application-specific secrets..."
    
    # Application-specific secrets
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "app-payment-service-api-key" \
        --value "payment-api-key-$(openssl rand -hex 16)" \
        --description "Payment service API key"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "app-user-service-db-password" \
        --value "user-service-db-password-$(openssl rand -hex 12)" \
        --description "User service database password"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "app-notification-service-key" \
        --value "notification-service-key-$(openssl rand -hex 20)" \
        --description "Notification service key"
    
    print_status "Creating shared secrets..."
    
    # Shared secrets (accessible across namespaces/environments)
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "shared-readonly-config" \
        --value "shared-config-value-$(date +%s)" \
        --description "Shared read-only configuration"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "shared-monitoring-key" \
        --value "monitoring-key-$(openssl rand -hex 16)" \
        --description "Shared monitoring key"
    
    az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
        --name "shared-audit-log-key" \
        --value "audit-log-key-$(openssl rand -hex 24)" \
        --description "Shared audit logging key"
    
    print_success "RBAC-specific secrets created successfully!"
}

# Function to create additional namespaces for testing
create_test_namespaces() {
    print_header "Creating additional test namespaces for RBAC testing"
    
    print_status "Creating namespace: rbac-test-ns1..."
    oc create namespace rbac-test-ns1 --dry-run=client -o yaml | oc apply -f -
    
    print_status "Creating namespace: rbac-test-ns2..."
    oc create namespace rbac-test-ns2 --dry-run=client -o yaml | oc apply -f -
    
    print_status "Creating namespace: rbac-test-ns3..."
    oc create namespace rbac-test-ns3 --dry-run=client -o yaml | oc apply -f -
    
    print_success "Test namespaces created successfully!"
}

# Function to create namespace-specific secrets for other namespaces
create_namespace_specific_secrets() {
    print_header "Creating namespace-specific secrets for other namespaces"
    
    local namespaces=("rbac-test-ns1" "rbac-test-ns2" "rbac-test-ns3")
    
    for ns in "${namespaces[@]}"; do
        print_status "Creating secrets for namespace: ${ns}..."
        
        az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
            --name "namespace-${ns}-db-password" \
            --value "NamespaceSpecificDBPassword-${ns}-123!" \
            --description "Database password specific to ${ns} namespace"
        
        az keyvault secret set --vault-name "${KEYVAULT_NAME}" \
            --name "namespace-${ns}-api-key" \
            --value "ns-${ns}-api-key-$(date +%s)" \
            --description "API key specific to ${ns} namespace"
    done
    
    print_success "Namespace-specific secrets created for all test namespaces!"
}

# Function to show RBAC examples
show_rbac_examples() {
    print_header "RBAC Examples Created"
    
    echo "The following RBAC patterns are now available:"
    echo ""
    echo "1. 📁 Namespace-based RBAC:"
    echo "   - namespace-${TEST_NAMESPACE}-db-password"
    echo "   - namespace-${TEST_NAMESPACE}-api-key"
    echo "   - shared-readonly-config"
    echo ""
    echo "2. 🌍 Environment-based RBAC:"
    echo "   - dev-database-url"
    echo "   - dev-redis-password"
    echo "   - dev-jwt-secret"
    echo "   - shared-monitoring-key"
    echo ""
    echo "3. 🏢 Application-based RBAC:"
    echo "   - app-payment-service-api-key"
    echo "   - app-user-service-db-password"
    echo "   - app-notification-service-key"
    echo "   - shared-audit-log-key"
    echo ""
    echo "4. 🏗️ Multi-namespace RBAC:"
    echo "   - namespace-rbac-test-ns1-*"
    echo "   - namespace-rbac-test-ns2-*"
    echo "   - namespace-rbac-test-ns3-*"
    echo ""
    echo "To test these examples:"
    echo "  ./bin/examples apply namespace-based-rbac"
    echo "  ./bin/examples apply environment-based-rbac"
    echo "  ./bin/examples apply application-based-rbac"
}

# Main execution
main() {
    print_header "Azure Key Vault RBAC Secrets Setup"
    
    # Check prerequisites
    if ! command -v az &> /dev/null; then
        print_error "Azure CLI not found. Please install Azure CLI."
        exit 1
    fi
    
    if ! command -v oc &> /dev/null; then
        print_error "OpenShift CLI not found. Please install oc."
        exit 1
    fi
    
    # Create RBAC secrets
    create_rbac_secrets
    
    # Create test namespaces
    create_test_namespaces
    
    # Create namespace-specific secrets
    create_namespace_specific_secrets
    
    # Show examples
    show_rbac_examples
    
    print_success "RBAC setup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Apply RBAC examples: ./bin/examples apply namespace-based-rbac"
    echo "2. Test cross-namespace access restrictions"
    echo "3. Verify shared secrets are accessible across namespaces"
}

# Run main function
main "$@"

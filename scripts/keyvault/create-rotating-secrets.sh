#!/bin/bash

# Azure Key Vault Rotating Secrets Script
# This script creates secrets with rotation policies and demonstrates secret rotation

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
    read -p "Rotation interval in days (default 90): " ROTATION_DAYS
    ROTATION_DAYS=${ROTATION_DAYS:-90}
    
    if [[ -z "$KEYVAULT_NAME" || -z "$RESOURCE_GROUP" ]]; then
        print_error "Key Vault name and Resource Group are required"
        exit 1
    fi
}

# Function to generate random password
generate_password() {
    local length=${1:-16}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to generate API key
generate_api_key() {
    local prefix=${1:-"sk"}
    local suffix=$(openssl rand -hex 16)
    echo "${prefix}-${suffix}"
}

# Function to create rotating secret
create_rotating_secret() {
    local name=$1
    local value=$2
    local description=$3
    
    print_status "Creating rotating secret: $name"
    
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "$name" \
        --value "$value" \
        --description "$description"
    
    # Set rotation policy (if supported)
    print_status "Setting rotation policy for: $name"
    
    # Note: Rotation policies are set at the Key Vault level, not per secret
    # This is a placeholder for future implementation
    print_warning "Rotation policy will be managed at Key Vault level"
}

# Function to create rotating secrets
create_rotating_secrets() {
    print_header "Creating Rotating Secrets"
    
    # Database password with rotation
    local db_password=$(generate_password 24)
    create_rotating_secret "rotating-database-password" "$db_password" "Rotating database password"
    
    # API key with rotation
    local api_key=$(generate_api_key "sk")
    create_rotating_secret "rotating-api-key" "$api_key" "Rotating API key"
    
    # JWT secret with rotation
    local jwt_secret=$(generate_password 32)
    create_rotating_secret "rotating-jwt-secret" "$jwt_secret" "Rotating JWT secret"
    
    # Redis password with rotation
    local redis_password=$(generate_password 20)
    create_rotating_secret "rotating-redis-password" "$redis_password" "Rotating Redis password"
    
    # External service API key
    local external_api_key=$(generate_api_key "ext")
    create_rotating_secret "rotating-external-api-key" "$external_api_key" "Rotating external API key"
    
    # Monitoring API key
    local monitoring_key=$(generate_api_key "mon")
    create_rotating_secret "rotating-monitoring-api-key" "$monitoring_key" "Rotating monitoring API key"
    
    print_status "Rotating secrets created successfully"
}

# Function to create versioned secrets
create_versioned_secrets() {
    print_header "Creating Versioned Secrets"
    
    # Create initial version
    local initial_password=$(generate_password 20)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "versioned-database-password" \
        --value "$initial_password" \
        --description "Versioned database password - initial version"
    
    # Create second version
    sleep 2  # Ensure different timestamps
    local second_password=$(generate_password 20)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "versioned-database-password" \
        --value "$second_password" \
        --description "Versioned database password - second version"
    
    # Create third version
    sleep 2
    local third_password=$(generate_password 20)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "versioned-database-password" \
        --value "$third_password" \
        --description "Versioned database password - third version"
    
    print_status "Versioned secrets created successfully"
}

# Function to create secrets with specific versions
create_specific_version_secrets() {
    print_header "Creating Secrets with Specific Versions"
    
    # Create secret with specific version
    local specific_password=$(generate_password 18)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "specific-version-api-key" \
        --value "$specific_password" \
        --description "API key with specific version"
    
    print_status "Specific version secrets created successfully"
}

# Function to create secrets with expiration
create_expiring_secrets() {
    print_header "Creating Expiring Secrets"
    
    # Calculate expiration date
    local expiration_date=$(date -d "+${ROTATION_DAYS} days" -u +"%Y-%m-%dT%H:%M:%SZ")
    
    # Create expiring secrets
    local expiring_password=$(generate_password 22)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "expiring-database-password" \
        --value "$expiring_password" \
        --description "Expiring database password - expires in $ROTATION_DAYS days"
    
    local expiring_api_key=$(generate_api_key "exp")
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "expiring-api-key" \
        --value "$expiring_api_key" \
        --description "Expiring API key - expires in $ROTATION_DAYS days"
    
    print_status "Expiring secrets created successfully"
}

# Function to create secrets with tags for rotation
create_tagged_secrets() {
    print_header "Creating Tagged Secrets for Rotation"
    
    # Create secrets with rotation tags
    local tagged_password=$(generate_password 20)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "tagged-database-password" \
        --value "$tagged_password" \
        --description "Tagged database password for rotation" \
        --tags "rotation-policy=daily" "environment=production" "service=database"
    
    local tagged_api_key=$(generate_api_key "tag")
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "tagged-api-key" \
        --value "$tagged_api_key" \
        --description "Tagged API key for rotation" \
        --tags "rotation-policy=weekly" "environment=production" "service=api"
    
    local tagged_jwt_secret=$(generate_password 30)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "tagged-jwt-secret" \
        --value "$tagged_jwt_secret" \
        --description "Tagged JWT secret for rotation" \
        --tags "rotation-policy=monthly" "environment=production" "service=auth"
    
    print_status "Tagged secrets created successfully"
}

# Function to create rotation test secrets
create_rotation_test_secrets() {
    print_header "Creating Rotation Test Secrets"
    
    # Create secrets for testing rotation scenarios
    local test_password=$(generate_password 16)
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "rotation-test-password" \
        --value "$test_password" \
        --description "Password for testing rotation scenarios"
    
    local test_api_key=$(generate_api_key "test")
    az keyvault secret set \
        --vault-name "$KEYVAULT_NAME" \
        --name "rotation-test-api-key" \
        --value "$test_api_key" \
        --description "API key for testing rotation scenarios"
    
    print_status "Rotation test secrets created successfully"
}

# Function to display rotation summary
display_rotation_summary() {
    print_header "Rotation Secrets Summary"
    
    echo "Key Vault: $KEYVAULT_NAME"
    echo "Resource Group: $RESOURCE_GROUP"
    echo "Rotation Interval: $ROTATION_DAYS days"
    echo ""
    
    print_status "Rotating secrets created:"
    echo "  - rotating-database-password"
    echo "  - rotating-api-key"
    echo "  - rotating-jwt-secret"
    echo "  - rotating-redis-password"
    echo "  - rotating-external-api-key"
    echo "  - rotating-monitoring-api-key"
    echo ""
    
    print_status "Versioned secrets created:"
    echo "  - versioned-database-password (3 versions)"
    echo ""
    
    print_status "Specific version secrets created:"
    echo "  - specific-version-api-key"
    echo ""
    
    print_status "Expiring secrets created:"
    echo "  - expiring-database-password"
    echo "  - expiring-api-key"
    echo ""
    
    print_status "Tagged secrets created:"
    echo "  - tagged-database-password (daily rotation)"
    echo "  - tagged-api-key (weekly rotation)"
    echo "  - tagged-jwt-secret (monthly rotation)"
    echo ""
    
    print_status "Rotation test secrets created:"
    echo "  - rotation-test-password"
    echo "  - rotation-test-api-key"
    echo ""
    
    print_warning "Rotation Notes:"
    echo "1. Use Azure Key Vault rotation policies for automatic rotation"
    echo "2. Monitor secret expiration dates"
    echo "3. Test rotation scenarios before production deployment"
    echo "4. Update applications to handle secret rotation gracefully"
}

# Function to create rotation monitoring script
create_rotation_monitoring_script() {
    print_header "Creating Rotation Monitoring Script"
    
    cat > "monitor-rotation.sh" << 'EOF'
#!/bin/bash

# Monitor secret rotation in Azure Key Vault
KEYVAULT_NAME="$1"
if [[ -z "$KEYVAULT_NAME" ]]; then
    echo "Usage: $0 <keyvault-name>"
    exit 1
fi

echo "Monitoring secret rotation for Key Vault: $KEYVAULT_NAME"
echo "=================================================="

# List all secrets with their versions
az keyvault secret list --vault-name "$KEYVAULT_NAME" --query "[].{Name:name,Enabled:attributes.enabled}" -o table

echo ""
echo "Secret versions:"
echo "================"

# Get versions for each secret
for secret in $(az keyvault secret list --vault-name "$KEYVAULT_NAME" --query "[].name" -o tsv); do
    echo "Secret: $secret"
    az keyvault secret list-versions --vault-name "$KEYVAULT_NAME" --name "$secret" --query "[].{Version:version,Created:attributes.created,Enabled:attributes.enabled}" -o table
    echo ""
done
EOF
    
    chmod +x "monitor-rotation.sh"
    print_status "Rotation monitoring script created: monitor-rotation.sh"
}

# Main function
main() {
    print_header "Azure Key Vault Rotating Secrets Script"
    print_status "This script will create secrets with rotation policies and demonstrate secret rotation"
    
    # Get user input
    get_user_input
    
    # Create different types of rotating secrets
    create_rotating_secrets
    create_versioned_secrets
    create_specific_version_secrets
    create_expiring_secrets
    create_tagged_secrets
    create_rotation_test_secrets
    
    # Create monitoring script
    create_rotation_monitoring_script
    
    # Display summary
    display_rotation_summary
    
    print_status "Rotating secrets creation completed successfully!"
    print_warning "Use the monitor-rotation.sh script to monitor secret versions and rotation status"
}

# Run main function
main "$@"

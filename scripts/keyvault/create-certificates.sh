#!/bin/bash

# Azure Key Vault TLS Certificate Creation Script
# This script creates and uploads TLS certificates to Azure Key Vault for demo purposes

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

# Function to check if OpenSSL is available
check_openssl() {
    if ! command -v openssl &> /dev/null; then
        print_error "OpenSSL is not installed. Please install it first."
        exit 1
    fi
    print_status "OpenSSL is available"
}

# Function to get user input
get_user_input() {
    echo "Please provide the following information:"
    read -p "Azure Key Vault Name: " KEYVAULT_NAME
    read -p "Resource Group: " RESOURCE_GROUP
    read -p "Certificate validity days (default 365): " VALIDITY_DAYS
    VALIDITY_DAYS=${VALIDITY_DAYS:-365}
    
    if [[ -z "$KEYVAULT_NAME" || -z "$RESOURCE_GROUP" ]]; then
        print_error "Key Vault name and Resource Group are required"
        exit 1
    fi
}

# Function to create certificate
create_certificate() {
    local name=$1
    local subject=$2
    local key_file="${name}.key"
    local csr_file="${name}.csr"
    local cert_file="${name}.crt"
    local pfx_file="${name}.pfx"
    
    print_status "Creating certificate: $name"
    
    # Generate private key
    openssl genrsa -out "$key_file" 2048
    
    # Generate certificate signing request
    openssl req -new -key "$key_file" -out "$csr_file" -subj "$subject"
    
    # Generate self-signed certificate
    openssl x509 -req -days "$VALIDITY_DAYS" -in "$csr_file" -signkey "$key_file" -out "$cert_file"
    
    # Convert to PFX format for Key Vault
    openssl pkcs12 -export -out "$pfx_file" -inkey "$key_file" -in "$cert_file" -passout pass:""
    
    # Upload to Key Vault
    az keyvault certificate import \
        --vault-name "$KEYVAULT_NAME" \
        --name "$name" \
        --file "$pfx_file" \
        --password ""
    
    print_status "Certificate '$name' uploaded successfully"
}

# Function to create multiple certificates
create_all_certificates() {
    print_header "Creating TLS Certificates"
    
    # Create temporary directory
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Web application certificate
    create_certificate "webapp-tls-cert" "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=webapp.demo.com"
    
    # Wildcard certificate
    create_certificate "wildcard-tls-cert" "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=*.demo.com"
    
    # API Gateway certificate
    create_certificate "api-gateway-cert" "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=api.demo.com"
    
    # Load balancer certificate
    create_certificate "lb-tls-cert" "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=lb.demo.com"
    
    # Database certificate
    create_certificate "db-tls-cert" "/C=US/ST=CA/L=San Francisco/O=Demo Company/CN=db.demo.com"
    
    # Clean up
    cd - > /dev/null
    rm -rf "$TEMP_DIR"
    
    print_status "All certificates created successfully"
}

# Function to create certificate with SAN (Subject Alternative Names)
create_san_certificate() {
    local name=$1
    local key_file="${name}.key"
    local csr_file="${name}.csr"
    local cert_file="${name}.crt"
    local pfx_file="${name}.pfx"
    local config_file="${name}.conf"
    
    print_status "Creating SAN certificate: $name"
    
    # Create OpenSSL config file
    cat > "$config_file" << EOF
[req]
default_bits = 2048
prompt = no
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]
C = US
ST = CA
L = San Francisco
O = Demo Company
CN = $name.demo.com

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $name.demo.com
DNS.2 = www.$name.demo.com
DNS.3 = api.$name.demo.com
DNS.4 = admin.$name.demo.com
EOF
    
    # Generate private key
    openssl genrsa -out "$key_file" 2048
    
    # Generate certificate signing request with SAN
    openssl req -new -key "$key_file" -out "$csr_file" -config "$config_file"
    
    # Generate self-signed certificate with SAN
    openssl x509 -req -days "$VALIDITY_DAYS" -in "$csr_file" -signkey "$key_file" -out "$cert_file" -extensions v3_req -extfile "$config_file"
    
    # Convert to PFX format
    openssl pkcs12 -export -out "$pfx_file" -inkey "$key_file" -in "$cert_file" -passout pass:""
    
    # Upload to Key Vault
    az keyvault certificate import \
        --vault-name "$KEYVAULT_NAME" \
        --name "$name" \
        --file "$pfx_file" \
        --password ""
    
    print_status "SAN certificate '$name' uploaded successfully"
}

# Function to create SAN certificates
create_san_certificates() {
    print_header "Creating SAN Certificates"
    
    # Create temporary directory
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Multi-domain certificate
    create_san_certificate "multi-domain-cert"
    
    # Microservices certificate
    create_san_certificate "microservices-cert"
    
    # Clean up
    cd - > /dev/null
    rm -rf "$TEMP_DIR"
    
    print_status "SAN certificates created successfully"
}

# Function to display certificate summary
display_summary() {
    print_header "Certificate Creation Summary"
    
    echo "Key Vault: $KEYVAULT_NAME"
    echo "Resource Group: $RESOURCE_GROUP"
    echo "Validity: $VALIDITY_DAYS days"
    echo ""
    
    print_status "Certificates created:"
    echo "  - webapp-tls-cert (webapp.demo.com)"
    echo "  - wildcard-tls-cert (*.demo.com)"
    echo "  - api-gateway-cert (api.demo.com)"
    echo "  - lb-tls-cert (lb.demo.com)"
    echo "  - db-tls-cert (db.demo.com)"
    echo "  - multi-domain-cert (with SAN)"
    echo "  - microservices-cert (with SAN)"
    echo ""
    
    print_warning "Note: These are self-signed certificates for demo purposes only."
    print_warning "For production use, use certificates from a trusted CA."
}

# Main function
main() {
    print_header "Azure Key Vault TLS Certificate Creation Script"
    print_status "This script will create and upload TLS certificates to your Key Vault"
    
    # Check prerequisites
    check_openssl
    
    # Get user input
    get_user_input
    
    # Create certificates
    create_all_certificates
    create_san_certificates
    
    # Display summary
    display_summary
    
    print_status "Certificate creation completed successfully!"
}

# Run main function
main "$@"

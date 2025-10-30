# Azure Key Vault Secret Population Script (PowerShell)
# This script populates Azure Key Vault with example secrets for Secrets Store CSI driver demo

param(
    [Parameter(Mandatory=$true)]
    [string]$KeyVaultName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup,
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "eastus",
    
    [Parameter(Mandatory=$false)]
    [int]$ValidityDays = 365
)

# Function to write colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Header {
    param([string]$Message)
    Write-Host "[HEADER] $Message" -ForegroundColor Blue
}

# Function to check if Azure PowerShell is installed and logged in
function Test-AzurePowerShell {
    Write-Status "Checking Azure PowerShell..."
    
    if (-not (Get-Module -ListAvailable -Name Az)) {
        Write-Error "Azure PowerShell module is not installed. Please install it first."
        exit 1
    }
    
    try {
        $context = Get-AzContext
        if (-not $context) {
            Write-Error "Not logged in to Azure PowerShell. Please run 'Connect-AzAccount' first."
            exit 1
        }
        Write-Status "Azure PowerShell is ready"
    }
    catch {
        Write-Error "Not logged in to Azure PowerShell. Please run 'Connect-AzAccount' first."
        exit 1
    }
}

# Function to create Key Vault if it doesn't exist
function New-KeyVaultIfNotExists {
    Write-Status "Checking if Key Vault exists..."
    
    try {
        $kv = Get-AzKeyVault -VaultName $KeyVaultName -ResourceGroupName $ResourceGroup -ErrorAction Stop
        Write-Status "Key Vault '$KeyVaultName' already exists"
    }
    catch {
        Write-Status "Creating Key Vault '$KeyVaultName'..."
        New-AzKeyVault -VaultName $KeyVaultName -ResourceGroupName $ResourceGroup -Location $Location -Sku Standard -EnableRbacAuthorization
        Write-Status "Key Vault created successfully"
    }
}

# Function to generate random password
function New-RandomPassword {
    param([int]$Length = 16)
    
    $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*"
    $password = ""
    for ($i = 0; $i -lt $Length; $i++) {
        $password += $chars[(Get-Random -Maximum $chars.Length)]
    }
    return $password
}

# Function to generate API key
function New-RandomApiKey {
    param([string]$Prefix = "sk")
    
    $suffix = -join ((1..16) | ForEach {Get-Random -InputObject @('0','1','2','3','4','5','6','7','8','9','a','b','c','d','e','f')})
    return "$Prefix-$suffix"
}

# Function to populate basic secrets
function New-BasicSecrets {
    Write-Header "Populating Basic Secrets"
    
    # Database password
    $dbPassword = New-RandomPassword -Length 24
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "database-password" -SecretValue (ConvertTo-SecureString $dbPassword -AsPlainText -Force) -Description "Database password for the application"
    Write-Status "Created database-password secret"
    
    # API key
    $apiKey = New-RandomApiKey -Prefix "sk"
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "api-key" -SecretValue (ConvertTo-SecureString $apiKey -AsPlainText -Force) -Description "API key for external services"
    Write-Status "Created api-key secret"
    
    # JWT secret
    $jwtSecret = New-RandomPassword -Length 32
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "jwt-secret" -SecretValue (ConvertTo-SecureString $jwtSecret -AsPlainText -Force) -Description "JWT signing secret"
    Write-Status "Created jwt-secret secret"
    
    # Redis password
    $redisPassword = New-RandomPassword -Length 20
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "redis-password" -SecretValue (ConvertTo-SecureString $redisPassword -AsPlainText -Force) -Description "Redis cache password"
    Write-Status "Created redis-password secret"
    
    Write-Status "Basic secrets created successfully"
}

# Function to populate environment-specific secrets
function New-EnvironmentSecrets {
    Write-Header "Populating Environment-Specific Secrets"
    
    # Production secrets
    Write-Status "Creating production secrets..."
    $prodDbPassword = New-RandomPassword -Length 24
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "prod-database-password" -SecretValue (ConvertTo-SecureString $prodDbPassword -AsPlainText -Force) -Description "Production database password"
    
    $prodApiKey = New-RandomApiKey -Prefix "prod-sk"
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "prod-api-key" -SecretValue (ConvertTo-SecureString $prodApiKey -AsPlainText -Force) -Description "Production API key"
    
    # Staging secrets
    Write-Status "Creating staging secrets..."
    $stagingDbPassword = New-RandomPassword -Length 24
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "staging-database-password" -SecretValue (ConvertTo-SecureString $stagingDbPassword -AsPlainText -Force) -Description "Staging database password"
    
    $stagingApiKey = New-RandomApiKey -Prefix "staging-sk"
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "staging-api-key" -SecretValue (ConvertTo-SecureString $stagingApiKey -AsPlainText -Force) -Description "Staging API key"
    
    # Development secrets
    Write-Status "Creating development secrets..."
    $devDbPassword = New-RandomPassword -Length 24
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "dev-database-password" -SecretValue (ConvertTo-SecureString $devDbPassword -AsPlainText -Force) -Description "Development database password"
    
    $devApiKey = New-RandomApiKey -Prefix "dev-sk"
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "dev-api-key" -SecretValue (ConvertTo-SecureString $devApiKey -AsPlainText -Force) -Description "Development API key"
    
    # Shared secrets
    Write-Status "Creating shared secrets..."
    $sharedJwtSecret = New-RandomPassword -Length 32
    Set-AzKeyVaultSecret -VaultName $KeyVaultName -Name "shared-jwt-secret" -SecretValue (ConvertTo-SecureString $sharedJwtSecret -AsPlainText -Force) -Description "Shared JWT secret across environments"
    
    Write-Status "Environment-specific secrets created successfully"
}

# Function to create self-signed certificates
function New-DemoCertificates {
    Write-Header "Creating Demo Certificates"
    
    # Create temporary directory
    $tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
    
    try {
        # Generate private key
        Write-Status "Generating private key..."
        $keyFile = Join-Path $tempDir "webapp.key"
        $certFile = Join-Path $tempDir "webapp.crt"
        
        # Create self-signed certificate
        $cert = New-SelfSignedCertificate -Subject "CN=webapp.demo.com" -CertStoreLocation "Cert:\CurrentUser\My" -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays($ValidityDays)
        
        # Export certificate
        Export-Certificate -Cert $cert -FilePath $certFile -Type CERT
        
        # Upload certificate to Key Vault
        Write-Status "Uploading webapp-tls-cert to Key Vault..."
        Import-AzKeyVaultCertificate -VaultName $KeyVaultName -Name "webapp-tls-cert" -FilePath $certFile
        
        # Create wildcard certificate
        Write-Status "Generating wildcard certificate..."
        $wildcardCert = New-SelfSignedCertificate -Subject "CN=*.demo.com" -CertStoreLocation "Cert:\CurrentUser\My" -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays($ValidityDays)
        
        $wildcardCertFile = Join-Path $tempDir "wildcard.crt"
        Export-Certificate -Cert $wildcardCert -FilePath $wildcardCertFile -Type CERT
        
        Write-Status "Uploading wildcard-tls-cert to Key Vault..."
        Import-AzKeyVaultCertificate -VaultName $KeyVaultName -Name "wildcard-tls-cert" -FilePath $wildcardCertFile
        
        # Create API gateway certificate
        Write-Status "Generating API gateway certificate..."
        $apiCert = New-SelfSignedCertificate -Subject "CN=api.demo.com" -CertStoreLocation "Cert:\CurrentUser\My" -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays($ValidityDays)
        
        $apiCertFile = Join-Path $tempDir "api-gateway.crt"
        Export-Certificate -Cert $apiCert -FilePath $apiCertFile -Type CERT
        
        Write-Status "Uploading api-gateway-cert to Key Vault..."
        Import-AzKeyVaultCertificate -VaultName $KeyVaultName -Name "api-gateway-cert" -FilePath $apiCertFile
        
        Write-Status "Demo certificates created successfully"
    }
    finally {
        # Clean up temporary directory
        Remove-Item -Path $tempDir -Recurse -Force
    }
}

# Function to create encryption keys
function New-EncryptionKeys {
    Write-Header "Creating Encryption Keys"
    
    # Generate encryption key
    Write-Status "Creating encryption-key..."
    Add-AzKeyVaultKey -VaultName $KeyVaultName -Name "encryption-key" -Destination Software -KeyType RSA -KeySize 2048
    
    # Generate shared encryption key
    Write-Status "Creating shared-encryption-key..."
    Add-AzKeyVaultKey -VaultName $KeyVaultName -Name "shared-encryption-key" -Destination Software -KeyType RSA -KeySize 2048
    
    Write-Status "Encryption keys created successfully"
}

# Function to display summary
function Show-Summary {
    Write-Header "Key Vault Population Summary"
    
    Write-Host "Key Vault: $KeyVaultName"
    Write-Host "Resource Group: $ResourceGroup"
    Write-Host "Location: $Location"
    Write-Host ""
    
    Write-Status "Secrets created:"
    Write-Host "  - database-password"
    Write-Host "  - api-key"
    Write-Host "  - jwt-secret"
    Write-Host "  - redis-password"
    Write-Host "  - prod-database-password"
    Write-Host "  - prod-api-key"
    Write-Host "  - staging-database-password"
    Write-Host "  - staging-api-key"
    Write-Host "  - dev-database-password"
    Write-Host "  - dev-api-key"
    Write-Host "  - shared-jwt-secret"
    Write-Host ""
    
    Write-Status "Certificates created:"
    Write-Host "  - webapp-tls-cert"
    Write-Host "  - wildcard-tls-cert"
    Write-Host "  - api-gateway-cert"
    Write-Host ""
    
    Write-Status "Keys created:"
    Write-Host "  - encryption-key"
    Write-Host "  - shared-encryption-key"
    Write-Host ""
    
    Write-Warning "Next steps:"
    Write-Host "1. Update your SecretProviderClass examples with this Key Vault name"
    Write-Host "2. Grant your Managed Identity access to this Key Vault"
    Write-Host "3. Test the Secrets Store CSI driver with the example pods"
}

# Main execution
Write-Header "Azure Key Vault Secret Population Script (PowerShell)"
Write-Status "This script will populate your Key Vault with example secrets for demo purposes"

# Check prerequisites
Test-AzurePowerShell

# Create Key Vault if needed
New-KeyVaultIfNotExists

# Populate secrets
New-BasicSecrets
New-EnvironmentSecrets
New-DemoCertificates
New-EncryptionKeys

# Display summary
Show-Summary

Write-Status "Key Vault population completed successfully!"

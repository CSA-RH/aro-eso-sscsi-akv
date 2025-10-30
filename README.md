# Azure Key Vault Secrets Store CSI Driver for OpenShift

Integrate Azure Key Vault with OpenShift using the Secrets Store CSI Driver. This project provides multiple approaches to secret management, from direct API calls to Kubernetes-native secret synchronization, with comprehensive monitoring and security dashboards.

## Quick Start

### Prerequisites

- Azure Red Hat OpenShift (ARO) cluster
- Azure CLI configured and authenticated (`az login`)
- OpenShift CLI (`oc`) configured
- `kubectl` access to the cluster

### 1. Configure Environment

```bash
# Copy the example configuration file
cp config.env.example config.env

# Edit config.env with your Azure details
# At minimum, update:
# - AZURE_RESOURCE_GROUP (required - not fetched automatically)
# - AZURE_LOCATION (required - not fetched automatically)
# - AZURE_CLUSTER_NAME (required - not fetched automatically)
# - KEYVAULT_NAME (base name, will be prefixed - optional, defaults to "akv-01")
# - SERVICE_PRINCIPAL_CLIENT_SECRET (required - cannot be fetched, must be set)
```

**Auto-fetched values**:
- `AZURE_SUBSCRIPTION_ID` and `AZURE_TENANT_ID` from `az account show`
- `SERVICE_PRINCIPAL_CLIENT_ID` from Azure AD by display name
- `KEYVAULT_NAME` and `KEYVAULT_URL` from Azure by resource prefix

**Notes**: 
- All Azure resources use the prefix `aro-secrets-` (configurable via `AZURE_RESOURCE_PREFIX`)
- Key Vault names must be 3-24 characters total. With default prefix "aro-secrets-" (13 chars), `KEYVAULT_NAME` should be ≤ 11 characters.

### 2. Setup Azure Resources

Azure resources must be created before installing operators.

```bash
# Setup Azure resources
./bin/install azure

# Validate setup
./bin/install validate azure
```

This creates:
- Azure Service Principal with prefix `aro-secrets-`
- Key Vault with proper RBAC authorization
- Role assignments for Service Principal and current user
- Sample secrets for testing

**Resource naming**:
- Key Vault: `aro-secrets-${KEYVAULT_NAME}`
- Service Principal: `aro-secrets-${SERVICE_PRINCIPAL_NAME}`

### 3. Install Operators

```bash
# Install SSCSI operator + Azure provider (default)
./bin/install install

# Install External Secrets Operator only
./bin/install install --eso

# Install everything
./bin/install install --all

# Validate installation
./bin/install validate
```

### 4. Run Examples

```bash
# List available examples
./bin/examples list

# Apply examples
./bin/examples apply basic-secret-sync
./bin/examples apply mixed-secrets-sync

# Test examples
./bin/examples test basic-secret-sync
```

### 5. Deploy Monitoring Dashboards

```bash
# Deploy all monitoring dashboards
cd hello-world-app
./deploy.sh

# Deploy specific dashboards
./deploy.sh deploy security-dashboard
./deploy.sh deploy audit-dashboard
```

### 6. View Configuration

```bash
# Show current configuration
./bin/install show
```

**Configuration**: Managed via `config.env`. Required values:
- Resource Group, Location, Cluster Name
- Service Principal Client Secret
- Key Vault base name (optional, defaults to "akv-01")
- Resource prefix (optional, defaults to "aro-secrets-")

## Project Structure

```
secrets/
├── bin/                          # Executable scripts
│   ├── install                   # Main installation/cleanup/validation script
│   ├── examples                  # Examples management script
│   └── generate-examples         # Generate examples from templates
├── config.env                    # Current configuration (not in git)
├── config.env.example            # Example configuration template
├── README.md                      # Main documentation
├── .gitignore                     # Git ignore rules
│
├── manifests/                     # Kubernetes manifests
│   ├── secrets-store-csi-driver/ # Secrets Store CSI Driver resources
│   │   ├── install.yaml           # OperatorGroup + Subscription
│   │   ├── clustercsidriver.yaml  # ClusterCSIDriver configuration
│   │   └── azure-provider.yaml   # Azure Key Vault Provider DaemonSet
│   ├── external-secrets-operator/ # External Secrets Operator resources
│   │   ├── install.yaml          # OperatorGroup + Subscription
│   │   └── operatorconfig.yaml   # OperatorConfig for ESO
│   ├── templates/                # Reusable templates (with variables)
│   │   ├── secretproviderclass-template.yaml
│   │   └── test-pod-template.yaml
│   └── test/                     # Test resources
│       ├── namespace.yaml
│       ├── serviceaccount.yaml
│       └── service-principal-secret.yaml
│
├── examples/                      # Generated example YAML files
│   ├── basic-secret-sync.yaml
│   ├── mixed-secrets-sync.yaml
│   ├── namespace-based-rbac.yaml
│   ├── eso-secretstore.yaml       # ESO SecretStore example
│   └── eso-externalsecret.yaml    # ESO ExternalSecret example
│
├── hello-world-app/              # Demo applications and monitoring dashboards
│   ├── shared/                   # Shared webapp framework
│   ├── audit-dashboard/          # Secret access audit and analytics
│   ├── security-dashboard/       # Security monitoring and compliance
│   ├── validation-checker/       # Secret format validation
│   ├── versioning-dashboard/     # Secret versioning and history
│   ├── expiration-monitor/       # Secret expiration monitoring
│   ├── certificate-tls/          # Certificate-based TLS demo
│   ├── hot-reload/               # Hot reload secret updates
│   ├── rotation-handler/         # Secret rotation monitoring
│   ├── multi-vault/              # Multi-vault access demo
│   ├── selective-sync/           # Selective secret synchronization
│   ├── cross-namespace/          # Cross-namespace secret access
│   ├── external-secrets-redhat/  # ESO demo
│   ├── templates/                # Deployment templates
│   ├── deploy.sh                 # Deployment script
│   ├── package.json
│   └── package-lock.json
│
└── scripts/                      # Legacy reference scripts (not actively maintained)
    ├── azure/                    # Azure setup scripts
    ├── keyvault/                 # Key Vault scripts
    └── README.md                 # Legacy scripts documentation
```

## Configuration

### Resource Prefix

All Azure resources created by this script use a configurable prefix to ensure safe cleanup:

```bash
# Default prefix
export AZURE_RESOURCE_PREFIX="aro-secrets-"
```

**Resources with prefix**:
- Key Vault: `aro-secrets-${KEYVAULT_NAME}`
- Service Principal: `aro-secrets-${SERVICE_PRINCIPAL_NAME}`

**Safety**: Cleanup only deletes resources with the matching prefix.

### Authentication Methods

Uses Service Principal authentication:
- Azure Service Principal credentials stored as Kubernetes secrets
- No OIDC issuer configuration required
- No workload identity setup needed

### Environment Variables

Key configuration variables in `config.env`:

```bash
# Azure Configuration
# Note: Subscription ID and Tenant ID are automatically fetched from Azure CLI
# You can override them here if needed, but it's optional
export AZURE_SUBSCRIPTION_ID=""  # Fetched from: az account show --query id
export AZURE_TENANT_ID=""        # Fetched from: az account show --query tenantId

# Required values (not auto-fetched):
export AZURE_RESOURCE_GROUP="your-resource-group"
export AZURE_LOCATION="your-location"
export AZURE_CLUSTER_NAME="your-cluster-name"
export SERVICE_PRINCIPAL_CLIENT_SECRET="your-client-secret"

# Optional values (with defaults):
export AZURE_RESOURCE_PREFIX="aro-secrets-"
export KEYVAULT_NAME="akv-01"
export SERVICE_PRINCIPAL_NAME="csi-driver-sp"

# Kubernetes Configuration
export OPERATOR_NAMESPACE="openshift-cluster-csi-drivers"
export NAMESPACE="openshift-cluster-csi-drivers"
export TEST_NAMESPACE="secrets-store-test"
```

**Auto-fetched values**:
- `AZURE_SUBSCRIPTION_ID` and `AZURE_TENANT_ID` from Azure CLI
- `SERVICE_PRINCIPAL_CLIENT_ID` from Azure AD
- `KEYVAULT_NAME` and `KEYVAULT_URL` from Azure

## Secret Access Methods

### 1. Direct Azure API
- **Use Case**: Dynamic applications, frequent secret rotation
- **Pros**: Real-time access, no CSI driver dependency
- **Cons**: Requires Azure SDK, network calls

### 2. CSI Driver (File Mounting)
- **Use Case**: Static applications, batch processing
- **Pros**: Local file access, no Azure SDK required
- **Cons**: Secrets cached until pod restart

### 3. Kubernetes Secret Sync
- **Use Case**: Traditional Kubernetes applications
- **Pros**: Kubernetes-native, works with existing patterns
- **Cons**: Secrets cached until pod restart

### 4. External Secrets Operator (Red Hat)
- **Use Case**: Enterprise environments, advanced secret management
- **Pros**: Rich features, multiple providers
- **Cons**: Additional operator, more complex setup

## Monitoring Dashboards

### 1. Security & Compliance Dashboard
**Enterprise-grade security monitoring and compliance reporting**

**Features:**
- **Compliance Scoring**: Real-time compliance assessment with risk levels
- **Secret Analysis**: Password strength validation and security rule enforcement
- **Rotation Monitoring**: Tracks secret rotation status and overdue alerts
- **Violation Detection**: Identifies policy violations and security issues
- **Recommendations**: Actionable security recommendations and remediation steps
- **Audit Trail**: Comprehensive logging and access pattern analysis

**Security Rules:**
- Password policy enforcement (length, complexity, character requirements)
- Secret rotation policies and age-based alerts
- Access control validation and permission auditing
- Compliance reporting across multiple security frameworks

### 2. Audit Dashboard
**Secret access audit and analytics**

**Features:**
- **Access Tracking**: Real-time monitoring of secret access patterns
- **Analytics**: Access frequency, trends, and usage statistics
- **Compliance**: Audit trail for security and compliance requirements
- **Alerts**: Unusual access patterns and security violations
- **Reporting**: Detailed access reports and analytics

### 3. Validation Checker
**Secret format validation and compliance**

**Features:**
- **Format Validation**: Validates secret formats against defined rules
- **Compliance Checking**: Ensures secrets meet security standards
- **Rule Engine**: Configurable validation rules and policies
- **Error Reporting**: Detailed validation error messages and recommendations

### 4. Versioning Dashboard
**Secret versioning and history tracking**

**Features:**
- **Version History**: Track all secret versions and changes
- **Change Detection**: Monitor secret modifications and updates
- **Rollback Support**: Easy rollback to previous secret versions
- **Timeline View**: Visual timeline of secret changes

### 5. Expiration Monitor
**Secret expiration monitoring and alerts**

**Features:**
- **Expiration Tracking**: Monitor secret expiration dates
- **Alert System**: Proactive alerts for expiring secrets
- **Renewal Reminders**: Automated renewal notifications
- **Compliance**: Ensure secrets are rotated before expiration

### 6. Certificate TLS Dashboard
**Certificate-based TLS management**

**Features:**
- **Certificate Management**: Load and display SSL certificates
- **TLS Configuration**: HTTPS/TLS termination configuration
- **Certificate Validation**: Verify certificate validity and expiration
- **Security**: Secure certificate handling and storage

### 7. Hot Reload Dashboard
**Real-time secret updates without pod restarts**

**Features:**
- **Live Updates**: Automatic secret reloading on changes
- **File Watching**: Monitor secret file changes in real-time
- **Zero Downtime**: Update secrets without application restart
- **Change Detection**: Track and log secret modifications

### 8. Rotation Handler
**Secret rotation monitoring and management**

**Features:**
- **Rotation Detection**: Monitor secret rotation events
- **Version Tracking**: Track secret version changes
- **Automation**: Automated rotation handling and notifications
- **Compliance**: Ensure proper secret rotation practices

### 9. Multi-Vault Dashboard
**Multi-vault secret access and management**

**Features:**
- **Multiple Vaults**: Access secrets from multiple Azure Key Vaults
- **Unified View**: Single interface for all vault secrets
- **Access Control**: Per-vault access permissions and authentication
- **Management**: Centralized multi-vault secret management

### 10. Selective Sync Dashboard
**Selective secret synchronization**

**Features:**
- **Selective Sync**: Choose which secrets to synchronize
- **Filtering**: Advanced filtering and selection criteria
- **Efficiency**: Reduce resource usage with selective sync
- **Control**: Fine-grained control over secret synchronization

### 11. Cross-Namespace Dashboard
**Cross-namespace secret access patterns**

**Features:**
- **Cross-Namespace Access**: Access secrets across namespaces
- **RBAC Integration**: Role-based access control for cross-namespace access
- **Security**: Secure cross-namespace secret sharing
- **Compliance**: Audit cross-namespace secret access

### 12. External Secrets Redhat Dashboard
**Red Hat External Secrets Operator integration**

**Features:**
- **ESO Integration**: Full External Secrets Operator integration
- **Enterprise Features**: Advanced secret management capabilities
- **Compliance**: Enterprise-grade compliance and security
- **Scalability**: Scalable secret management for large environments

## Available Examples

### Basic Secret Sync
```bash
./bin/examples apply basic-secret-sync
```
Synchronizes basic secrets from Azure Key Vault and creates Kubernetes Secret objects.

### Mixed Secrets Sync
```bash
./bin/examples apply mixed-secrets-sync
```
Synchronizes secrets, certificates, and keys with both Opaque and TLS secrets.

### Namespace-Based RBAC
```bash
./bin/examples apply namespace-based-rbac
```
Demonstrates namespace-specific secret access and RBAC patterns.

### External Secrets Operator Examples

```bash
# Apply SecretStore (configures connection to Azure Key Vault)
./bin/examples apply eso-secretstore

# Apply ExternalSecret (syncs secrets from Key Vault)
./bin/examples apply eso-externalsecret
```

Uses Red Hat External Secrets Operator with `operator.openshift.io/v1alpha1` API group.

## Deploy Monitoring Dashboards

### Deploy All Dashboards
```bash
cd hello-world-app
./deploy.sh
```

### Deploy Specific Dashboards
```bash
# Security dashboard
./deploy.sh deploy security-dashboard

# Audit dashboard
./deploy.sh deploy audit-dashboard

# Validation checker
./deploy.sh deploy validation-checker

# Versioning dashboard
./deploy.sh deploy versioning-dashboard

# Expiration monitor
./deploy.sh deploy expiration-monitor

# Certificate TLS
./deploy.sh deploy certificate-tls

# Hot reload
./deploy.sh deploy hot-reload

# Rotation handler
./deploy.sh deploy rotation-handler

# Multi-vault
./deploy.sh deploy multi-vault

# Selective sync
./deploy.sh deploy selective-sync

# Cross-namespace
./deploy.sh deploy cross-namespace

# External Secrets Redhat
./deploy.sh deploy external-secrets-redhat
```

### Dashboard Access

All dashboards are accessible via OpenShift routes:
- **Security Dashboard**: `https://security-dashboard.apps.<cluster-domain>`
- **Audit Dashboard**: `https://audit-dashboard.apps.<cluster-domain>`
- **Validation Checker**: `https://validation-checker.apps.<cluster-domain>`
- **Versioning Dashboard**: `https://versioning-dashboard.apps.<cluster-domain>`
- **Expiration Monitor**: `https://expiration-monitor.apps.<cluster-domain>`
- **Certificate TLS**: `https://certificate-tls.apps.<cluster-domain>`
- **Hot Reload**: `https://hot-reload.apps.<cluster-domain>`
- **Rotation Handler**: `https://rotation-handler.apps.<cluster-domain>`
- **Multi-Vault**: `https://multi-vault.apps.<cluster-domain>`
- **Selective Sync**: `https://selective-sync.apps.<cluster-domain>`
- **Cross-Namespace**: `https://cross-namespace.apps.<cluster-domain>`
- **External Secrets Redhat**: `https://external-secrets-redhat.apps.<cluster-domain>`

### Dashboard Filtering

Use OpenShift web console labels to filter dashboards:
- **All Dashboards**: `dashboard-type=monitoring`
- **By Method**: `secret-method=azure-api`, `secret-method=csi`, `secret-method=environment`
- **By Operator**: `operator=eso`, `operator=sscsi`

## Testing

### Test Examples
```bash
./bin/examples test basic-secret-sync
```

### Validate Installation
```bash
# Validate everything
./bin/install validate

# Validate specific components
./bin/install validate azure
./bin/install validate operators
```

### Check Dashboard Health
```bash
# Check all dashboard status
oc get pods -l dashboard-type=monitoring --all-namespaces

# Test specific dashboard
curl -k https://security-dashboard.apps.<cluster-domain>/api/health
```

## Cleanup

### Clean Up Everything
```bash
./bin/install cleanup all
```

### Clean Up Specific Resources
```bash
# Operators only
./bin/install cleanup operators

# Force cleanup
./bin/install cleanup operators --force

# Azure only (deletes resources with prefix)
./bin/install cleanup azure

# Local files only
./bin/install cleanup local
```

### Check Cleanup Status
```bash
./bin/install cleanup status
```

**Safety**: Azure cleanup only deletes resources with the configured prefix.

## Troubleshooting

### Common Issues

1. **Pod Mount Failures**
   ```bash
   oc describe pod <pod-name> -n <namespace>
   oc logs -n openshift-cluster-csi-drivers -l app=csi-secrets-store-provider-azure
   ```

2. **Authentication Issues**
   ```bash
   oc get secret secrets-store-csi-driver-sp -n <namespace> -o yaml
   ./bin/install validate azure
   ```

3. **Operator Issues**
   ```bash
   oc get csv -n openshift-cluster-csi-drivers
   oc describe csv <csv-name> -n openshift-cluster-csi-drivers
   ```

4. **Dashboard Issues**
   ```bash
   # Check dashboard pod status
   oc get pods -l dashboard-type=monitoring --all-namespaces
   
   # Check dashboard logs
   oc logs -n hello-world-<dashboard-name> -l app=hello-world-<dashboard-name>
   
   # Check dashboard routes
   oc get routes -l dashboard-type=monitoring --all-namespaces
   ```

### Debug Commands

```bash
# Check resources
oc get all -n openshift-cluster-csi-drivers
oc get secretproviderclass -n secrets-store-test

# Check logs
oc logs -n openshift-cluster-csi-drivers -l app=csi-secrets-store-provider-azure

# Test secret access
oc exec -n secrets-store-test <test-pod> -- ls -la /mnt/secrets-store/

# Check Azure resources
./bin/install cleanup status

# Check dashboard status
oc get pods -l dashboard-type=monitoring --all-namespaces
oc get routes -l dashboard-type=monitoring --all-namespaces
```

## Advanced Usage

### Custom SecretProviderClass

```bash
export SPC_NAME="my-custom-spc"
export EXAMPLE_TYPE="custom"
export SECRET_OBJECTS="..."
envsubst < manifests/templates/secretproviderclass-template.yaml > my-custom-spc.yaml
```

### RBAC Patterns

Examples for:
- Namespace-based access control
- Environment-specific secrets
- Application-specific secrets
- Shared secret patterns

### Monitoring

- Health check endpoints on all dashboards
- Comprehensive logging and audit trails
- OpenShift monitoring integration
- Real-time security and compliance monitoring

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

- Check the troubleshooting section above
- Review OpenShift and Azure documentation
- Open an issue for bugs or feature requests
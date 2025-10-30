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
./bin/install operator

# Install External Secrets Operator only
./bin/install operator --eso

# Install everything
./bin/install operator --all

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

This project includes 12 monitoring dashboards that demonstrate different secret management patterns and capabilities:

- **Security & Compliance Dashboard**: Security monitoring and compliance tracking
- **Audit Dashboard**: Secret access audit and analytics
- **Validation Checker**: Secret format validation and compliance
- **Versioning Dashboard**: Secret versioning and history tracking
- **Expiration Monitor**: Secret expiration monitoring and alerts
- **Certificate TLS Dashboard**: Certificate-based TLS management
- **Hot Reload Dashboard**: Real-time secret updates without pod restarts
- **Rotation Handler**: Secret rotation monitoring and management
- **Multi-Vault Dashboard**: Multi-vault secret access and management
- **Selective Sync Dashboard**: Selective secret synchronization
- **Cross-Namespace Dashboard**: Cross-namespace secret access patterns
- **External Secrets Redhat Dashboard**: Red Hat External Secrets Operator integration

### Quick Start

```bash
cd hello-world-app
./deploy.sh                    # Deploy all dashboards
./deploy.sh deploy security-dashboard  # Deploy specific dashboard
./deploy.sh urls               # View dashboard URLs
```

For detailed dashboard documentation, deployment instructions, and troubleshooting, see [hello-world-app/DASHBOARDS.md](hello-world-app/DASHBOARDS.md).

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
oc get secretproviderclass --all-namespaces

# Check logs
oc logs -n openshift-cluster-csi-drivers -l app=csi-secrets-store-provider-azure

# Test secret access (namespace created dynamically by examples)
# First, find the namespace where examples were deployed:
# oc get secretproviderclass --all-namespaces
# Then use that namespace:
# oc exec -n <example-namespace> <test-pod> -- ls -la /mnt/secrets-store/

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


## About Me

**John Johansson**  
Specialist Adoption Architect at Red Hat

I specialize in helping organizations successfully adopt and optimize OpenShift deployments. This project was created to demonstrate Azure Key Vault integration with OpenShift using the Secrets Store CSI Driver and External Secrets Operator.

Connect with me for OpenShift architecture guidance, best practices, and advanced monitoring solutions.

## License

This project is provided as-is for OpenShift integration tests to Azure Key Vault.

## Support

- Check the troubleshooting section above
- Review OpenShift and Azure documentation
- Open an issue for bugs or feature requests
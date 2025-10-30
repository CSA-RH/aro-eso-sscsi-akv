# Monitoring Dashboards

This directory contains 12 monitoring dashboards that demonstrate different secret management patterns and capabilities.

## Quick Start

```bash
# Deploy all dashboards
cd hello-world-app
./deploy.sh

# Deploy specific dashboard
./deploy.sh deploy security-dashboard

# View dashboard URLs
./deploy.sh urls
```

## Available Dashboards

### 1. Security & Compliance Dashboard
**Security monitoring and compliance tracking**

**Features:**
- **Compliance Scoring**: Basic compliance assessment with risk levels
- **Secret Analysis**: Password strength validation and basic security checks
- **Rotation Monitoring**: Tracks secret rotation status and alerts
- **Violation Detection**: Identifies basic policy violations
- **Recommendations**: Security recommendations and basic remediation steps
- **Audit Trail**: Basic logging and access pattern tracking

**Security Rules:**
- Password policy checks (length, complexity, character requirements)
- Secret rotation tracking and age-based alerts
- Basic access control validation
- Simple compliance reporting

### 2. Audit Dashboard
**Secret access tracking and basic analytics**

**Features:**
- **Access Tracking**: Monitoring of secret access patterns
- **Analytics**: Access frequency, trends, and usage statistics
- **Audit Trail**: Basic logging of secret access
- **Alerts**: Unusual access pattern detection
- **Reporting**: Basic access reports and analytics

### 3. Validation Checker
**Secret format validation**

**Features:**
- **Format Validation**: Validates secret formats against defined rules
- **Basic Checks**: Ensures secrets meet basic security standards
- **Rule Engine**: Configurable validation rules
- **Error Reporting**: Validation error messages and recommendations

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
- **Alert System**: Alerts for expiring secrets
- **Renewal Reminders**: Basic renewal notifications
- **Compliance**: Track secret rotation status

### 6. Certificate TLS Dashboard
**Certificate-based TLS management**

**Features:**
- **Certificate Management**: Load and display SSL certificates
- **TLS Configuration**: HTTPS/TLS termination configuration
- **Certificate Validation**: Verify certificate validity and expiration
- **Security**: Secure certificate handling and storage

### 7. Hot Reload Dashboard
**Secret updates without pod restarts**

**Features:**
- **Live Updates**: Secret reloading on file changes
- **File Watching**: Monitor secret file changes
- **No Restart Required**: Update secrets without pod restart
- **Change Detection**: Track and log secret modifications

### 8. Rotation Handler
**Secret rotation monitoring**

**Features:**
- **Rotation Detection**: Monitor secret rotation events
- **Version Tracking**: Track secret version changes
- **Notifications**: Basic rotation notifications
- **Compliance**: Track secret rotation status

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
- **Filtering**: Filtering and selection criteria
- **Efficiency**: Reduce resource usage with selective sync
- **Control**: Control over which secrets to sync

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
- **ESO Integration**: External Secrets Operator integration
- **Features**: Secret management capabilities via ESO
- **Compliance**: Basic compliance and security tracking
- **Management**: Secret management via Kubernetes resources

## Deployment

### Deploy All Dashboards

```bash
cd hello-world-app
./deploy.sh
```

This deploys all 12 dashboards to your OpenShift cluster.

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

### View Dashboard URLs

```bash
./deploy.sh urls
```

This displays all deployed dashboard URLs.

### Cleanup

```bash
# Clean up all dashboards
./deploy.sh cleanup

# Clean up specific dashboard
./deploy.sh cleanup security-dashboard
```

## Dashboard Access

All dashboards are accessible via OpenShift routes. After deployment, access them at:

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

Replace `<cluster-domain>` with your OpenShift cluster domain. Use `./deploy.sh urls` to get the exact URLs.

## Dashboard Filtering

Use OpenShift web console labels to filter dashboards:

- **All Dashboards**: `dashboard-type=monitoring`
- **By Method**: 
  - `secret-method=azure-api` - Direct Azure Key Vault API
  - `secret-method=csi` - CSI Driver file mounting
  - `secret-method=environment` - Environment variables from Kubernetes secrets
- **By Operator**: 
  - `operator=eso` - External Secrets Operator
  - `operator=sscsi` - Secrets Store CSI Driver

### Example Filter Queries

```bash
# List all dashboards
oc get routes -l dashboard-type=monitoring --all-namespaces

# List dashboards using Azure API
oc get routes -l secret-method=azure-api --all-namespaces

# List dashboards using CSI Driver
oc get routes -l secret-method=csi --all-namespaces

# List ESO dashboards
oc get routes -l operator=eso --all-namespaces
```

## Monitoring and Health Checks

### Check Dashboard Status

```bash
# Check all dashboard pod status
oc get pods -l dashboard-type=monitoring --all-namespaces

# Check specific dashboard status
oc get pods -n hello-world-security-dashboard

# Check dashboard logs
oc logs -n hello-world-security-dashboard -l app=hello-world-security-dashboard
```

### Health Check Endpoints

All dashboards expose a health check endpoint:

```bash
# Test dashboard health
curl -k https://security-dashboard.apps.<cluster-domain>/api/health

# Get dashboard status
curl -k https://security-dashboard.apps.<cluster-domain>/api/status
```

## Troubleshooting

### Dashboard Not Accessible

1. Check if the pod is running:
   ```bash
   oc get pods -n hello-world-<dashboard-name>
   ```

2. Check route configuration:
   ```bash
   oc get route -n hello-world-<dashboard-name>
   ```

3. Check pod logs:
   ```bash
   oc logs -n hello-world-<dashboard-name> -l app=hello-world-<dashboard-name>
   ```

### Dashboard Shows Errors

1. Verify Azure Key Vault connectivity:
   ```bash
   ./bin/install validate azure
   ```

2. Check service principal secret:
   ```bash
   oc get secret secrets-store-csi-driver-sp -n hello-world-<dashboard-name>
   ```

3. Verify operator installation:
   ```bash
   ./bin/install validate operators
   ```

### Dashboard Not Displaying Secrets

1. Ensure secrets exist in Azure Key Vault:
   ```bash
   az keyvault secret list --vault-name <vault-name>
   ```

2. Check secret synchronization status:
   ```bash
   oc get secretproviderclass -n hello-world-<dashboard-name>
   oc get externalsecret -n hello-world-<dashboard-name>
   ```

3. Verify RBAC permissions:
   ```bash
   oc get serviceaccount -n hello-world-<dashboard-name>
   ```

## Secret Access Methods

Each dashboard demonstrates different secret access patterns:

- **Direct Azure API**: Real-time access via Azure SDK (audit-dashboard, expiration-monitor, security-dashboard, validation-checker, versioning-dashboard)
- **CSI Driver**: File-based mounting (certificate-tls, hot-reload, rotation-handler, multi-vault, selective-sync)
- **Kubernetes Secrets**: Environment variables from synced secrets (secret-sync, cross-namespace, external-secrets-redhat)

See the main [README.md](../README.md) for more details on secret access methods.


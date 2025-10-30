#!/bin/bash

# Optimized Hello World Apps Deployment Script
# This script deploys all Hello World webapps using the shared framework

set -eo pipefail

# Source configuration
if [ -f "$(dirname "${BASH_SOURCE[0]}")/../../config.env" ]; then
source "$(dirname "${BASH_SOURCE[0]}")/../../config.env"
elif [ -f "./config.env" ]; then
    source "./config.env"
else
    echo "Error: config.env not found. Please run ./bin/install azure first."
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================${NC}"
}

print_status() {
    echo -e "${YELLOW}➤${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}


# Read webapp framework code
read_webapp_framework() {
    cat "$(dirname "${BASH_SOURCE[0]}")/shared/webapp-framework.js"
}

# Ensure namespace exists (per-app namespace)
ensure_namespace() {
    local app_type="$1"
    
    if [ -z "$app_type" ]; then
        echo "Error: ensure_namespace requires app_type parameter" >&2
        return 1
    fi
    
    local namespace="hello-world-${app_type}"
    
    if ! oc get namespace "${namespace}" &>/dev/null; then
        print_status "Creating namespace: ${namespace}..." >&2
        oc create namespace "${namespace}" >&2
    fi
    
    echo "${namespace}"
}

# Ensure Service Principal secret exists in namespace
ensure_service_principal_secret() {
    local namespace="$1"
    
    # Check if secret already exists
    if oc get secret secrets-store-csi-driver-sp -n "$namespace" &>/dev/null; then
        print_status "Service Principal secret already exists in $namespace namespace"
        return 0
    fi
    
    # Create secret from config.env values
    # Note: Azure provider expects 'clientid', 'clientsecret', and 'tenantid' (no hyphens)
    # Note: CSI driver requires label secrets-store.csi.k8s.io/used=true
    print_status "Creating Service Principal secret in $namespace namespace..."
    oc create secret generic secrets-store-csi-driver-sp \
        --from-literal=clientid="${SERVICE_PRINCIPAL_CLIENT_ID}" \
        --from-literal=clientsecret="${SERVICE_PRINCIPAL_CLIENT_SECRET}" \
        --from-literal=tenantid="${AZURE_TENANT_ID}" \
        -n "$namespace" \
        --dry-run=client -o yaml | oc apply -f -
    
    # Add required label for CSI driver
    oc label secret secrets-store-csi-driver-sp \
        secrets-store.csi.k8s.io/used=true \
        -n "$namespace" \
        --overwrite &>/dev/null || true
    
    print_success "Service Principal secret created in $namespace namespace"
}

# Ensure SecretProviderClass exists in namespace
ensure_secretproviderclass() {
    local namespace="$1"
    local spc_name="azure-keyvault-basic-secrets"
    
    # Check if SecretProviderClass already exists
    if oc get secretproviderclass "$spc_name" -n "$namespace" &>/dev/null; then
        print_status "SecretProviderClass $spc_name already exists in $namespace namespace"
        return 0
    fi
    
    print_status "Creating SecretProviderClass $spc_name in $namespace namespace..."
    
    cat <<EOF | oc apply -f -
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: ${spc_name}
  namespace: ${namespace}
  labels:
    app: hello-world
    component: secretproviderclass
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    useVMManagedIdentity: "false"
    useWorkloadIdentity: "false"
    keyvaultName: "${ACTUAL_KEYVAULT_NAME}"
    tenantId: "${AZURE_TENANT_ID}"
    clientId: "${SERVICE_PRINCIPAL_CLIENT_ID}"
    objects: |
      array:
        - |
          objectName: database-password
          objectType: secret
          objectVersion: ""
          objectAlias: database-password
        - |
          objectName: api-key
          objectType: secret
          objectVersion: ""
          objectAlias: api-key
        - |
          objectName: hello-world-secret
          objectType: secret
          objectVersion: ""
          objectAlias: hello-world-secret
  secretObjects:
    - secretName: database-credentials
      type: Opaque
      data:
      - objectName: database-password
        key: password
    - secretName: api-credentials
      type: Opaque
      data:
      - objectName: api-key
        key: key
    - secretName: hello-world-synced-secrets
      type: Opaque
      data:
      - objectName: hello-world-secret
        key: hello-world-secret
  nodePublishSecretRef:
    name: secrets-store-csi-driver-sp
EOF
    
    print_success "SecretProviderClass $spc_name created in $namespace namespace"
}

# Calculate content hash for package.json/package-lock.json to detect changes
calculate_dependency_hash() {
    local script_dir="$(dirname "${BASH_SOURCE[0]}")"
    local hash_input=""
    
    # Include package.json and package-lock.json if they exist
    if [ -f "${script_dir}/package.json" ]; then
        hash_input="${hash_input}$(cat "${script_dir}/package.json")"
    fi
    if [ -f "${script_dir}/package-lock.json" ]; then
        hash_input="${hash_input}$(cat "${script_dir}/package-lock.json")"
    fi
    if [ -f "${script_dir}/Dockerfile" ]; then
        hash_input="${hash_input}$(cat "${script_dir}/Dockerfile")"
    fi
    
    # Generate short hash
    echo "${hash_input}" | sha256sum | cut -d' ' -f1 | cut -c1-12
}

# Helper: Get the best available image reference
get_best_image_reference() {
    local build_name="$1"
    local build_namespace="$2"
    local current_hash=$(calculate_dependency_hash)
    local image_tag="dep-${current_hash}"
    
    # First try to get the content-based tag (most recent)
    local image_ref=$(oc get imagestreamtag "${build_name}:${image_tag}" -n "${build_namespace}" -o jsonpath='{.image.dockerImageReference}' 2>/dev/null)
    
    # If content-based tag doesn't exist, try latest
    if [ -z "${image_ref}" ]; then
        image_ref=$(oc get imagestreamtag "${build_name}:latest" -n "${build_namespace}" -o jsonpath='{.image.dockerImageReference}' 2>/dev/null)
    fi
    
    # If neither exists, try any available tag
    if [ -z "${image_ref}" ]; then
        local available_tags=$(oc get imagestreamtag "${build_name}" -n "${build_namespace}" -o jsonpath='{.items[*].tag}' 2>/dev/null)
        if [ -n "${available_tags}" ]; then
            # Get the first available tag
            local first_tag=$(echo "${available_tags}" | awk '{print $1}')
            image_ref=$(oc get imagestreamtag "${build_name}:${first_tag}" -n "${build_namespace}" -o jsonpath='{.image.dockerImageReference}' 2>/dev/null)
        fi
    fi
    
    # If still no image found, use a fallback
    if [ -z "${image_ref}" ]; then
        image_ref="${build_namespace}/${build_name}:latest"
        echo -e "${YELLOW}⚠️${NC} No image found, using fallback: ${image_ref}"
    else
        print_status "Using image: ${image_ref}"
    fi
    
    echo "${image_ref}"
}

# Build Docker image with npm packages pre-installed
# Note: Image builds in a shared namespace but can be used by all apps
build_app_image() {
    local build_namespace="hello-world-apps"
    local build_name="hello-world-apps"
    local force_rebuild="${FORCE_REBUILD:-false}"
    
    # Ensure build namespace exists (shared for builds)
    if ! oc get namespace "${build_namespace}" &>/dev/null; then
        print_status "Creating build namespace: ${build_namespace}..."
        oc create namespace "${build_namespace}"
    fi
    
    # Calculate content hash for dependencies
    local current_hash=$(calculate_dependency_hash)
    local image_tag="dep-${current_hash}"
    
    # Check if image with this hash already exists
    if oc get imagestreamtag "${build_name}:${image_tag}" -n "${build_namespace}" &>/dev/null; then
        print_status "Image with current dependencies already exists (tag: ${image_tag}), skipping rebuild"
        
        # Ensure latest tag points to this version for backward compatibility
        local image_digest=$(oc get imagestreamtag "${build_name}:${image_tag}" -n "${build_namespace}" -o jsonpath='{.image.dockerImageReference}' 2>/dev/null || true)
        if [ -n "${image_digest}" ]; then
            # Tag as latest if not already tagged
            if ! oc get imagestreamtag "${build_name}:latest" -n "${build_namespace}" &>/dev/null; then
                oc tag "${build_name}:${image_tag}" "${build_name}:latest" -n "${build_namespace}" 2>/dev/null || true
            fi
        fi
        
        return 0
    fi
    
    # Check if latest image exists and is recent (less than 1 hour old) and force rebuild is not set
    if [ "${force_rebuild}" != "true" ]; then
        local image_age=$(oc get imagestreamtag "${build_name}:latest" -n "${build_namespace}" -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null)
        if [ -n "${image_age}" ]; then
            local age_seconds=$(($(date +%s) - $(date -d "${image_age}" +%s 2>/dev/null || echo 0)))
            if [ "${age_seconds}" -lt 3600 ]; then
                print_status "Recent image found (< 1 hour old), skipping rebuild (use FORCE_REBUILD=true to override)"
                return 0
            fi
        fi
    fi
    
    print_status "Building Docker image with npm packages (tag: ${image_tag})..."
    
    local script_dir="$(dirname "${BASH_SOURCE[0]}")"
    
    # Create BuildConfig if it doesn't exist (always use latest tag for BuildConfig)
    if ! oc get buildconfig "${build_name}" -n "${build_namespace}" &>/dev/null; then
        print_status "Creating BuildConfig..."
        oc new-build --name "${build_name}" \
            --dockerfile="$(cat "${script_dir}/Dockerfile")" \
            --to="${build_namespace}/${build_name}:latest" \
            --strategy=docker \
            -n "${build_namespace}" \
            2>&1 | grep -v "already exists" || true
    fi
    
    # Start binary build from local directory
    print_status "Starting build from local directory..."
    oc start-build "${build_name}" \
        --from-dir="${script_dir}" \
        --follow \
        --wait \
        -n "${build_namespace}" \
        2>&1 | grep -E "(Uploading|Running|Complete|Success|error|Error|Build|Finished)" || true
    
    # Check if build succeeded by looking for latest tag
    if oc get imagestreamtag "${build_name}:latest" -n "${build_namespace}" &>/dev/null; then
        # Tag the built image with the content hash tag
        print_status "Tagging image with dependency hash (tag: ${image_tag})..."
        oc tag "${build_name}:latest" "${build_name}:${image_tag}" -n "${build_namespace}" 2>/dev/null || true
        
        # Ensure latest tag is always up to date
        print_status "Ensuring latest tag is current..."
        oc tag "${build_name}:latest" "${build_name}:latest" -n "${build_namespace}" 2>/dev/null || true
        
        print_success "Docker image built successfully! (tags: ${image_tag}, latest)"
    else
        print_error "Failed to build Docker image"
        return 1
    fi
}

# Deploy a webapp using the template
deploy_webapp() {
    local app_type="$1"
    local app_name="$2"
    local method="$3"
    local operator="$4"
    local secret_strategy="$5"
    local config_variables="$6"
    local volume_mounts="$7"
    local volumes="$8"
    local env_variables="$9"
    local env_from_secrets="${10}"
    local operator_label="${11}"
    
    print_status "Deploying $app_name..."
    
    # Build the Docker image first (with npm packages pre-installed)
    build_app_image
    
    # Ensure app-specific namespace exists
    local namespace=$(ensure_namespace "$app_type")
    
    # Create ConfigMap with the server code
    print_status "Creating ConfigMap with server code..."
    local script_dir="$(dirname "${BASH_SOURCE[0]}")"
    local server_file="${script_dir}/${app_type}/src/server.js"
    local webapp_framework_file="${script_dir}/shared/webapp-framework.js"
    
    # Create a temporary directory for the code
    local temp_dir=$(mktemp -d)
    cp "${server_file}" "${temp_dir}/server.js"
    cp "${webapp_framework_file}" "${temp_dir}/webapp-framework.js"
    
    # Create ConfigMap from the directory
    oc create configmap "hello-world-${app_type}-code" \
        --from-file="${temp_dir}" \
        -n "${namespace}" \
        --dry-run=client -o yaml | oc apply -f -
    
    # Clean up temp directory
    rm -rf "${temp_dir}"
    
    # Ensure Service Principal secret exists for apps that need it
    # Both azure-api and csi strategies need the service principal secret
    if [ "$secret_strategy" = "azure-api" ] || [ "$secret_strategy" = "csi" ]; then
        ensure_service_principal_secret "$namespace"
    fi
    
    # Ensure SecretProviderClass exists for CSI driver apps
    if [ "$secret_strategy" = "csi" ]; then
        ensure_secretproviderclass "$namespace"
    fi
    
    # Export variables for template substitution
    export APP_TYPE="$app_type"
    export APP_NAME="$app_name"
    export METHOD="$method"
    export OPERATOR="$operator"
    export SECRET_STRATEGY="$secret_strategy"
    export CONFIG_VARIABLES="$config_variables"
    export VOLUME_MOUNTS="$volume_mounts"
    export VOLUMES="$volumes"
    export ENVIRONMENT_VARIABLES="$env_variables"
    export ENV_FROM_SECRETS="$env_from_secrets"
    # Ensure OPERATOR_LABEL is properly formatted for YAML
    if [ -n "$operator_label" ]; then
        export OPERATOR_LABEL="$operator_label"
    else
        export OPERATOR_LABEL=""
    fi
    export SERVICE_ACCOUNT_NAME="hello-world-${app_type}-sa"
    export NAMESPACE="$namespace"
    # Get the correct route domain from router canonical hostname
    # Try to get from any existing route first
    local router_host=$(oc get route --all-namespaces -o jsonpath='{.items[0].status.ingress[0].routerCanonicalHostname}' 2>/dev/null | head -1)
    if [ -n "$router_host" ] && [ "$router_host" != "null" ]; then
        # Extract domain from router hostname (e.g., router-default.apps.nhjhswvf... -> apps.nhjhswvf...)
        export ROUTE_DOMAIN=$(echo "$router_host" | sed 's/^[^\.]*\.//')
    else
        # Fallback to default OpenShift route domain format
        export ROUTE_DOMAIN="apps.nhjhswvf.swedencentral.aroapp.io"
    fi
    # WEBAPP_FRAMEWORK_CODE is no longer needed as we use ConfigMaps
    # Image is in hello-world-apps namespace, get full registry reference
    # Get the best available image reference
    export IMAGE_NAME=$(get_best_image_reference "hello-world-apps" "hello-world-apps")
    
    # Apply the template
    # Use envsubst with specific variables to avoid processing JavaScript template literals
    local temp_yaml=$(mktemp)
    print_status "Generating YAML template..."
    
    # Use a more controlled approach to avoid control character issues
    local template_file="$(dirname "${BASH_SOURCE[0]}")/templates/deployment-template.yaml"
    
    # First, let's check if the template file exists and is readable
    if [ ! -f "${template_file}" ]; then
        print_error "Template file not found: ${template_file}"
        exit 1
    fi
    
    # Use envsubst with only the variables we need, avoiding multi-line content
    envsubst '${APP_TYPE} ${APP_NAME} ${METHOD} ${OPERATOR} ${SECRET_STRATEGY} ${CONFIG_VARIABLES} ${VOLUME_MOUNTS} ${VOLUMES} ${ENVIRONMENT_VARIABLES} ${ENV_FROM_SECRETS} ${OPERATOR_LABEL} ${SERVICE_ACCOUNT_NAME} ${NAMESPACE} ${ROUTE_DOMAIN} ${IMAGE_NAME}' < "${template_file}" > "${temp_yaml}"
    
    # Check if the file was created and has content
    if [ ! -s "${temp_yaml}" ]; then
        print_error "Generated YAML file is empty"
        exit 1
    fi
    
    # Clean up any control characters
    sed 's/[[:cntrl:]]//g' "${temp_yaml}" > "${temp_yaml}.clean"
    mv "${temp_yaml}.clean" "${temp_yaml}"
    
    # Test with OpenShift
    print_status "Testing YAML with OpenShift dry-run..."
    if oc apply -f "${temp_yaml}" --dry-run=client >/dev/null 2>&1; then
        print_status "OpenShift YAML validation passed, applying to cluster..."
        oc apply -f "${temp_yaml}"
    else
        print_error "OpenShift YAML validation failed"
        print_status "OpenShift validation error:"
        oc apply -f "${temp_yaml}" --dry-run=client 2>&1 || true
        print_status "First 20 lines of generated YAML:"
        head -20 "${temp_yaml}"
        exit 1
    fi
    
    rm -f "${temp_yaml}"
    
    wait_for_deployment "$app_type" "$app_name" "$namespace"
}

# Helper: Wait for deployment to be ready
wait_for_deployment() {
    local app_type="$1"
    local app_name="$2"
    local namespace="$3"
    local max_retries=3
    local retry_count=0
    
    while [ $retry_count -lt $max_retries ]; do
        print_status "Waiting for deployment to be ready (attempt $((retry_count + 1))/$max_retries, timeout: 15 seconds)..."
        
        if oc wait --for=condition=available deployment/hello-world-${app_type} -n "$namespace" --timeout=15s 2>/dev/null; then
            print_success "Deployment is ready!"
            return 0
        fi
        
        echo -e "${YELLOW}⚠️${NC} Deployment not ready, checking for image issues..."
        
        # Check for ImagePullBackOff errors
        local image_pull_errors=$(oc get pods -n "$namespace" -l app=hello-world-${app_type} -o jsonpath='{.items[?(@.status.containerStatuses[0].state.waiting.reason=="ImagePullBackOff")].metadata.name}' 2>/dev/null)
        
        if [ -n "${image_pull_errors}" ]; then
            print_error "ImagePullBackOff detected, attempting to fix..."
            
            # Get the current image being used
            local current_image=$(oc get deployment hello-world-${app_type} -n "$namespace" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
            print_status "Current image: ${current_image}"
            
            # Try to get a working image
            local working_image=$(get_best_image_reference "hello-world-apps" "hello-world-apps")
            print_status "Trying working image: ${working_image}"
            
            # Update the deployment with the working image
            oc patch deployment hello-world-${app_type} -n "$namespace" -p "{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"hello-world-${app_type}\",\"image\":\"${working_image}\"}]}}}}" 2>/dev/null || true
            
            # Wait a bit for the update to take effect
            sleep 5
        else
            # Check pod status for other issues
            print_status "Checking pod status..."
            oc get pods -n "$namespace" -l app=hello-world-${app_type}
            print_status "Recent pod logs:"
            oc logs -n "$namespace" -l app=hello-world-${app_type} --tail=20 2>&1 || true
        fi
        
        retry_count=$((retry_count + 1))
        if [ $retry_count -lt $max_retries ]; then
            print_status "Retrying in 5 seconds..."
            sleep 5
        fi
    done
    
    print_error "Deployment failed after $max_retries attempts"
    print_status "Final pod status:"
    oc get pods -n "$namespace" -l app=hello-world-${app_type}
    print_status "Final pod logs:"
    oc logs -n "$namespace" -l app=hello-world-${app_type} --tail=20 2>&1 || true
    exit 1
}

# Helper: Get common Azure environment variables
get_azure_env_vars() {
    local extra_vars="${1:-}"
    echo "- name: KEYVAULT_URL
          value: \"${KEYVAULT_URL}\"
        - name: AZURE_TENANT_ID
          value: \"${AZURE_TENANT_ID}\"
        - name: AZURE_CLIENT_ID
          value: \"${SERVICE_PRINCIPAL_CLIENT_ID}\"
        - name: AZURE_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: secrets-store-csi-driver-sp
              key: clientsecret
        - name: AZURE_SUBSCRIPTION_ID
          value: \"${AZURE_SUBSCRIPTION_ID}\"${extra_vars:+$'\n'        ${extra_vars}}"
}

# Helper: Get CSI volume mounts
get_csi_volume_mounts() {
    echo "- name: secrets-store
          mountPath: \"/etc/secrets\"
          readOnly: true"
}

# Helper: Get CSI volumes
get_csi_volumes() {
    local app_type="$1"
    echo "- name: secrets-store
        csi:
          driver: secrets-store.csi.k8s.io
          readOnly: true
          volumeAttributes:
            secretProviderClass: \"azure-keyvault-basic-secrets\"
          nodePublishSecretRef:
            name: secrets-store-csi-driver-sp"
}


    # Deploy CSI Driver webapp
deploy_csi_driver() {
    deploy_custom_webapp_with_template \
        "csi-driver" \
        "Hello World - CSI Driver" \
        "csi-driver" \
        "" \
        "csi" \
        "csi-driver/src/server.js" \
        "$(get_csi_volume_mounts)" \
        "$(get_csi_volumes csi-driver)" \
        "- name: SECRETS_MOUNT_PATH
          value: \"/etc/secrets\"" \
        "" \
        "operator: sscsi"
}
    
    # Deploy Direct Azure API webapp
deploy_direct_api() {
    deploy_custom_webapp_with_template \
        "direct-api" \
        "Hello World - Direct Azure API" \
        "direct-api" \
        "" \
        "azure-api" \
        "direct-api/src/server.js" \
        "" \
        "" \
        "- name: KEYVAULT_URL
          value: \"${KEYVAULT_URL}\"
        - name: AZURE_TENANT_ID
          value: \"${AZURE_TENANT_ID}\"
        - name: AZURE_CLIENT_ID
          value: \"${SERVICE_PRINCIPAL_CLIENT_ID}\"
        - name: AZURE_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: secrets-store-csi-driver-sp
              key: clientsecret
        - name: AZURE_SUBSCRIPTION_ID
          value: \"${AZURE_SUBSCRIPTION_ID}\"" \
        "" \
        ""
}
    
    # Deploy Kubernetes Secret Sync webapp
deploy_secret_sync() {
    # Ensure namespace exists
    local namespace=$(ensure_namespace "secret-sync")
    
    # For secret-sync, we need the Kubernetes secrets created by SecretProviderClass
    # Ensure SecretProviderClass and Service Principal secret exist
    ensure_service_principal_secret "$namespace"
    ensure_secretproviderclass "$namespace"
    
    # Check if synced secrets already exist
    if ! oc get secret database-credentials api-credentials hello-world-synced-secrets -n "$namespace" &>/dev/null 2>&1; then
        # Secrets don't exist yet - need a pod to mount SecretProviderClass to trigger secret creation via secretObjects
        print_status "Synced secrets not found. Creating trigger pod to generate secrets..."
        cat <<EOF | oc apply -f - &>/dev/null || true
apiVersion: v1
kind: Pod
metadata:
  name: secret-sync-trigger
  namespace: ${namespace}
spec:
  serviceAccountName: hello-world-secret-sync-sa
  containers:
  - name: trigger
    image: registry.redhat.io/ubi8/ubi-minimal:latest
    command: ["sleep", "30"]
    volumeMounts:
    - name: secrets-store
      mountPath: "/mnt/secrets-store"
      readOnly: true
  volumes:
  - name: secrets-store
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: "azure-keyvault-basic-secrets"
      nodePublishSecretRef:
        name: secrets-store-csi-driver-sp
EOF
        # Wait for pod to start and secrets to be created by secretObjects
        print_status "Waiting for synced secrets to be created (this may take 20-30 seconds)..."
        local max_wait=35
        local waited=0
        while [ $waited -lt $max_wait ]; do
            if oc get secret database-credentials api-credentials hello-world-synced-secrets -n "$namespace" &>/dev/null 2>&1; then
                print_success "Synced secrets created successfully"
                break
            fi
            sleep 2
            waited=$((waited + 2))
        done
        
        # Don't delete trigger pod yet - secrets have ownerReferences to it
        # Keep it running and let the actual deployment create its own secrets
        print_status "Trigger pod created. Secrets will be created when deployment mounts the volume."
        sleep 2
    else
        print_status "Synced secrets already exist, skipping trigger pod creation"
    fi
    
    # For secret-sync, we need to also mount the CSI volume to trigger secret creation
    # even though the app itself only uses environment variables
    deploy_custom_webapp_with_template \
        "secret-sync" \
        "Hello World - Kubernetes Secret Sync" \
        "secret-sync" \
        "" \
        "environment" \
        "secret-sync/src/server.js" \
        "$(get_csi_volume_mounts)" \
        "$(get_csi_volumes secret-sync)" \
        "- name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: password
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: api-credentials
              key: key
        - name: HELLO_WORLD_SECRET
          valueFrom:
            secretKeyRef:
              name: hello-world-synced-secrets
              key: hello-world-secret" \
        "" \
        ""
}

# Deploy Certificate-Based TLS webapp
deploy_certificate_tls() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "certificate-tls" \
        "Hello World - Certificate TLS" \
        "Certificate-Based TLS (CSI Driver)" \
        "SSCSI" \
        "csi" \
        "certificate-tls/src/server.js" \
        "$(get_csi_volume_mounts)" \
        "$(get_csi_volumes certificate-tls)" \
        "- name: SECRETS_MOUNT_PATH
          value: \"/etc/secrets\"
        - name: CERT_PATH
          value: \"/etc/secrets/ssl-cert\"
        - name: KEY_PATH
          value: \"/etc/secrets/ssl-key\"" \
        "- name: secrets-store-csi-driver-sp
          secretName: secrets-store-csi-driver-sp" \
        "SSCSI"
}

# Deploy Hot Reload webapp
deploy_hot_reload() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "hot-reload" \
        "Hello World - Hot Reload" \
        "Hot Reload (CSI Driver)" \
        "SSCSI" \
        "csi" \
        "hot-reload/src/server.js" \
        "$(get_csi_volume_mounts)" \
        "$(get_csi_volumes hot-reload)" \
        "- name: SECRETS_MOUNT_PATH
          value: \"/etc/secrets\"
        - name: RELOAD_INTERVAL
          value: \"5000\"" \
        "- name: secrets-store-csi-driver-sp
          secretName: secrets-store-csi-driver-sp" \
        "SSCSI"
}

# Deploy Rotation Handler webapp
deploy_rotation_handler() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "rotation-handler" \
        "Hello World - Rotation Handler" \
        "Secret Rotation Handler" \
        "" \
        "azure-api" \
        "rotation-handler/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars "- name: ROTATION_CHECK_INTERVAL
          value: \"30000\"")" \
        "" \
        ""
}

# Deploy Versioning Dashboard webapp
deploy_versioning_dashboard() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "versioning-dashboard" \
        "Hello World - Versioning Dashboard" \
        "Secret Versioning Dashboard" \
        "" \
        "azure-api" \
        "versioning-dashboard/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars)" \
        "" \
        ""
}

# Deploy Multi-Vault webapp
deploy_multi_vault() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "multi-vault" \
        "Hello World - Multi-Vault" \
        "Multi-Vault Access" \
        "" \
        "azure-api" \
        "multi-vault/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars "- name: VAULT_CONFIG
          value: \"primary:${KEYVAULT_URL},default:${KEYVAULT_URL}\"")" \
        "" \
        ""
}
    
# Deploy Secret Expiration Monitor webapp
deploy_expiration_monitor() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "expiration-monitor" \
        "Hello World - Secret Expiration Monitor" \
        "Secret Expiration Monitor" \
        "" \
        "azure-api" \
        "expiration-monitor/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars)" \
        "" \
        ""
}

# Helper function to deploy custom webapps using template
deploy_custom_webapp_with_template() {
    local app_type="$1"
    local app_name="$2"
    local method="$3"
    local operator="$4"
    local secret_strategy="$5"
    local custom_server_path="$6"
    local volume_mounts="$7"
    local volumes="$8"
    local env_variables="$9"
    local env_from_secrets="${10}"
    local operator_label="${11}"
    
    print_status "Deploying $app_name..."
    
    # Build the Docker image first
    build_app_image
    
    # Ensure namespace exists
    local namespace=$(ensure_namespace "$app_type")
    
    # Ensure Service Principal secret exists for apps that need it
    if [ "$secret_strategy" = "azure-api" ] || [ "$secret_strategy" = "csi" ]; then
        ensure_service_principal_secret "$namespace"
    fi
    
    # Ensure SecretProviderClass exists for CSI driver apps
    if [ "$secret_strategy" = "csi" ]; then
        ensure_secretproviderclass "$namespace"
    fi
    
    # Create ConfigMap with the custom server code
    print_status "Creating ConfigMap with custom server code..."
    local script_dir="$(dirname "${BASH_SOURCE[0]}")"
    local custom_server_file="${script_dir}/${custom_server_path}"
    local webapp_framework_file="${script_dir}/shared/webapp-framework.js"
    
    # Create a temporary directory for the code
    local temp_dir=$(mktemp -d)
    cp "${custom_server_file}" "${temp_dir}/server.js"
    cp "${webapp_framework_file}" "${temp_dir}/webapp-framework.js"
    
    # Create ConfigMap from the directory
    oc create configmap "hello-world-${app_type}-code" \
        --from-file="${temp_dir}" \
        -n "${namespace}" \
        --dry-run=client -o yaml | oc apply -f -
    
    # Clean up temp directory
    rm -rf "${temp_dir}"
    
    # Deploy using template
    print_status "Deploying using template..."
    local image_name="image-registry.openshift-image-registry.svc:5000/hello-world-apps/hello-world-apps@sha256:0b824005c882ad6ea19a742db2816cb82cc2e4ea36f6c6647b4927d0397d4921"
    
    # Export variables for template substitution
    export APP_TYPE="$app_type"
    export APP_NAME="$app_name"
    export NAMESPACE="$namespace"
    export IMAGE_NAME="$image_name"
    export SERVICE_ACCOUNT_NAME="hello-world-${app_type}-sa"
    export VOLUME_MOUNTS="$volume_mounts"
    export VOLUMES="$volumes"
    export ENVIRONMENT_VARIABLES="$env_variables"
    export ENV_FROM_SECRETS="$env_from_secrets"
    export OPERATOR_LABEL="$operator_label"
    
    # Use template with envsubst
    envsubst '${APP_TYPE} ${APP_NAME} ${NAMESPACE} ${IMAGE_NAME} ${SERVICE_ACCOUNT_NAME} ${VOLUME_MOUNTS} ${VOLUMES} ${ENVIRONMENT_VARIABLES} ${ENV_FROM_SECRETS} ${OPERATOR_LABEL}' < "${script_dir}/templates/custom-webapp-template.yaml" | oc apply -f -
    
    wait_for_deployment "$app_type" "$app_name" "$namespace"
}

# Deploy Secret Audit Dashboard webapp
deploy_audit_dashboard() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "audit-dashboard" \
        "Hello World - Secret Audit Dashboard" \
        "Secret Audit Dashboard" \
        "" \
        "azure-api" \
        "audit-dashboard/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars)" \
        "" \
        ""
}

# Deploy Secret Validation Checker webapp
deploy_validation_checker() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "validation-checker" \
        "Hello World - Secret Validation Checker" \
        "Secret Validation Checker" \
        "" \
        "azure-api" \
        "validation-checker/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars)" \
        "" \
        ""
}

# Deploy Security Dashboard webapp
deploy_security_dashboard() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "security-dashboard" \
        "Hello World - Security & Compliance Dashboard" \
        "Security & Compliance Dashboard" \
        "" \
        "azure-api" \
        "security-dashboard/src/server.js" \
        "" \
        "" \
        "$(get_azure_env_vars)" \
        "" \
        ""
}

# Deploy Selective Secret Sync webapp
deploy_selective_sync() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "selective-sync" \
        "Hello World - Selective Secret Sync" \
        "Selective Secret Sync" \
        "SSCSI" \
        "csi" \
        "selective-sync/src/server.js" \
        "- name: secrets-store
          mountPath: \"/etc/secrets\"
          readOnly: true" \
        "- name: secrets-store
        csi:
          driver: secrets-store.csi.k8s.io
          readOnly: true
          volumeAttributes:
            secretProviderClass: \"azure-keyvault-basic-secrets\"
          nodePublishSecretRef:
            name: secrets-store-csi-driver-sp" \
        "- name: SECRETS_MOUNT_PATH
          value: \"/etc/secrets\"
        - name: SECRET_FILTER_INCLUDE
          value: \"database-password,api-key,hello-world-secret\"
        - name: SECRET_FILTER_EXCLUDE
          value: \"\"
        - name: SECRET_FILTER_PREFIX
          value: \"\"
        - name: SECRET_FILTER_SUFFIX
          value: \"\"" \
        "- name: secrets-store-csi-driver-sp
          secretName: secrets-store-csi-driver-sp" \
        "SSCSI"
}

# Deploy Cross-Namespace Secret Sharing webapp
deploy_cross_namespace() {
    # Use the new template-based approach
    deploy_custom_webapp_with_template \
        "cross-namespace" \
        "Hello World - Cross-Namespace Secret Sharing" \
        "Cross-Namespace Secret Sharing" \
        "SSCSI" \
        "csi" \
        "cross-namespace/src/server.js" \
        "- name: secrets-store
          mountPath: \"/etc/secrets\"
          readOnly: true" \
        "- name: secrets-store
        csi:
          driver: secrets-store.csi.k8s.io
          readOnly: true
          volumeAttributes:
            secretProviderClass: \"azure-keyvault-basic-secrets\"
          nodePublishSecretRef:
            name: secrets-store-csi-driver-sp" \
        "- name: SECRETS_MOUNT_PATH
          value: \"/etc/secrets\"
        - name: SHARED_NAMESPACES
          value: \"hello-world-apps,shared-services\"
        - name: SHARED_DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: password
        - name: SHARED_API_KEY
          valueFrom:
            secretKeyRef:
              name: api-credentials
              key: key" \
        "- name: secrets-store-csi-driver-sp
          secretName: secrets-store-csi-driver-sp" \
        "SSCSI"
}

    # Deploy Red Hat External Secrets Operator webapp
deploy_external_secrets_redhat() {
    deploy_custom_webapp_with_template \
        "external-secrets-redhat" \
        "Hello World - Red Hat External Secrets Operator" \
        "external-secrets-redhat" \
        "RED HAT" \
        "environment" \
        "external-secrets-redhat/src/server-optimized.js" \
        "" \
        "" \
        "- name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: hello-world-redhat-external-secrets-synced
              key: database-password
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: hello-world-redhat-external-secrets-synced
              key: api-key
        - name: HELLO_WORLD_SECRET
          valueFrom:
            secretKeyRef:
              name: hello-world-redhat-external-secrets-synced
              key: hello-world-secret" \
        "" \
        "operator: redhat"
}

# Main deployment function
deploy_all_webapps() {
    print_header "Deploying All Hello World Webapps"
    
    deploy_csi_driver
    deploy_direct_api
    deploy_secret_sync
    deploy_external_secrets_redhat
    deploy_certificate_tls
    deploy_hot_reload
    deploy_rotation_handler
    deploy_versioning_dashboard
    deploy_multi_vault
    deploy_expiration_monitor
    deploy_audit_dashboard
    deploy_validation_checker
    deploy_selective_sync
    deploy_cross_namespace
    
    print_header "All Webapps Deployed Successfully!"
    show_urls
}

# Deploy a specific app
deploy_specific_app() {
    local app_name="$1"
    
    case "$app_name" in
        "csi-driver")
            print_header "Deploying CSI Driver Webapp"
            deploy_csi_driver
            ;;
        "direct-api")
            print_header "Deploying Direct Azure API Webapp"
            deploy_direct_api
            ;;
        "secret-sync")
            print_header "Deploying Kubernetes Secret Sync Webapp"
            deploy_secret_sync
            ;;
        "external-secrets-redhat")
            print_header "Deploying Red Hat External Secrets Operator Webapp"
            deploy_external_secrets_redhat
            ;;
        "certificate-tls")
            print_header "Deploying Certificate-Based TLS Webapp"
            deploy_certificate_tls
            ;;
        "hot-reload")
            print_header "Deploying Hot Reload Webapp"
            deploy_hot_reload
            ;;
        "rotation-handler")
            print_header "Deploying Secret Rotation Handler Webapp"
            deploy_rotation_handler
            ;;
        "versioning-dashboard")
            print_header "Deploying Secret Versioning Dashboard Webapp"
            deploy_versioning_dashboard
            ;;
        "multi-vault")
            print_header "Deploying Multi-Vault Access Webapp"
            deploy_multi_vault
            ;;
        "expiration-monitor")
            print_header "Deploying Secret Expiration Monitor Webapp"
            deploy_expiration_monitor
            ;;
        "audit-dashboard")
            print_header "Deploying Secret Audit Dashboard Webapp"
            deploy_audit_dashboard
            ;;
        "validation-checker")
            print_header "Deploying Secret Validation Checker Webapp"
            deploy_validation_checker
            ;;
        "security-dashboard")
            print_header "Deploying Security & Compliance Dashboard Webapp"
            deploy_security_dashboard
            ;;
        "selective-sync")
            print_header "Deploying Selective Secret Sync Webapp"
            deploy_selective_sync
            ;;
        "cross-namespace")
            print_header "Deploying Cross-Namespace Secret Sharing Webapp"
            deploy_cross_namespace
            ;;
        *)
            print_error "Unknown app: $app_name"
            echo ""
            echo "Available apps:"
            echo "  csi-driver                  - Secrets Store CSI Driver"
            echo "  direct-api                  - Direct Azure Key Vault API"
            echo "  secret-sync                 - Kubernetes Secret Sync"
            echo "  external-secrets-redhat     - Red Hat External Secrets Operator"
            echo "  certificate-tls             - Certificate-Based TLS (CSI Driver)"
            echo "  hot-reload                  - Hot Reload (CSI Driver)"
            echo "  rotation-handler            - Secret Rotation Handler"
            echo "  versioning-dashboard        - Secret Versioning Dashboard"
            echo "  multi-vault                 - Multi-Vault Access"
            exit 1
            ;;
    esac
    
    show_single_url "$app_name"
}

# Show URL for a specific app
show_single_url() {
    local app="$1"
    local namespace="hello-world-${app}"
    
    case "$app" in
        "csi-driver")
            local description="CSI Driver"
            ;;
        "direct-api")
            local description="Direct Azure API"
            ;;
        "secret-sync")
            local description="Kubernetes Secret Sync"
            ;;
        "external-secrets-redhat")
            local description="Red Hat External Secrets Operator"
            ;;
        "certificate-tls")
            local description="Certificate TLS"
            ;;
        "hot-reload")
            local description="Hot Reload"
            ;;
        "rotation-handler")
            local description="Rotation Handler"
            ;;
        "versioning-dashboard")
            local description="Versioning Dashboard"
            ;;
        "multi-vault")
            local description="Multi-Vault"
            ;;
        "expiration-monitor")
            local description="Expiration Monitor"
            ;;
        "audit-dashboard")
            local description="Audit Dashboard"
            ;;
        "validation-checker")
            local description="Validation Checker"
            ;;
        "selective-sync")
            local description="Selective Sync"
            ;;
        "cross-namespace")
            local description="Cross-Namespace"
            ;;
        *)
            local description="Unknown App"
            ;;
    esac
    
    local desc="${description:-$app}"
    # Get the actual accessible URL from the route status (OpenShift generates this)
    local url=$(oc get route "${app}-route" -n "${namespace}" -o jsonpath='https://{.status.ingress[0].host}' 2>/dev/null || echo "https://${app}-route-${namespace}.${AZURE_CLUSTER_NAME}.${AZURE_LOCATION}.aroapp.io")
    echo ""
    print_header "Webapp URL"
    echo -e "${GREEN}${desc}:${NC} ${url}"
}


# Show URLs for all webapps
show_urls() {
    local app_name="${1:-all}"
    
    if [ "$app_name" = "all" ]; then
    print_header "Webapp URLs"
    
        local apps=("csi-driver" "direct-api" "secret-sync" "external-secrets-redhat" "certificate-tls" "hot-reload" "rotation-handler" "versioning-dashboard" "multi-vault" "expiration-monitor" "audit-dashboard" "validation-checker" "security-dashboard" "selective-sync" "cross-namespace")
        local descriptions=("CSI Driver" "Direct Azure API" "Kubernetes Secret Sync" "Red Hat External Secrets Operator" "Certificate TLS" "Hot Reload" "Rotation Handler" "Versioning Dashboard" "Multi-Vault" "Expiration Monitor" "Audit Dashboard" "Validation Checker" "Security Dashboard" "Selective Sync" "Cross-Namespace")
    
    for i in "${!apps[@]}"; do
        local app="${apps[$i]}"
            case "$app" in
                "csi-driver")
                    local desc="CSI Driver"
                    ;;
                "direct-api")
                    local desc="Direct Azure API"
                    ;;
                "secret-sync")
                    local desc="Kubernetes Secret Sync"
                    ;;
                "external-secrets-redhat")
                    local desc="Red Hat External Secrets Operator"
                    ;;
                "certificate-tls")
                    local desc="Certificate TLS"
                    ;;
                "hot-reload")
                    local desc="Hot Reload"
                    ;;
                "rotation-handler")
                    local desc="Rotation Handler"
                    ;;
                "versioning-dashboard")
                    local desc="Versioning Dashboard"
                    ;;
                "multi-vault")
                    local desc="Multi-Vault"
                    ;;
                "expiration-monitor")
                    local desc="Expiration Monitor"
                    ;;
                "audit-dashboard")
                    local desc="Audit Dashboard"
                    ;;
                "validation-checker")
                    local desc="Validation Checker"
                    ;;
                "security-dashboard")
                    local desc="Security Dashboard"
                    ;;
                "selective-sync")
                    local desc="Selective Sync"
                    ;;
                "cross-namespace")
                    local desc="Cross-Namespace"
                    ;;
                *)
                    local desc="$app"
                    ;;
            esac
            # Get the actual accessible URL from the route status
            local namespace="hello-world-${app}"
            local route_name="${app}-route"
            local url=$(oc get route "${route_name}" -n "${namespace}" -o jsonpath='https://{.status.ingress[0].host}' 2>/dev/null || oc get route "${route_name}" -n "${namespace}" -o jsonpath='https://{.spec.host}' 2>/dev/null || echo "https://${app}.${ROUTE_DOMAIN}")
        echo -e "${GREEN}${desc}:${NC} ${url}"
    done
    else
        show_single_url "$app_name"
    fi
}

# Cleanup function
cleanup_webapps() {
    local app_name="${1:-all}"
    
    if [ "$app_name" = "all" ]; then
        print_header "Cleaning Up All Hello World Webapps"
        
        local apps=("csi-driver" "direct-api" "secret-sync" "external-secrets-redhat" "certificate-tls" "hot-reload" "rotation-handler" "versioning-dashboard" "multi-vault" "expiration-monitor" "audit-dashboard" "validation-checker" "security-dashboard" "selective-sync" "cross-namespace")
        
        # Collect existing namespaces
        local existing_namespaces=()
        for app in "${apps[@]}"; do
            local namespace="hello-world-${app}"
            if oc get namespace "${namespace}" &>/dev/null; then
                existing_namespaces+=("${namespace}")
            fi
        done
        
        if [ ${#existing_namespaces[@]} -eq 0 ]; then
            print_status "No webapp namespaces found to clean up"
            return 0
        fi
        
        print_status "Found ${#existing_namespaces[@]} namespaces to clean up"
        
        # PHASE 1: Scale down ALL deployments in parallel
        print_status "Phase 1: Scaling down all deployments to 0 replicas..."
        local scale_jobs=()
        for namespace in "${existing_namespaces[@]}"; do
            if oc get deployments -n "${namespace}" --no-headers 2>/dev/null | grep -q .; then
                print_status "Scaling down deployments in ${namespace}..."
                oc scale deployment --all --replicas=0 -n "${namespace}" 2>/dev/null || true &
                scale_jobs+=($!)
            fi
        done
        
        # Wait for all scale operations to complete
        for job in "${scale_jobs[@]}"; do
            wait $job 2>/dev/null || true
        done
        
        # PHASE 2: Wait for pods to terminate
        print_status "Phase 2: Waiting for pods to terminate..."
        sleep 3
        
        # PHASE 3: Delete ALL resources in parallel
        print_status "Phase 3: Deleting all resources in parallel..."
        local delete_jobs=()
        for namespace in "${existing_namespaces[@]}"; do
            print_status "Deleting resources in ${namespace}..."
            {
                oc delete all --all -n "${namespace}" --ignore-not-found=true
                oc delete serviceaccount --all -n "${namespace}" --ignore-not-found=true
                oc delete configmap --all -n "${namespace}" --ignore-not-found=true
                oc delete secret --all -n "${namespace}" --ignore-not-found=true
                oc delete secretproviderclass --all -n "${namespace}" --ignore-not-found=true
                oc delete namespace "${namespace}" --ignore-not-found=true --timeout=30s
            } &
            delete_jobs+=($!)
        done
        
        # Wait for all delete operations to complete
        for job in "${delete_jobs[@]}"; do
            wait $job 2>/dev/null || true
        done
        
        print_success "All webapps cleaned up in parallel!"
    else
        print_header "Cleaning Up Hello World Webapp: $app_name"
        
        # Validate app name
        case "$app_name" in
            "csi-driver"|"direct-api"|"secret-sync"|"external-secrets-redhat"|"certificate-tls"|"hot-reload"|"rotation-handler"|"versioning-dashboard"|"multi-vault"|"expiration-monitor"|"audit-dashboard"|"validation-checker"|"security-dashboard"|"selective-sync"|"cross-namespace")
                local namespace="hello-world-${app_name}"
                if oc get namespace "${namespace}" &>/dev/null; then
                    print_status "Cleaning up ${app_name} (namespace: ${namespace})..."
                    
                    # Scale down deployments to 0 replicas first to prevent pod recreation
                    print_status "Scaling down deployments to 0 replicas..."
                    if oc get deployments -n "${namespace}" --no-headers 2>/dev/null | grep -q .; then
                        oc scale deployment --all --replicas=0 -n "${namespace}" 2>/dev/null || true
                    else
                        print_status "No deployments found to scale down"
                    fi
                    
                    # Wait a moment for pods to terminate
                    sleep 2
                    
                    # Now delete all resources
                    oc delete all --all -n "${namespace}" --ignore-not-found=true
                    oc delete serviceaccount --all -n "${namespace}" --ignore-not-found=true
                    oc delete configmap --all -n "${namespace}" --ignore-not-found=true
                    oc delete secret --all -n "${namespace}" --ignore-not-found=true
                    oc delete secretproviderclass --all -n "${namespace}" --ignore-not-found=true
                    print_status "Deleting namespace ${namespace}..."
                    oc delete namespace "${namespace}" --ignore-not-found=true --timeout=30s
                    print_success "Webapp ${app_name} cleaned up!"
                else
                    print_status "Namespace ${namespace} does not exist, nothing to clean up."
                fi
                ;;
            *)
                print_error "Unknown app: $app_name"
                echo ""
                echo "Available apps:"
                echo "  csi-driver                  - Secrets Store CSI Driver"
                echo "  direct-api                  - Direct Azure Key Vault API"
                echo "  secret-sync                 - Kubernetes Secret Sync"
                echo "  external-secrets-redhat     - Red Hat External Secrets Operator"
                echo "  certificate-tls              - Certificate-Based TLS (CSI Driver)"
                echo "  hot-reload                  - Hot Reload (CSI Driver)"
                echo "  rotation-handler             - Secret Rotation Handler"
                echo "  versioning-dashboard         - Secret Versioning Dashboard"
                echo "  multi-vault                 - Multi-Vault Access"
                echo "  expiration-monitor          - Secret Expiration Monitor"
                echo "  audit-dashboard             - Secret Audit Dashboard"
                echo "  validation-checker          - Secret Validation Checker"
                echo "  security-dashboard          - Security & Compliance Dashboard"
                echo "  selective-sync              - Selective Secret Sync"
                echo "  cross-namespace             - Cross-Namespace Secret Access"
                exit 1
                ;;
        esac
    fi
}

# Show help
show_help() {
    echo "Hello World Apps Deployment Script"
    echo ""
    echo "Usage: $0 <command> [app-name]"
    echo ""
    echo "Commands:"
    echo "  deploy [app-name]     - Deploy webapp(s)"
    echo "                          Without app-name: deploys all webapps"
    echo "                          With app-name: deploys specific app"
    echo "  cleanup [app-name]    - Clean up webapp(s)"
    echo "                          Without app-name: cleans up all webapps"
    echo "                          With app-name: cleans up specific app"
    echo "  urls [app-name]       - Show webapp URL(s)"
    echo "                          Without app-name: shows all URLs"
    echo "                          With app-name: shows specific app URL"
    echo "  help                  - Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  FORCE_REBUILD=true    - Force rebuild of Docker image even if recent image exists"
    echo ""
    echo "Image Management:"
    echo "  - Images are tagged with content-based hash (dep-<hash>) and 'latest'"
    echo "  - Rebuilds are skipped if:"
    echo "    - Image with current dependency hash already exists, OR"
    echo "    - Recent 'latest' image exists (< 1 hour old, unless FORCE_REBUILD=true)"
    echo "  - Uses IfNotPresent pull policy to better utilize cached images"
    echo ""
    echo "Available apps:"
    echo "  csi-driver                  - Secrets Store CSI Driver"
    echo "  direct-api                  - Direct Azure Key Vault API"
    echo "  secret-sync                 - Kubernetes Secret Sync"
    echo "  external-secrets-redhat     - Red Hat External Secrets Operator"
    echo "  certificate-tls              - Certificate-Based TLS (CSI Driver)"
    echo "  hot-reload                  - Hot Reload (CSI Driver)"
    echo "  rotation-handler             - Secret Rotation Handler"
    echo "  versioning-dashboard         - Secret Versioning Dashboard"
    echo "  multi-vault                 - Multi-Vault Access"
    echo "  expiration-monitor           - Secret Expiration Monitor"
    echo "  audit-dashboard              - Secret Audit Dashboard"
    echo "  validation-checker           - Secret Validation Checker"
    echo "  security-dashboard           - Security & Compliance Dashboard"
    echo "  selective-sync               - Selective Secret Sync"
    echo "  cross-namespace              - Cross-Namespace Secret Sharing"
    echo ""
    echo "Examples:"
    echo "  $0 deploy                                    # Deploy all apps"
    echo "  $0 deploy csi-driver                        # Deploy only CSI Driver app"
    echo "  $0 cleanup direct-api                       # Clean up Direct API app"
    echo "  $0 urls external-secrets-redhat              # Show ESO app URL"
}

# Main script logic
COMMAND="${1:-deploy}"
APP_NAME="${2:-}"

case "$COMMAND" in
    "deploy")
        if [ -z "$APP_NAME" ]; then
        deploy_all_webapps
        else
            deploy_specific_app "$APP_NAME"
        fi
        ;;
    "cleanup")
        cleanup_webapps "${APP_NAME:-all}"
        ;;
    "urls")
        show_urls "${APP_NAME:-all}"
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        print_error "Unknown command: $COMMAND"
        echo ""
        show_help
        exit 1
        ;;
esac

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');

class HelloWorldWebapp {
    constructor(config) {
        this.PORT = process.env.PORT || 3000;
        this.APP_NAME = config.appName || 'Hello World App';
        this.METHOD = config.method || 'Unknown Method';
        this.OPERATOR = config.operator || '';
        this.SECRETS_MOUNT_PATH = config.secretsMountPath || '/etc/secrets';
        // Check config first, then environment variable, then empty string
        this.KEYVAULT_URL = config.keyvaultUrl || process.env.KEYVAULT_URL || '';
        
        // Caching
        this.cachedSecrets = {};
        this.lastCacheTime = 0;
        this.CACHE_DURATION = 30000; // 30 seconds
        
        // Secret retrieval strategy
        this.secretStrategy = config.secretStrategy || 'environment';
        
        // Initialize Azure Key Vault client if using azure-api strategy
        if (this.secretStrategy === 'azure-api') {
            this.initializeAzureKeyVaultClient();
        }
    }

    // Get secrets based on strategy
    async getSecrets() {
        const now = Date.now();
        
        // Return cached secrets if still valid
        if (now - this.lastCacheTime < this.CACHE_DURATION && Object.keys(this.cachedSecrets).length > 0) {
            return this.cachedSecrets;
        }
        
        const secrets = {};
        
        try {
            switch (this.secretStrategy) {
                case 'csi':
                    secrets['hello-world-secret'] = this.getSecretFromCSI('hello-world-secret');
                    secrets['database-password'] = this.getSecretFromCSI('database-password');
                    secrets['api-key'] = this.getSecretFromCSI('api-key');
                    break;
                case 'azure-api':
                    secrets['hello-world-secret'] = await this.getSecretFromAzureKeyVault('hello-world-secret');
                    secrets['database-password'] = await this.getSecretFromAzureKeyVault('database-password');
                    secrets['api-key'] = await this.getSecretFromAzureKeyVault('api-key');
                    break;
                case 'environment':
                default:
                    secrets['hello-world-secret'] = process.env.HELLO_WORLD_SECRET || 'Secret not found';
                    secrets['database-password'] = process.env.DATABASE_PASSWORD || 'Secret not found';
                    secrets['api-key'] = process.env.API_KEY || 'Secret not found';
                    break;
            }
            
            // Cache the secrets
            this.cachedSecrets = secrets;
            this.lastCacheTime = now;
            
            return secrets;
        } catch (error) {
            console.error('Error fetching secrets:', error);
            throw error;
        }
    }

    // CSI Driver secret retrieval
    getSecretFromCSI(secretName) {
        try {
            const secretPath = path.join(this.SECRETS_MOUNT_PATH, secretName);
            
            if (fs.existsSync(secretPath)) {
                const secretValue = fs.readFileSync(secretPath, 'utf8').trim();
                return secretValue;
            } else {
                throw new Error(`Secret file not found: ${secretPath}`);
            }
        } catch (error) {
            console.error(`Error reading secret '${secretName}' from CSI:`, error.message);
            throw error;
        }
    }

    // Initialize Azure Key Vault client
    initializeAzureKeyVaultClient() {
        try {
            
            // Use Service Principal authentication via ClientSecretCredential
            // Requires AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables
            const tenantId = process.env.AZURE_TENANT_ID;
            const clientId = process.env.AZURE_CLIENT_ID;
            const clientSecret = process.env.AZURE_CLIENT_SECRET;
            
            if (!tenantId || !clientId || !clientSecret) {
                throw new Error('Missing required environment variables: AZURE_TENANT_ID, AZURE_CLIENT_ID, or AZURE_CLIENT_SECRET');
            }
            
            const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
            this.keyVaultClient = new SecretClient(this.KEYVAULT_URL, credential);
            
        } catch (error) {
            console.error('Failed to initialize Azure Key Vault client:', error);
            this.keyVaultClient = null;
        }
    }

    // Azure Key Vault secret retrieval
    async getSecretFromAzureKeyVault(secretName) {
        if (!this.KEYVAULT_URL || this.KEYVAULT_URL === '') {
            throw new Error('KEYVAULT_URL environment variable is required for Azure API authentication');
        }
        
        if (!this.keyVaultClient) {
            throw new Error('Azure Key Vault client not initialized. Check AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables.');
        }
        
        try {
            
            const secret = await this.keyVaultClient.getSecret(secretName);
            return secret.value;
        } catch (error) {
            console.error(`Error fetching secret '${secretName}' from Azure Key Vault:`, error.message);
            
            // Provide more specific error messages
            if (error.code === 'SecretNotFound') {
                throw new Error(`Secret '${secretName}' not found in Key Vault`);
            } else if (error.code === 'Unauthorized') {
                throw new Error(`Unauthorized to access Key Vault. Check authentication credentials.`);
            } else if (error.code === 'Forbidden') {
                throw new Error(`Access forbidden to Key Vault. Check permissions.`);
            } else {
                throw new Error(`Azure Key Vault error: ${error.message}`);
            }
        }
    }

    // Generate HTML interface
    getHTML() {
        const badgeHtml = this.OPERATOR ? `<span class="redhat-badge">${this.OPERATOR}</span>` : '';
        const methodDetails = this.getMethodDetails();
        
        return `<!DOCTYPE html>
<html>
<head>
    <title>${this.APP_NAME}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; color: #333; margin-bottom: 30px; }
        .method { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .secret-item { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #4caf50; }
        .secret-name { font-weight: bold; color: #2e7d32; }
        .secret-value { font-family: monospace; background: #263238; color: #4caf50; padding: 5px; border-radius: 3px; margin-top: 5px; }
        .error { background: #ffebee; color: #c62828; padding: 15px; border-radius: 5px; border-left: 4px solid #f44336; }
        .refresh-btn { background: #4caf50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 10px 0; }
        .refresh-btn:hover { background: #388e3c; }
        .redhat-badge { background: #ee0000; color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${this.APP_NAME}</h1>
            <h2>${this.METHOD} ${badgeHtml}</h2>
            <p>This application consumes secrets from Azure Key Vault via ${this.METHOD}</p>
        </div>
        
        <div class="method">
            <h3>🔑 Secret Access Method</h3>
            ${methodDetails}
        </div>
        
        <div id="secrets-container">
            <h3>[*] Live Secrets</h3>
            <div id="secrets-list">Loading secrets...</div>
            <button class="refresh-btn" onclick="refreshSecrets()">[REFRESH] Refresh Secrets</button>
        </div>
        
        <div id="error-container" style="display: none;"></div>
    </div>
    
    <script>
        async function fetchSecrets() {
            try {
                const response = await fetch('/api/secrets');
                const data = await response.json();
                
                if (data.error) {
                    document.getElementById('error-container').innerHTML = 
                        '<div class="error"><strong>Error:</strong> ' + data.error + '</div>';
                    document.getElementById('error-container').style.display = 'block';
                    document.getElementById('secrets-list').innerHTML = 'Failed to load secrets';
                } else {
                    document.getElementById('error-container').style.display = 'none';
                    
                    let html = '';
                    
                    // Handle versioning dashboard format (data.versions) vs regular format (data.secrets)
                    const dataToProcess = data.versions || data.secrets || {};
                    
                    Object.keys(dataToProcess).forEach(key => {
                        const value = dataToProcess[key];
                        
                        // If it's an array (versions), show version count and latest value
                        if (Array.isArray(value) && value.length > 0) {
                            const latestVersion = value[0]; // First item is newest
                            html += '<div class="secret-item">' +
                                '<div class="secret-name">' + key + ' <span style="color: #666; font-size: 0.8em;">(' + value.length + ' versions)</span></div>' +
                                '<div class="secret-value">' + (latestVersion.value || 'N/A') + '</div>' +
                                '<div style="font-size: 0.8em; color: #666; margin-top: 5px;">Latest: ' + (latestVersion.createdOn ? new Date(latestVersion.createdOn).toLocaleString() : 'N/A') + '</div>' +
                            '</div>';
                        } else if (typeof value === 'string') {
                            // Regular secret format
                            html += '<div class="secret-item">' +
                                '<div class="secret-name">' + key + '</div>' +
                                '<div class="secret-value">' + value + '</div>' +
                            '</div>';
                        }
                    });
                    document.getElementById('secrets-list').innerHTML = html;
                }
            } catch (error) {
                document.getElementById('error-container').innerHTML = 
                    '<div class="error"><strong>Network Error:</strong> ' + error.message + '</div>';
                document.getElementById('error-container').style.display = 'block';
            }
        }
        
        function refreshSecrets() {
            fetchSecrets();
        }
        
        // Load secrets on page load
        fetchSecrets();
        
        // Auto-refresh every 30 seconds
        setInterval(fetchSecrets, 30000);
    </script>
</body>
</html>`;
    }

    // Generate base HTML without the secrets container (for custom dashboards)
    getBaseHTML() {
        const badgeHtml = this.OPERATOR ? `<span class="redhat-badge">${this.OPERATOR}</span>` : '';
        const methodDetails = this.getMethodDetails();
        
        return `<!DOCTYPE html>
<html>
<head>
    <title>${this.APP_NAME}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; color: #333; margin-bottom: 30px; }
        .method { background: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .secret-item { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #4caf50; }
        .secret-name { font-weight: bold; color: #2e7d32; }
        .secret-value { font-family: monospace; background: #263238; color: #4caf50; padding: 5px; border-radius: 3px; margin-top: 5px; }
        .error { background: #ffebee; color: #c62828; padding: 15px; border-radius: 5px; border-left: 4px solid #f44336; }
        .refresh-btn { background: #4caf50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 10px 0; }
        .refresh-btn:hover { background: #388e3c; }
        .redhat-badge { background: #ee0000; color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${this.APP_NAME}</h1>
            <h2>${this.METHOD} ${badgeHtml}</h2>
            <p>This application consumes secrets from Azure Key Vault via ${this.METHOD}</p>
        </div>
        
        <div class="method">
            <h3>🔑 Secret Access Method</h3>
            ${methodDetails}
        </div>
        
        <div id="error-container" style="display: none;"></div>
    </div>
    
    <script>
        // Custom dashboards can override this function
        function refreshSecrets() {
            // Override in custom dashboard
        }
        
        // Custom dashboards can override this function
        function fetchSecrets() {
            // Override in custom dashboard
        }
    </script>
</body>
</html>`;
    }

    getMethodDetails() {
        switch (this.secretStrategy) {
            case 'csi':
                return `
                    <p><strong>Method:</strong> Secrets Store CSI Driver</p>
                    <p><strong>Mount Path:</strong> ${this.SECRETS_MOUNT_PATH}</p>
                    <p><strong>Authentication:</strong> Service Principal via nodePublishSecretRef</p>
                    <p><strong>Cache Duration:</strong> 30 seconds</p>
                `;
            case 'azure-api':
                return `
                    <p><strong>Method:</strong> Direct Azure Key Vault API</p>
                    <p><strong>Key Vault URL:</strong> ${this.KEYVAULT_URL}</p>
                    <p><strong>Authentication:</strong> ClientSecretCredential (Service Principal)</p>
                    <p><strong>Cache Duration:</strong> 30 seconds</p>
                    <p><strong>SDK:</strong> @azure/keyvault-secrets</p>
                `;
            case 'environment':
            default:
                return `
                    <p><strong>Method:</strong> ${this.METHOD}</p>
                    <p><strong>Operator:</strong> ${this.OPERATOR || 'Kubernetes-native'}</p>
                    <p><strong>Authentication:</strong> Service Principal via Kubernetes Secret</p>
                    <p><strong>Sync Interval:</strong> 30 seconds</p>
                    <p><strong>Consumption:</strong> Environment variables from synced Kubernetes Secret</p>
                `;
        }
    }

    // Create HTTP server
    createServer() {
        return http.createServer(async (req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const pathname = parsedUrl.pathname;
            
            // Set CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (pathname === '/api/secrets') {
                try {
                    const secrets = await this.getSecrets();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        method: this.METHOD,
                        operator: this.OPERATOR,
                        secrets: secrets,
                        timestamp: new Date().toISOString(),
                        cacheAge: Date.now() - this.lastCacheTime,
                        note: this.getNote()
                    }));
                } catch (error) {
                    console.error('API Error:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: false,
                        error: error.message,
                        method: this.METHOD,
                        timestamp: new Date().toISOString()
                    }));
                }
            } else if (pathname === '/api/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'healthy',
                    app: this.APP_NAME,
                    namespace: process.env.NAMESPACE || 'unknown',
                    version: '1.0.0',
                    timestamp: new Date().toISOString(),
                    method: this.METHOD,
                    operator: this.OPERATOR
                }));
            } else if (pathname === '/') {
                // Allow child classes to override HTML rendering
                if (this.handleRequest && typeof this.handleRequest === 'function') {
                    try {
                        await this.handleRequest(req, res);
                    } catch (error) {
                        console.error('Error in handleRequest:', error);
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(this.getHTML());
                    }
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(this.getHTML());
                }
            } else {
                // Allow child classes to handle custom routes
                if (this.handleRequest && typeof this.handleRequest === 'function') {
                    try {
                        await this.handleRequest(req, res);
                    } catch (error) {
                        console.error('Error in handleRequest:', error);
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found');
                    }
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not Found');
                }
            }
        });
    }

    getNote() {
        switch (this.secretStrategy) {
            case 'csi':
                return 'Secrets are mounted as files via Secrets Store CSI Driver';
            case 'azure-api':
                return 'Secrets are fetched directly from Azure Key Vault API';
            case 'environment':
            default:
                return 'Secrets are synced from Azure Key Vault via External Secrets Operator';
        }
    }

    start() {
        const server = this.createServer();
        server.listen(this.PORT, '0.0.0.0', () => {
            console.log(`${this.APP_NAME} running on port ${this.PORT}`);
            console.log(`Method: ${this.METHOD}`);
            if (this.secretStrategy === 'csi') {
                console.log(`Secrets mount path: ${this.SECRETS_MOUNT_PATH}`);
            }
        });
    }
}

module.exports = HelloWorldWebapp;

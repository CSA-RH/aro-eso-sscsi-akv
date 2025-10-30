const http = require('http');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('./webapp-framework');

class VersioningDashboardWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.keyVaultClient = null;
        this.versionCache = {};
        this.cacheExpiry = 60000; // Cache versions for 60 seconds
        this.initializeAzureKeyVaultClient();
    }

    initializeAzureKeyVaultClient() {
        try {
            const tenantId = process.env.AZURE_TENANT_ID;
            const clientId = process.env.AZURE_CLIENT_ID;
            const clientSecret = process.env.AZURE_CLIENT_SECRET;
            const keyVaultUrl = this.KEYVAULT_URL || process.env.KEYVAULT_URL;

            if (!tenantId || !clientId || !clientSecret || !keyVaultUrl) {
                throw new Error('Missing required Azure credentials');
            }

            const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
            this.keyVaultClient = new SecretClient(keyVaultUrl, credential);
        } catch (error) {
            console.error('Failed to initialize Azure Key Vault client:', error.message);
        }
    }

    async getAllVersions(secretName, useCache = true) {
        if (!this.keyVaultClient) {
            return { error: 'Key Vault client not initialized' };
        }

        // Check cache
        const cacheKey = `versions_${secretName}`;
        if (useCache && this.versionCache[cacheKey]) {
            const cached = this.versionCache[cacheKey];
            if (Date.now() - cached.timestamp < this.cacheExpiry) {
                return cached.data;
            }
        }

        try {
            const versions = [];
            // Use listPropertiesOfSecretVersions to get all versions of a secret
            const iterator = this.keyVaultClient.listPropertiesOfSecretVersions(secretName);
            
            for await (const version of iterator) {
                // Get the actual secret value for each version
                try {
                    const secret = await this.keyVaultClient.getSecret(secretName, { version: version.version });
                    versions.push({
                        id: version.id,
                        name: version.name,
                        version: version.version,
                        value: secret.value,
                        enabled: version.enabled,
                        createdOn: version.createdOn?.toISOString() || null,
                        updatedOn: version.updatedOn?.toISOString() || null,
                        expiresOn: version.expiresOn?.toISOString() || null,
                        contentType: version.contentType || null,
                        tags: version.tags || {}
                    });
                } catch (error) {
                    // If we can't get the value, still include the metadata
                    versions.push({
                        id: version.id,
                        name: version.name,
                        version: version.version,
                        value: null,
                        valueError: error.message,
                        enabled: version.enabled,
                        createdOn: version.createdOn?.toISOString() || null,
                        updatedOn: version.updatedOn?.toISOString() || null,
                        expiresOn: version.expiresOn?.toISOString() || null,
                        contentType: version.contentType || null,
                        tags: version.tags || {}
                    });
                }
            }

            // Sort by created date (newest first)
            versions.sort((a, b) => {
                const timeA = a.createdOn ? new Date(a.createdOn).getTime() : 0;
                const timeB = b.createdOn ? new Date(b.createdOn).getTime() : 0;
                return timeB - timeA;
            });

            // Cache the result
            this.versionCache[cacheKey] = {
                data: versions,
                timestamp: Date.now()
            };

            return versions;
        } catch (error) {
            console.error(`Error fetching versions for ${secretName}:`, error.message);
            return { error: error.message };
        }
    }

    async getAllSecretsVersions() {
        if (!this.keyVaultClient) {
            return { error: 'Key Vault client not initialized' };
        }

        try {
            const allVersions = {};
            const secretNames = ['hello-world-secret', 'database-password', 'api-key'];
            
            for (const secretName of secretNames) {
                const versions = await this.getAllVersions(secretName);
                if (versions.error) {
                    console.error(`Error fetching versions for ${secretName}:`, versions.error);
                    allVersions[secretName] = [];
                } else {
                    allVersions[secretName] = versions;
                }
            }
            
            return allVersions;
        } catch (error) {
            console.error('Error fetching all secrets versions:', error.message);
            return { error: error.message };
        }
    }

    async getSecretVersion(secretName, version) {
        if (!this.keyVaultClient) {
            return { error: 'Key Vault client not initialized' };
        }

        try {
            // Get secret with specific version - properties are included
            const secret = await this.keyVaultClient.getSecret(secretName, { version });
            
            return {
                name: secret.name,
                version: version,
                value: secret.value,
                enabled: secret.properties.enabled,
                createdOn: secret.properties.createdOn?.toISOString() || null,
                updatedOn: secret.properties.updatedOn?.toISOString() || null,
                expiresOn: secret.properties.expiresOn?.toISOString() || null,
                contentType: secret.properties.contentType || null,
                tags: secret.properties.tags || {}
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    async compareVersions(secretName, version1, version2) {
        const v1 = await this.getSecretVersion(secretName, version1);
        const v2 = await this.getSecretVersion(secretName, version2);

        if (v1.error || v2.error) {
            return { error: v1.error || v2.error };
        }

        return {
            secretName,
            version1: {
                version: v1.version,
                created: v1.createdOn,
                value: v1.value,
                enabled: v1.enabled
            },
            version2: {
                version: v2.version,
                created: v2.createdOn,
                value: v2.value,
                enabled: v2.enabled
            },
            valuesMatch: v1.value === v2.value,
            bothEnabled: v1.enabled && v2.enabled
        };
    }

    async handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === '/api/health' || url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy', versioning: true }));
            return;
        }

        if (url.pathname === '/api/secrets') {
            // Return all secrets with their versions for the shared framework
            try {
                const allVersions = await this.getAllSecretsVersions();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    method: this.METHOD,
                    operator: this.OPERATOR,
                    versions: allVersions,
                    timestamp: new Date().toISOString()
                }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
            return;
        }

        if (url.pathname === '/api/versions') {
            const secretName = url.searchParams.get('secret');
            if (!secretName) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Secret name required' }));
                return;
            }
            const versions = await this.getAllVersions(secretName);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(versions));
            return;
        }

        if (url.pathname.startsWith('/api/version/')) {
            const parts = url.pathname.replace('/api/version/', '').split('/');
            const secretName = decodeURIComponent(parts[0]);
            const version = parts[1] || url.searchParams.get('version') || null;
            
            if (!version) {
                // Get latest
                const secret = await this.keyVaultClient.getSecret(secretName);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(secret));
                return;
            }

            const versionData = await this.getSecretVersion(secretName, version);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(versionData));
            return;
        }

        if (url.pathname === '/api/compare') {
            const secretName = url.searchParams.get('secret');
            const v1 = url.searchParams.get('v1');
            const v2 = url.searchParams.get('v2');

            if (!secretName || !v1 || !v2) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Secret name, v1, and v2 parameters required' }));
                return;
            }

            const comparison = await this.compareVersions(secretName, v1, v2);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(comparison));
            return;
        }

        if (url.pathname.startsWith('/api/')) {
            // Get versions for all monitored secrets
            const secrets = ['database-password', 'api-key', 'hello-world-secret'];
            const allVersions = {};
            
            for (const secretName of secrets) {
                allVersions[secretName] = await this.getAllVersions(secretName);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ versions: allVersions }));
            return;
        }

        // Generate HTML dashboard
        const secrets = await this.getSecrets();
        const baseHTML = this.getHTML();
        const versioningHTML = this.getHTMLWithVersioningDashboard(secrets);
        
        // Replace the entire secrets container with our custom versioning dashboard
        let fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>\s*<div id="error-container">/, 
            versioningHTML + '\n        <div id="error-container">');
        
        if (fullHTML === baseHTML) {
            // Fallback pattern if the first one doesn't match
            fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>/, versioningHTML);
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }

    async getAllSecretsVersionInfo() {
        const secrets = ['database-password', 'api-key', 'hello-world-secret'];
        const versionInfo = {};
        
        for (const secretName of secrets) {
            try {
                const versions = await this.getAllVersions(secretName);
                versionInfo[secretName] = {
                    totalVersions: versions.length,
                    versions: versions.slice(0, 10), // Latest 10
                    latestVersion: versions[0] || null,
                    oldestVersion: versions[versions.length - 1] || null
                };
            } catch (error) {
                versionInfo[secretName] = {
                    error: error.message,
                    totalVersions: 0
                };
            }
        }
        
        return versionInfo;
    }

    getHTMLWithVersioningDashboard(secrets) {
        const dashboardSection = `
            <div class="versioning-section">
                <h2>[*] Secret Versioning & History Dashboard</h2>
                <p class="section-description">
                    Monitor and manage secret versions from Azure Key Vault. View all versions, 
                    compare values, and access specific versions for rollback scenarios.
                </p>
                
                <div id="versions-summary" class="stats-grid">
                    <div class="stat-card loading">
                        <div class="stat-value">...</div>
                        <div class="stat-label">Loading...</div>
                    </div>
                </div>

                <div id="versions-container" class="versions-container">
                    <div class="loading-indicator">Loading versions...</div>
                </div>

                <div class="action-buttons">
                    <button class="action-btn primary" onclick="loadVersions()">[REFRESH] Refresh Versions</button>
                    <button class="action-btn warning" onclick="clearCache()">[CLEAR] Clear Cache</button>
                    <button class="action-btn info" onclick="compareVersions()">[COMPARE] Compare Versions</button>
                </div>

                <div class="info-box">
                    <h4>[*] How Versioning Works</h4>
                    <ul>
                        <li><strong>Version History:</strong> Azure Key Vault maintains a complete history of all secret versions</li>
                        <li><strong>Automatic Versioning:</strong> Each time you update a secret, a new version is created</li>
                        <li><strong>Rollback Support:</strong> Access any previous version by using its version ID</li>
                        <li><strong>Version Comparison:</strong> Compare different versions to see what changed</li>
                        <li><strong>Metadata:</strong> Each version includes creation date, enabled status, and expiration information</li>
                    </ul>
                </div>

                <style>
                    .versioning-section {
                        background: #fff;
                        padding: 30px;
                        margin: 20px 0;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .section-description {
                        color: #6c757d;
                        margin-bottom: 20px;
                    }
                    .stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 20px;
                        margin: 20px 0;
                    }
                    .stat-card {
                        padding: 20px;
                        background: #f8f9fa;
                        border-radius: 8px;
                        text-align: center;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .stat-card.loading {
                        background: #e9ecef;
                    }
                    .stat-value {
                        font-size: 2.5em;
                        font-weight: bold;
                        color: #007bff;
                    }
                    .stat-label {
                        margin-top: 10px;
                        color: #6c757d;
                    }
                    .versions-container {
                        background: white;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                        min-height: 200px;
                    }
                    .loading-indicator {
                        text-align: center;
                        padding: 40px;
                        color: #6c757d;
                    }
                    .secret-versions {
                        margin: 20px 0;
                        padding: 15px;
                        background: #f8f9fa;
                        border-radius: 8px;
                        border-left: 4px solid #4caf50;
                    }
                    .secret-versions h4 {
                        margin-top: 0;
                        color: #2e7d32;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .version-count {
                        font-size: 0.9em;
                        color: #6c757d;
                        font-weight: normal;
                    }
                    .version-item {
                        margin: 10px 0;
                        padding: 12px;
                        background: white;
                        border-left: 3px solid #4caf50;
                        border-radius: 4px;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    }
                    .version-item.latest {
                        border-left-color: #ff9800;
                        background: #fff3e0;
                    }
                    .version-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 8px;
                    }
                    .version-id {
                        font-family: monospace;
                        font-size: 0.85em;
                        background: #e0e0e0;
                        padding: 2px 6px;
                        border-radius: 3px;
                    }
                    .version-badge {
                        padding: 2px 8px;
                        border-radius: 12px;
                        font-size: 0.75em;
                        font-weight: bold;
                    }
                    .badge-latest {
                        background: #ff9800;
                        color: white;
                    }
                    .badge-enabled {
                        background: #4caf50;
                        color: white;
                    }
                    .badge-disabled {
                        background: #9e9e9e;
                        color: white;
                    }
                    .version-meta {
                        font-size: 0.85em;
                        color: #6c757d;
                        margin: 5px 0;
                    }
                    .version-value {
                        font-family: monospace;
                        background: #263238;
                        color: #4caf50;
                        padding: 6px;
                        border-radius: 3px;
                        margin-top: 8px;
                        word-break: break-all;
                    }
                    .action-buttons {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 10px;
                        margin: 20px 0;
                    }
                    .action-btn {
                        padding: 10px 20px;
                        border: none;
                        border-radius: 5px;
                        cursor: pointer;
                        font-weight: 500;
                        transition: opacity 0.2s;
                    }
                    .action-btn:hover {
                        opacity: 0.9;
                    }
                    .action-btn.primary {
                        background: #4caf50;
                        color: white;
                    }
                    .action-btn.warning {
                        background: #ff9800;
                        color: white;
                    }
                    .action-btn.info {
                        background: #2196f3;
                        color: white;
                    }
                    .info-box {
                        background: #e7f3ff;
                        border-left: 4px solid #007bff;
                        padding: 15px;
                        border-radius: 4px;
                        margin: 20px 0;
                    }
                    .info-box h4 {
                        margin-top: 0;
                        color: #0056b3;
                    }
                    .info-box ul {
                        margin: 10px 0;
                        padding-left: 20px;
                    }
                    .info-box li {
                        margin: 8px 0;
                    }
                    .error-box {
                        background: #ffebee;
                        border-left: 4px solid #f44336;
                        padding: 15px;
                        border-radius: 4px;
                        margin: 10px 0;
                    }
                </style>
                <script>
                    async function loadVersions() {
                        const secrets = ['database-password', 'api-key', 'hello-world-secret'];
                        const container = document.getElementById('versions-container');
                        const summary = document.getElementById('versions-summary');
                        
                        container.innerHTML = '<div class="loading-indicator">Loading versions...</div>';
                        summary.innerHTML = '<div class="stat-card loading"><div class="stat-value">...</div><div class="stat-label">Loading...</div></div>';
                        
                        let totalVersions = 0;
                        let html = '';
                        let summaryHTML = '';
                        
                        for (const secret of secrets) {
                            try {
                                const response = await fetch('/api/versions?secret=' + encodeURIComponent(secret));
                                const versions = await response.json();
                                
                                if (versions.error) {
                                    html += '<div class="error-box"><strong>' + secret + ':</strong> Error: ' + versions.error + '</div>';
                                } else {
                                    totalVersions += versions.length;
                                    html += '<div class="secret-versions">';
                                    html += '<h4>' + secret + ' <span class="version-count">(' + versions.length + ' version' + (versions.length !== 1 ? 's' : '') + ')</span></h4>';
                                    
                                    versions.slice(0, 10).forEach((v, index) => {
                                        const isLatest = index === 0;
                                        const age = v.createdOn ? Math.floor((Date.now() - new Date(v.createdOn).getTime()) / (1000 * 60 * 60 * 24)) : null;
                                        html += '<div class="version-item' + (isLatest ? ' latest' : '') + '">';
                                        html += '<div class="version-header">';
                                        html += '<span class="version-id">' + v.version.substring(0, 12) + '...</span>';
                                        html += '<span class="version-badge ' + (isLatest ? 'badge-latest' : 'badge-enabled') + '">' + (isLatest ? 'LATEST' : 'v' + (versions.length - index)) + '</span>';
                                        html += '</div>';
                                        html += '<div class="version-meta">';
                                        html += '<strong>Created:</strong> ' + (v.createdOn ? new Date(v.createdOn).toLocaleString() : 'Unknown');
                                        if (age !== null) {
                                            html += ' <span style="color: #999;">(' + age + ' days ago)</span>';
                                        }
                                        html += '<br><strong>Status:</strong> <span class="version-badge ' + (v.enabled ? 'badge-enabled' : 'badge-disabled') + '">' + (v.enabled ? 'Enabled' : 'Disabled') + '</span>';
                                        if (v.expiresOn) {
                                            html += ' | <strong>Expires:</strong> ' + new Date(v.expiresOn).toLocaleDateString();
                                        }
                                        html += '</div>';
                                        if (v.value) {
                                            html += '<div class="version-value">' + (v.value.length > 50 ? v.value.substring(0, 50) + '...' : v.value) + '</div>';
                                        }
                                        html += '</div>';
                                    });
                                    
                                    if (versions.length > 10) {
                                        html += '<div style="text-align: center; margin-top: 10px; color: #6c757d; font-style: italic;">... and ' + (versions.length - 10) + ' more versions</div>';
                                    }
                                    html += '</div>';
                                }
                            } catch (error) {
                                html += '<div class="error-box"><strong>' + secret + ':</strong> ' + error.message + '</div>';
                            }
                        }
                        
                        summaryHTML = '<div class="stat-card"><div class="stat-value">' + totalVersions + '</div><div class="stat-label">Total Versions</div></div>';
                        summaryHTML += '<div class="stat-card"><div class="stat-value">' + secrets.length + '</div><div class="stat-label">Tracked Secrets</div></div>';
                        summaryHTML += '<div class="stat-card"><div class="stat-value">' + (totalVersions / secrets.length).toFixed(1) + '</div><div class="stat-label">Avg per Secret</div></div>';
                        
                        summary.innerHTML = summaryHTML;
                        container.innerHTML = html || '<p class="loading-indicator">No versions found</p>';
                    }
                    
                    function compareVersions() {
                        const secret = prompt('Enter secret name:', 'database-password');
                        if (!secret) return;
                        
                        const v1 = prompt('Enter first version ID (leave empty for latest):');
                        const v2 = prompt('Enter second version ID:');
                        
                        if (!v2) {
                            alert('Version 2 is required');
                            return;
                        }
                        
                        const url = '/api/compare?secret=' + encodeURIComponent(secret) + 
                                   '&v1=' + encodeURIComponent(v1 || 'latest') + 
                                   '&v2=' + encodeURIComponent(v2);
                        
                        fetch(url)
                            .then(r => r.json())
                            .then(data => {
                                if (data.error) {
                                    alert('Error: ' + data.error);
                                } else {
                                    alert('Comparison:\\n\\n' +
                                          'Version 1: ' + data.version1.substring(0, 20) + '...\\n' +
                                          'Version 2: ' + data.version2.substring(0, 20) + '...\\n\\n' +
                                          'Values ' + (data.valuesMatch ? 'match' : 'differ') + '\\n' +
                                          'Created: ' + (data.created1 ? new Date(data.created1).toLocaleString() : 'N/A') + ' vs ' + 
                                          (data.created2 ? new Date(data.created2).toLocaleString() : 'N/A'));
                                }
                            })
                            .catch(err => alert('Error: ' + err.message));
                    }

                    function clearCache() {
                        fetch('/api/versions?secret=database-password').then(() => {
                            alert('Cache cleared. Refreshing...');
                            loadVersions();
                        });
                    }

                    // Load on page load
                    loadVersions();
                </script>
            </div>
        `;

        return dashboardSection;
    }

    start() {
        this.secretStrategy = 'azure-api';

        const server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch(error => {
                console.error('Request error:', error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            });
        });

        server.listen(this.PORT, () => {
            console.log(`${this.APP_NAME} running on port ${this.PORT} (${this.METHOD})`);
        });
    }
}

const app = new VersioningDashboardWebapp({
    appName: 'Hello World - Versioning Dashboard',
    method: 'Secret Versioning Dashboard',
    operator: '',
    keyvaultUrl: process.env.KEYVAULT_URL || '',
    secretStrategy: 'azure-api'
});

app.start();


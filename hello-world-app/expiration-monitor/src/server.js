const http = require('http');
const url = require('url');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('./webapp-framework');

class ExpirationMonitorWebapp extends HelloWorldWebapp {
    constructor(config) {
        // Ensure KEYVAULT_URL is set from environment if not in config
        const configWithKeyVault = {
            ...config,
            keyvaultUrl: config.keyvaultUrl || process.env.KEYVAULT_URL || ''
        };
        super(configWithKeyVault);
        
        // Override KEYVAULT_URL if it's still empty but environment variable exists
        if (!this.KEYVAULT_URL && process.env.KEYVAULT_URL) {
            this.KEYVAULT_URL = process.env.KEYVAULT_URL;
        }
        
        this.secretExpirationData = [];
        this.lastExpirationCheck = 0;
        this.EXPIRATION_CHECK_INTERVAL = 60000; // 1 minute
        this.WARNING_THRESHOLDS = {
            critical: 7,    // 7 days
            warning: 30,    // 30 days
            info: 90        // 90 days
        };
        
        // Re-initialize Azure client if needed (in case it wasn't initialized in parent constructor)
        if (this.secretStrategy === 'azure-api' && !this.keyVaultClient && this.KEYVAULT_URL) {
            this.initializeAzureKeyVaultClient();
        }
    }

    initializeAzureKeyVaultClient() {
        const tenantId = process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;
        const keyVaultUrl = process.env.KEYVAULT_URL;

        if (!tenantId || !clientId || !clientSecret || !keyVaultUrl) {
            console.error('Missing required Azure credentials for expiration monitoring');
            return;
        }

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        this.keyVaultClient = new SecretClient(keyVaultUrl, credential);
    }

    async checkSecretExpiration() {
        const now = Date.now();
        if (now - this.lastExpirationCheck < this.EXPIRATION_CHECK_INTERVAL && this.secretExpirationData.length > 0) {
            return this.secretExpirationData;
        }

        try {
            const secrets = await this.getAllSecretsWithProperties();
            this.secretExpirationData = secrets.map(secret => {
                const expiresOn = secret.properties.expiresOn;
                const createdOn = secret.properties.createdOn;
                const updatedOn = secret.properties.updatedOn;
                const daysUntilExpiration = expiresOn 
                    ? Math.floor((expiresOn.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;
                
                // Calculate age
                const ageDays = createdOn 
                    ? Math.floor((Date.now() - createdOn.getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                const lastUpdatedDays = updatedOn 
                    ? Math.floor((Date.now() - updatedOn.getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                
                let status = 'valid';
                let statusClass = 'success';
                let needsAttention = false;
                let recommendation = '';
                
                if (daysUntilExpiration !== null) {
                    if (daysUntilExpiration < this.WARNING_THRESHOLDS.critical) {
                        status = 'critical';
                        statusClass = 'danger';
                        needsAttention = true;
                        recommendation = 'URGENT: Secret expires soon!';
                    } else if (daysUntilExpiration < this.WARNING_THRESHOLDS.warning) {
                        status = 'warning';
                        statusClass = 'warning';
                        needsAttention = true;
                        recommendation = 'Secret expires within 30 days';
                    } else if (daysUntilExpiration < this.WARNING_THRESHOLDS.info) {
                        status = 'info';
                        statusClass = 'info';
                        recommendation = 'Expires within 90 days';
                    }
                } else {
                    // Secret never expires - check if it should
                    if (lastUpdatedDays && lastUpdatedDays > 365) {
                        needsAttention = true;
                        recommendation = 'Consider setting expiration date';
                    }
                }

                return {
                    name: secret.name,
                    expiresOn: expiresOn ? expiresOn.toISOString() : 'Never',
                    daysUntilExpiration: daysUntilExpiration,
                    status: status,
                    statusClass: statusClass,
                    version: secret.properties.version,
                    enabled: secret.properties.enabled !== false,
                    createdOn: createdOn ? createdOn.toISOString() : null,
                    updatedOn: updatedOn ? updatedOn.toISOString() : null,
                    ageDays: ageDays,
                    lastUpdatedDays: lastUpdatedDays,
                    needsAttention: needsAttention,
                    recommendation: recommendation
                };
            }).sort((a, b) => {
                // Sort by: needs attention first, then expiration date (soonest first), then by name
                if (a.needsAttention !== b.needsAttention) {
                    return b.needsAttention - a.needsAttention;
                }
                if (a.daysUntilExpiration === null && b.daysUntilExpiration === null) {
                    // Both never expire - sort by last updated (oldest first)
                    if (a.lastUpdatedDays !== null && b.lastUpdatedDays !== null) {
                        return b.lastUpdatedDays - a.lastUpdatedDays;
                    }
                    return a.name.localeCompare(b.name);
                }
                if (a.daysUntilExpiration === null) return 1;
                if (b.daysUntilExpiration === null) return -1;
                return a.daysUntilExpiration - b.daysUntilExpiration;
            });

            this.lastExpirationCheck = now;
            return this.secretExpirationData;
        } catch (error) {
            console.error('Error checking secret expiration:', error);
            return [];
        }
    }

    async getAllSecretsWithProperties() {
        const secrets = [];
        try {
            for await (const secretProperties of this.keyVaultClient.listPropertiesOfSecrets()) {
                if (secretProperties.enabled !== false) {
                    try {
                        const secret = await this.keyVaultClient.getSecret(secretProperties.name);
                        secrets.push({
                            name: secretProperties.name,
                            properties: secret.properties
                        });
                    } catch (err) {
                        console.warn(`Failed to get secret ${secretProperties.name}:`, err.message);
                    }
                }
            }
        } catch (error) {
            console.error('Error listing secrets:', error);
        }
        return secrets;
    }

    getHTMLWithExpirationData(expirationData) {
        const critical = expirationData.filter(s => s.status === 'critical').length;
        const warning = expirationData.filter(s => s.status === 'warning').length;
        const info = expirationData.filter(s => s.status === 'info').length;
        const neverExpires = expirationData.filter(s => s.daysUntilExpiration === null).length;
        const needsAttention = expirationData.filter(s => s.needsAttention).length;
        const withExpiration = expirationData.filter(s => s.daysUntilExpiration !== null).length;
        
        // Separate secrets into categories
        const expiringSoon = expirationData.filter(s => s.daysUntilExpiration !== null && s.daysUntilExpiration < 90);
        const noExpiration = expirationData.filter(s => s.daysUntilExpiration === null);
        const staleSecrets = expirationData.filter(s => s.lastUpdatedDays && s.lastUpdatedDays > 365);

        return `
        <div class="container">
            <h2>Secret Expiration & Lifecycle Management</h2>
            
            <div class="status-summary">
                <div class="status-card danger">
                    <div class="status-number">${critical}</div>
                    <div class="status-label">Critical (&lt;7 days)</div>
                </div>
                <div class="status-card warning">
                    <div class="status-number">${warning}</div>
                    <div class="status-label">Warning (&lt;30 days)</div>
                </div>
                <div class="status-card info">
                    <div class="status-number">${info}</div>
                    <div class="status-label">Info (&lt;90 days)</div>
                </div>
                <div class="status-card ${needsAttention > 0 ? 'attention' : 'success'}">
                    <div class="status-number">${needsAttention}</div>
                    <div class="status-label">Needs Attention</div>
                </div>
                <div class="status-card neutral">
                    <div class="status-number">${withExpiration}</div>
                    <div class="status-label">With Expiration</div>
                </div>
                <div class="status-card neutral">
                    <div class="status-number">${neverExpires}</div>
                    <div class="status-label">No Expiration</div>
                </div>
            </div>

            ${expiringSoon.length > 0 ? `
            <div class="alert-box danger">
                <h3>[!] Secrets Expiring Soon (${expiringSoon.length})</h3>
                <p>These secrets will expire within 90 days and should be rotated or renewed:</p>
                <ul class="secret-list">
                    ${expiringSoon.map(s => `<li><strong>${s.name}</strong> - ${s.daysUntilExpiration} days remaining ${s.recommendation ? `(${s.recommendation})` : ''}</li>`).join('')}
                </ul>
            </div>
            ` : ''}

            ${staleSecrets.length > 0 ? `
            <div class="alert-box warning">
                <h3>[*] Stale Secrets (Not Updated in 365+ Days)</h3>
                <p>These secrets haven't been updated in over a year. Consider reviewing and rotating:</p>
                <ul class="secret-list">
                    ${staleSecrets.slice(0, 10).map(s => `<li><strong>${s.name}</strong> - Last updated ${s.lastUpdatedDays} days ago ${s.daysUntilExpiration === null ? '(no expiration set)' : ''}</li>`).join('')}
                    ${staleSecrets.length > 10 ? `<li><em>... and ${staleSecrets.length - 10} more</em></li>` : ''}
                </ul>
            </div>
            ` : ''}

            <h3>All Secrets Overview</h3>
            <div class="filter-controls">
                <button class="filter-btn active" onclick="filterSecrets('all')">All (${expirationData.length})</button>
                <button class="filter-btn" onclick="filterSecrets('expiring')">Expiring Soon (${expiringSoon.length})</button>
                <button class="filter-btn" onclick="filterSecrets('no-expiration')">No Expiration (${noExpiration.length})</button>
                <button class="filter-btn" onclick="filterSecrets('needs-attention')">Needs Attention (${needsAttention})</button>
            </div>
            <table class="secrets-table" id="secrets-table">
                <thead>
                    <tr>
                        <th>Secret Name</th>
                        <th>Expiration</th>
                        <th>Status</th>
                        <th>Last Updated</th>
                        <th>Age</th>
                        <th>Recommendation</th>
                    </tr>
                </thead>
                <tbody>
                    ${expirationData.map(secret => `
                    <tr class="${secret.statusClass} ${secret.needsAttention ? 'needs-attention' : ''}" data-category="${secret.daysUntilExpiration === null ? 'no-expiration' : secret.needsAttention ? 'expiring' : 'ok'}">
                        <td><strong>${secret.name}</strong></td>
                        <td>
                            ${secret.daysUntilExpiration !== null 
                                ? `<strong>${secret.daysUntilExpiration} days</strong><br><small>${new Date(secret.expiresOn).toLocaleDateString()}</small>`
                                : '<em>Never expires</em>'}
                        </td>
                        <td>
                            <span class="badge badge-${secret.statusClass}">${secret.status.toUpperCase()}</span>
                        </td>
                        <td>
                            ${secret.lastUpdatedDays !== null 
                                ? `${secret.lastUpdatedDays} days ago<br><small>${secret.updatedOn ? new Date(secret.updatedOn).toLocaleDateString() : 'N/A'}</small>`
                                : 'N/A'}
                        </td>
                        <td>
                            ${secret.ageDays !== null 
                                ? `${secret.ageDays} days old`
                                : 'N/A'}
                        </td>
                        <td>
                            ${secret.recommendation 
                                ? `<span class="recommendation">${secret.recommendation}</span>`
                                : '<span class="text-muted">None</span>'}
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <style>
                .status-summary {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .status-card {
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .status-card.danger { background: #f8d7da; color: #721c24; }
                .status-card.warning { background: #fff3cd; color: #856404; }
                .status-card.info { background: #d1ecf1; color: #0c5460; }
                .status-card.success { background: #d4edda; color: #155724; }
                .status-number {
                    font-size: 2.5em;
                    font-weight: bold;
                }
                .status-label {
                    font-size: 0.9em;
                    margin-top: 10px;
                }
                .badge {
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    font-weight: bold;
                }
                .badge-danger { background: #dc3545; color: white; }
                .badge-warning { background: #ffc107; color: #000; }
                .badge-info { background: #17a2b8; color: white; }
                .badge-success { background: #28a745; color: white; }
                .status-card.attention { background: #fff3cd; color: #856404; }
                .status-card.neutral { background: #e9ecef; color: #495057; }
                .alert-box {
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                }
                .alert-box.danger { background: #f8d7da; border-left: 4px solid #dc3545; }
                .alert-box.warning { background: #fff3cd; border-left: 4px solid #ffc107; }
                .alert-box h3 { margin-top: 0; }
                .secret-list {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                .secret-list li {
                    margin: 8px 0;
                }
                .filter-controls {
                    margin: 20px 0;
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .filter-btn {
                    padding: 8px 16px;
                    border: 2px solid #007bff;
                    background: white;
                    color: #007bff;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 500;
                }
                .filter-btn:hover {
                    background: #e7f3ff;
                }
                .filter-btn.active {
                    background: #007bff;
                    color: white;
                }
                tr.danger { background: #fff5f5; }
                tr.warning { background: #fffbf0; }
                tr.info { background: #f0f9ff; }
                tr.needs-attention { border-left: 4px solid #ffc107; }
                .recommendation {
                    font-size: 0.9em;
                    color: #856404;
                    font-weight: 500;
                }
                .text-muted {
                    color: #6c757d;
                    font-style: italic;
                }
                small {
                    font-size: 0.85em;
                    color: #6c757d;
                }
            </style>
            <script>
                function filterSecrets(category) {
                    const rows = document.querySelectorAll('#secrets-table tbody tr');
                    const buttons = document.querySelectorAll('.filter-btn');
                    
                    buttons.forEach(btn => btn.classList.remove('active'));
                    event.target.classList.add('active');
                    
                    rows.forEach(row => {
                        if (category === 'all' || row.dataset.category === category || 
                            (category === 'expiring' && row.dataset.category === 'expiring') ||
                            (category === 'no-expiration' && row.dataset.category === 'no-expiration') ||
                            (category === 'needs-attention' && row.classList.contains('needs-attention'))) {
                            row.style.display = '';
                        } else {
                            row.style.display = 'none';
                        }
                    });
                }
            </script>
        </div>
        `;
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        if (pathname === '/api/expiration') {
            const expirationData = await this.checkSecretExpiration();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                secrets: expirationData,
                lastCheck: new Date(this.lastExpirationCheck).toISOString()
            }));
            return;
        }

        // Default HTML response
        const expirationData = await this.checkSecretExpiration();
        const baseHTML = this.getHTML({});
        const expirationHTML = this.getHTMLWithExpirationData(expirationData);
        
        // Replace the entire secrets container with our custom expiration dashboard
        let fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>\s*<div id="error-container">/, 
            expirationHTML + '\n        <div id="error-container">');
        
        if (fullHTML === baseHTML) {
            // Fallback pattern if the first one doesn't match
            fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>/, expirationHTML);
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }
}

const app = new ExpirationMonitorWebapp({
    appName: 'Hello World - Secret Expiration Monitor',
    method: 'Secret Expiration Monitor',
    secretStrategy: 'azure-api'
});

app.start();


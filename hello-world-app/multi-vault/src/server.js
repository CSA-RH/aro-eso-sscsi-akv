const http = require('http');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('./webapp-framework');

class MultiVaultWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.vaults = [];
        this.vaultClients = {};
        this.vaultMetadata = {};
        this.initializeMultiVault();
    }

    initializeMultiVault() {
        const tenantId = process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;

        if (!tenantId || !clientId || !clientSecret) {
            console.error('Missing required Azure credentials for multi-vault access');
            return;
        }

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

        // Parse vault configuration from environment
        // Format: VAULT_CONFIG=name1:url1,name2:url2
        // Note: URLs may contain colons (https://), so we split on the first colon only
        const vaultConfig = process.env.VAULT_CONFIG || process.env.KEYVAULT_URL;
        
        if (vaultConfig) {
            if (vaultConfig.includes(',')) {
                // Multiple vaults - split by comma first
                vaultConfig.split(',').forEach(vaultEntry => {
                    const trimmed = vaultEntry.trim();
                    // Find the first colon that's not part of https:// or http://
                    // Look for pattern: name:http... or name:https...
                    let colonIndex = -1;
                    for (let i = 0; i < trimmed.length; i++) {
                        if (trimmed[i] === ':' && i > 0) {
                            // Check if what comes after is http:// or https://
                            const afterColon = trimmed.substring(i + 1);
                            if (afterColon.startsWith('http://') || afterColon.startsWith('https://')) {
                                colonIndex = i;
                                break;
                            }
                        }
                    }
                    
                    if (colonIndex > 0) {
                        const name = trimmed.substring(0, colonIndex).trim();
                        const url = trimmed.substring(colonIndex + 1).trim();
                        if (name && url && !this.vaultClients[name]) {
                            this.vaults.push({ name: name, url: url });
                            this.vaultClients[name] = new SecretClient(url, credential);
                            this.vaultMetadata[name] = {
                                url: url,
                                name: name,
                                initialized: true
                            };
                        }
                    } else {
                        // No colon or malformed - treat entire entry as URL with auto-generated name
                        const name = `vault-${this.vaults.length + 1}`;
                        if (trimmed && !this.vaults.find(v => v.url === trimmed)) {
                            this.vaults.push({ name: name, url: trimmed });
                            this.vaultClients[name] = new SecretClient(trimmed, credential);
                            this.vaultMetadata[name] = {
                                url: trimmed,
                                name: name,
                                initialized: true
                            };
                        }
                    }
                });
            } else {
                // Single vault entry - check if it has a name prefix
                const colonIndex = vaultConfig.indexOf(':');
                if (colonIndex > 0 && vaultConfig.substring(0, colonIndex).includes('http')) {
                    // It's just a URL without name prefix
                    const vaultName = 'primary';
                    const vaultUrl = vaultConfig.trim();
                    this.vaults.push({ name: vaultName, url: vaultUrl });
                    this.vaultClients[vaultName] = new SecretClient(vaultUrl, credential);
                    this.vaultMetadata[vaultName] = {
                        url: vaultUrl,
                        name: vaultName,
                        initialized: true
                    };
                } else if (colonIndex > 0) {
                    // Has name:url format
                    const name = vaultConfig.substring(0, colonIndex).trim();
                    const url = vaultConfig.substring(colonIndex + 1).trim();
                    this.vaults.push({ name: name, url: url });
                    this.vaultClients[name] = new SecretClient(url, credential);
                    this.vaultMetadata[name] = {
                        url: url,
                        name: name,
                        initialized: true
                    };
                } else {
                    // Just a URL
                    const vaultName = 'primary';
                    const vaultUrl = vaultConfig.trim();
                    this.vaults.push({ name: vaultName, url: vaultUrl });
                    this.vaultClients[vaultName] = new SecretClient(vaultUrl, credential);
                    this.vaultMetadata[vaultName] = {
                        url: vaultUrl,
                        name: vaultName,
                        initialized: true
                    };
                }
            }

            // Also add KEYVAULT_URL as 'default' if specified and not already added
            const defaultUrl = process.env.KEYVAULT_URL;
            if (defaultUrl) {
                const defaultTrimmed = defaultUrl.trim();
                const alreadyExists = this.vaults.find(v => v.url === defaultTrimmed);
                if (!alreadyExists) {
                    this.vaults.push({ name: 'default', url: defaultTrimmed });
                    this.vaultClients['default'] = new SecretClient(defaultTrimmed, credential);
                    this.vaultMetadata['default'] = {
                        url: defaultTrimmed,
                        name: 'default',
                        initialized: true
                    };
                }
            }
        }

        console.log(`Initialized ${this.vaults.length} vault connection(s):`, 
            this.vaults.map(v => v.name).join(', '));
    }

    async getSecretFromVault(vaultName, secretName) {
        const client = this.vaultClients[vaultName];
        if (!client) {
            return { error: `Vault '${vaultName}' not found` };
        }

        try {
            const secret = await client.getSecret(secretName);
            return {
                vault: vaultName,
                secretName,
                value: secret.value,
                version: secret.properties.version,
                found: true
            };
        } catch (error) {
            return {
                vault: vaultName,
                secretName,
                error: error.message,
                found: false
            };
        }
    }

    async getSecretFromAllVaults(secretName) {
        const results = {};

        for (const vault of this.vaults) {
            const result = await this.getSecretFromVault(vault.name, secretName);
            results[vault.name] = result;
        }

        return results;
    }

    async getSecretFromPrimaryVault(secretName) {
        // Try vaults in order until one succeeds
        for (const vault of this.vaults) {
            const result = await this.getSecretFromVault(vault.name, secretName);
            if (result.found) {
                return result;
            }
        }

        return { error: `Secret '${secretName}' not found in any vault` };
    }

    getVaultInfo() {
        return {
            vaultCount: this.vaults.length,
            vaults: this.vaults.map(v => ({
                name: v.name,
                url: v.url,
                initialized: !!this.vaultClients[v.name]
            })),
            metadata: this.vaultMetadata
        };
    }

    async getSecrets() {
        // Override to use multi-vault strategy
        const secrets = {};
        const secretNames = ['database-password', 'api-key', 'hello-world-secret'];

        for (const secretName of secretNames) {
            try {
                const result = await this.getSecretFromPrimaryVault(secretName);
                if (result.found) {
                    // Use the secret key format expected by the framework
                    const key = secretName.replace(/-/g, '_').toLowerCase();
                    secrets[secretName] = result.value;
                    secrets[`_${secretName}_vault`] = result.vault;
                } else {
                    secrets[secretName] = 'Not found';
                }
            } catch (error) {
                secrets[secretName] = `Error: ${error.message}`;
            }
        }

        return secrets;
    }

    async handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === '/api/health' || url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy', multiVault: true }));
            return;
        }

        if (url.pathname === '/api/vaults' || url.pathname === '/api/vault-info') {
            const vaultInfo = this.getVaultInfo();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(vaultInfo));
            return;
        }

        if (url.pathname.startsWith('/api/secret/')) {
            const secretName = decodeURIComponent(url.pathname.replace('/api/secret/', ''));
            const vaultName = url.searchParams.get('vault');
            
            let result;
            if (vaultName) {
                result = await this.getSecretFromVault(vaultName, secretName);
            } else {
                result = await this.getSecretFromAllVaults(secretName);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        if (url.pathname.startsWith('/api/')) {
            const secrets = await this.getSecrets();
            const vaultInfo = this.getVaultInfo();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ secrets, vaultInfo }));
            return;
        }

        // Generate HTML with multi-vault info
        const secrets = await this.getSecrets();
        const vaultInfo = this.getVaultInfo();
        const html = this.getHTMLWithMultiVaultInfo(secrets, vaultInfo);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    getHTMLWithMultiVaultInfo(secrets, vaultInfo) {
        const baseHTML = this.getHTML();

        const vaultSection = `
            <div class="multivault-section" style="background: #ede7f6; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #673ab7;">
                <h3>🏦 Multi-Vault Access</h3>
                <div class="vault-info">
                    <p><strong>Connected Vaults:</strong> ${vaultInfo.vaultCount}</p>
                    <div style="background: white; padding: 15px; border-radius: 5px; margin: 10px 0;">
                        ${vaultInfo.vaults.map(vault => `
                            <div style="margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 3px; border-left: 3px solid #673ab7;">
                                <strong>${vault.name}</strong><br/>
                                <code style="font-size: 0.9em;">${vault.url}</code><br/>
                                Status: ${vault.initialized ? '✅ Connected' : '❌ Not initialized'}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <h4 style="margin-top: 20px;">Secrets by Vault Source</h4>
                <div style="background: white; padding: 15px; border-radius: 5px; margin: 10px 0;">
                    ${Object.keys(secrets).filter(k => !k.startsWith('_') && secrets[k] !== 'Not found' && !secrets[k].startsWith('Error:')).map(secretName => {
                        const vaultSource = secrets[`_${secretName}_vault`] || 'unknown';
                        return `
                            <div style="margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 3px;">
                                <strong>${secretName}:</strong> Loaded from <code>${vaultSource}</code> vault
                            </div>
                        `;
                    }).join('')}
                </div>

                <div style="margin-top: 15px;">
                    <button onclick="fetch('/api/vaults').then(r=>r.json()).then(d=>alert('Vaults: ' + d.vaultCount))" 
                            style="padding: 10px 20px; background: #673ab7; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        🔄 Refresh Vault Info
                    </button>
                </div>

                <p style="margin-top: 15px; font-size: 0.9em; color: #666;">
                    This webapp demonstrates accessing secrets from multiple Azure Key Vaults. 
                    Secrets are retrieved from vaults in priority order, with automatic fallback 
                    if a secret is not found in the primary vault. This pattern is useful for 
                    multi-environment scenarios (dev/staging/prod) or disaster recovery.
                </p>
            </div>
        `;

        return baseHTML.replace('</body>', vaultSection + '</body>');
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
            console.log(`================================`);
            console.log(`${this.APP_NAME} running on port ${this.PORT}`);
            console.log(`Method: ${this.METHOD}`);
            console.log(`Connected Vaults: ${this.vaults.length}`);
            this.vaults.forEach(v => console.log(`  - ${v.name}: ${v.url}`));
            console.log(`================================`);
        });
    }
}

const app = new MultiVaultWebapp({
    appName: 'Hello World - Multi-Vault',
    method: 'Multi-Vault Access',
    operator: '',
    keyvaultUrl: process.env.KEYVAULT_URL || '',
    secretStrategy: 'azure-api'
});

app.start();


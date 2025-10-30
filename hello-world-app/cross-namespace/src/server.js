const http = require('http');
const fs = require('fs');
const url = require('url');
const HelloWorldWebapp = require('../../shared/webapp-framework');

class CrossNamespaceWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.currentNamespace = process.env.NAMESPACE || 'unknown';
        this.sharedNamespaces = process.env.SHARED_NAMESPACES ? 
            process.env.SHARED_NAMESPACES.split(',') : [];
        this.sharedSecrets = {};
        this.loadSharedSecrets();
    }

    loadSharedSecrets() {
        // In a real scenario, these would be loaded from other namespaces
        // For demo, we simulate cross-namespace access by checking environment variables
        // that would be populated from secrets in other namespaces
        
        // Simulate shared secrets from different namespaces
        const sharedSecretsEnv = process.env.SHARED_SECRETS_CONFIG || '{}';
        try {
            const config = JSON.parse(sharedSecretsEnv);
            this.sharedSecrets = config;
        } catch (error) {
            // Fallback: check common environment variables
            this.sharedSecrets = {
                'shared-db-password': {
                    namespace: 'shared-services',
                    secretName: 'database-credentials',
                    key: 'password',
                    accessible: !!process.env.SHARED_DB_PASSWORD,
                    value: process.env.SHARED_DB_PASSWORD || 'Not accessible from this namespace'
                },
                'shared-api-key': {
                    namespace: 'shared-services',
                    secretName: 'api-credentials',
                    key: 'key',
                    accessible: !!process.env.SHARED_API_KEY,
                    value: process.env.SHARED_API_KEY || 'Not accessible from this namespace'
                }
            };
        }
    }

    getLocalSecrets() {
        const localSecrets = {};
        const mountPath = this.SECRETS_MOUNT_PATH || '/etc/secrets';
        
        try {
            if (fs.existsSync(mountPath)) {
                const files = fs.readdirSync(mountPath);
                files.forEach(file => {
                    const filePath = `${mountPath}/${file}`;
                    if (fs.statSync(filePath).isFile()) {
                        try {
                            localSecrets[file] = fs.readFileSync(filePath, 'utf8');
                        } catch (error) {
                            console.error(`Error reading ${file}:`, error.message);
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error reading local secrets:', error.message);
        }

        return localSecrets;
    }

    getHTMLWithCrossNamespaceInfo(localSecrets) {
        return `
        <div class="container">
            <h2>Cross-Namespace Secret Sharing</h2>
            
            <div class="namespace-info">
                <div class="info-card">
                    <h3>Current Namespace</h3>
                    <div class="namespace-name">${this.currentNamespace}</div>
                </div>
                <div class="info-card">
                    <h3>Shared Namespaces</h3>
                    <div class="namespace-list">
                        ${this.sharedNamespaces.length > 0 
                            ? this.sharedNamespaces.map(ns => `<span class="badge">${ns}</span>`).join('')
                            : '<em>None configured</em>'}
                    </div>
                </div>
            </div>

            <div class="secrets-section">
                <h3>Local Secrets (from ${this.currentNamespace})</h3>
                <div class="secrets-grid">
                    ${Object.entries(localSecrets).map(([name, value]) => `
                    <div class="secret-card local">
                        <div class="secret-header">
                            <strong>${name}</strong>
                            <span class="badge badge-primary">Local</span>
                        </div>
                        <div class="secret-content">
                            <div class="secret-meta">
                                <span>Namespace: ${this.currentNamespace}</span>
                            </div>
                            <div class="secret-value">
                                Value: ${this.maskSecret(value)}
                            </div>
                        </div>
                    </div>
                    `).join('')}
                </div>
            </div>

            <div class="secrets-section">
                <h3>Shared Secrets (from other namespaces)</h3>
                <div class="secrets-grid">
                    ${Object.entries(this.sharedSecrets).map(([key, secret]) => `
                    <div class="secret-card ${secret.accessible ? 'shared' : 'unavailable'}">
                        <div class="secret-header">
                            <strong>${key}</strong>
                            <span class="badge ${secret.accessible ? 'badge-success' : 'badge-warning'}">
                                ${secret.accessible ? 'Shared' : 'Not Accessible'}
                            </span>
                        </div>
                        <div class="secret-content">
                            <div class="secret-meta">
                                <span>Source Namespace: ${secret.namespace}</span><br>
                                <span>Secret: ${secret.secretName} (${secret.key})</span>
                            </div>
                            <div class="secret-value">
                                ${secret.accessible 
                                    ? `Value: ${this.maskSecret(secret.value)}`
                                    : '<em>Secret not accessible from this namespace (RBAC or secret not shared)</em>'}
                            </div>
                        </div>
                    </div>
                    `).join('')}
                </div>
            </div>

            <div class="info-box">
                <h4>How Cross-Namespace Secret Sharing Works:</h4>
                <ul>
                    <li><strong>Local Secrets:</strong> Available only in the current namespace (${this.currentNamespace})</li>
                    <li><strong>Shared Secrets:</strong> Created in one namespace and referenced in others via <code>secretKeyRef</code></li>
                    <li><strong>RBAC:</strong> Service accounts need appropriate permissions to access secrets across namespaces</li>
                    <li><strong>Best Practice:</strong> Create shared secrets in a dedicated namespace (e.g., 'shared-services')</li>
                    <li><strong>Security:</strong> Only share secrets that need to be accessed by multiple namespaces</li>
                </ul>
            </div>
            
            <style>
                .namespace-info {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .info-card {
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .namespace-name {
                    font-size: 1.5em;
                    font-weight: bold;
                    color: #007bff;
                    margin-top: 10px;
                }
                .namespace-list {
                    margin-top: 10px;
                }
                .secrets-section {
                    margin: 30px 0;
                }
                .secrets-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .secret-card {
                    padding: 15px;
                    border-radius: 8px;
                    border-left: 4px solid;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .secret-card.local {
                    background: #e7f3ff;
                    border-color: #007bff;
                }
                .secret-card.shared {
                    background: #d4edda;
                    border-color: #28a745;
                }
                .secret-card.unavailable {
                    background: #fff3cd;
                    border-color: #ffc107;
                }
                .secret-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .secret-meta {
                    font-size: 0.9em;
                    color: #6c757d;
                    margin-bottom: 10px;
                }
                .secret-value {
                    font-family: monospace;
                    word-break: break-all;
                }
                .info-box {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 30px 0;
                }
                .info-box ul {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                .info-box li {
                    margin: 8px 0;
                }
            </style>
        </div>
        `;
    }

    maskSecret(value) {
        if (!value) return 'N/A';
        if (value.length <= 4) return '****';
        return value.substring(0, 2) + '****' + value.substring(value.length - 2);
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        if (pathname === '/api/local-secrets') {
            const localSecrets = this.getLocalSecrets();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(localSecrets));
            return;
        }

        if (pathname === '/api/shared-secrets') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                currentNamespace: this.currentNamespace,
                sharedNamespaces: this.sharedNamespaces,
                sharedSecrets: this.sharedSecrets
            }));
            return;
        }

        // Default HTML response
        const localSecrets = this.getLocalSecrets();
        const baseHTML = this.getHTML(localSecrets);
        const crossNamespaceHTML = this.getHTMLWithCrossNamespaceInfo(localSecrets);
        // Inject custom HTML after the method details section
        const fullHTML = baseHTML.replace(/<\/div>\s*<div id="secrets-container">/, 
            '</div>\n        ' + crossNamespaceHTML + '\n        <div id="secrets-container">');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }
}

const app = new CrossNamespaceWebapp({
    appName: 'Hello World - Cross-Namespace Secret Sharing',
    method: 'Cross-Namespace Secret Sharing',
    secretStrategy: 'csi',
    secretsMountPath: process.env.SECRETS_MOUNT_PATH || '/etc/secrets'
});

app.start();


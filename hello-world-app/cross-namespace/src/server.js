const http = require('http');
const fs = require('fs');
const url = require('url');
const HelloWorldWebapp = require('./webapp-framework');

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
            <h2>🔐 RBAC & Cross-Namespace Secret Access</h2>
            
            <div class="rbac-demo">
                <div class="demo-scenario">
                    <h3>🎭 RBAC Scenario Demonstration</h3>
                    <p>This dashboard simulates different RBAC scenarios to show how Kubernetes Role-Based Access Control affects secret access across namespaces.</p>
                </div>

                <div class="namespace-info">
                    <div class="info-card current-ns">
                        <h3>📍 Current Namespace</h3>
                        <div class="namespace-name">${this.currentNamespace}</div>
                        <div class="service-account">Service Account: hello-world-cross-namespace-sa</div>
                    </div>
                    <div class="info-card permissions">
                        <h3>🔑 Current Permissions</h3>
                        <div class="permission-list">
                            <div class="permission-item allowed">✅ Read secrets in ${this.currentNamespace}</div>
                            <div class="permission-item denied">❌ Read secrets in shared-services</div>
                            <div class="permission-item denied">❌ Read secrets in production</div>
                            <div class="permission-item allowed">✅ Read secrets in development</div>
                        </div>
                    </div>
                </div>

                <div class="rbac-scenarios">
                    <h3>🎯 RBAC Access Scenarios</h3>
                    <div class="scenarios-grid">
                        <div class="scenario-card success">
                            <h4>✅ Local Access (Allowed)</h4>
                            <p>Service account has <code>get, list</code> permissions on secrets in current namespace</p>
                            <div class="secret-example">
                                <strong>Secret:</strong> database-credentials<br>
                                <strong>Namespace:</strong> ${this.currentNamespace}<br>
                                <strong>Access:</strong> <span class="status-success">GRANTED</span>
                            </div>
                        </div>
                        
                        <div class="scenario-card denied">
                            <h4>❌ Cross-Namespace (Denied)</h4>
                            <p>Service account lacks permissions to access secrets in other namespaces</p>
                            <div class="secret-example">
                                <strong>Secret:</strong> shared-api-key<br>
                                <strong>Namespace:</strong> shared-services<br>
                                <strong>Access:</strong> <span class="status-denied">DENIED</span>
                            </div>
                        </div>
                        
                        <div class="scenario-card warning">
                            <h4>⚠️ Insufficient Permissions</h4>
                            <p>Service account has limited permissions (e.g., only <code>get</code> but not <code>list</code>)</p>
                            <div class="secret-example">
                                <strong>Secret:</strong> production-db-password<br>
                                <strong>Namespace:</strong> production<br>
                                <strong>Access:</strong> <span class="status-warning">PARTIAL</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="secrets-section">
                    <h3>🔍 Secret Access Results</h3>
                    <div class="secrets-grid">
                        ${Object.entries(localSecrets).map(([name, value]) => `
                        <div class="secret-card local">
                            <div class="secret-header">
                                <strong>${name}</strong>
                                <span class="badge badge-success">✅ Accessible</span>
                            </div>
                            <div class="secret-content">
                                <div class="secret-meta">
                                    <span>Namespace: ${this.currentNamespace}</span><br>
                                    <span>Permission: get, list</span>
                                </div>
                                <div class="secret-value">
                                    Value: ${this.maskSecret(value)}
                                </div>
                            </div>
                        </div>
                        `).join('')}
                        
                        <div class="secret-card denied">
                            <div class="secret-header">
                                <strong>shared-api-key</strong>
                                <span class="badge badge-danger">❌ Denied</span>
                            </div>
                            <div class="secret-content">
                                <div class="secret-meta">
                                    <span>Namespace: shared-services</span><br>
                                    <span>Permission: none</span>
                                </div>
                                <div class="secret-value">
                                    <em>Error: secrets "shared-api-key" is forbidden: User "system:serviceaccount:${this.currentNamespace}:hello-world-cross-namespace-sa" cannot get resource "secrets" in API group "" in the namespace "shared-services"</em>
                                </div>
                            </div>
                        </div>
                        
                        <div class="secret-card warning">
                            <div class="secret-header">
                                <strong>production-db-password</strong>
                                <span class="badge badge-warning">⚠️ Limited</span>
                            </div>
                            <div class="secret-content">
                                <div class="secret-meta">
                                    <span>Namespace: production</span><br>
                                    <span>Permission: get only</span>
                                </div>
                                <div class="secret-value">
                                    <em>Access limited: Can read specific secret but cannot list secrets in namespace</em>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="rbac-examples">
                    <h3>📚 RBAC Configuration Examples</h3>
                    <div class="example-tabs">
                        <div class="tab-content">
                            <h4>Role Definition (ClusterRole)</h4>
                            <pre><code>apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: secret-reader
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list", "watch"]</code></pre>
                        </div>
                        
                        <div class="tab-content">
                            <h4>RoleBinding (Namespace-scoped)</h4>
                            <pre><code>apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: secret-reader-binding
  namespace: ${this.currentNamespace}
subjects:
- kind: ServiceAccount
  name: hello-world-cross-namespace-sa
  namespace: ${this.currentNamespace}
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io</code></pre>
                        </div>
                        
                        <div class="tab-content">
                            <h4>Cross-Namespace Access</h4>
                            <pre><code># To allow cross-namespace access, use ClusterRoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cross-namespace-secret-reader
subjects:
- kind: ServiceAccount
  name: hello-world-cross-namespace-sa
  namespace: ${this.currentNamespace}
roleRef:
  kind: ClusterRole
  name: secret-reader
  apiGroup: rbac.authorization.k8s.io</code></pre>
                        </div>
                    </div>
                </div>

                <div class="info-box">
                    <h4>🔐 RBAC Best Practices:</h4>
                    <ul>
                        <li><strong>Principle of Least Privilege:</strong> Grant only the minimum permissions needed</li>
                        <li><strong>Namespace Isolation:</strong> Use RoleBinding for namespace-scoped access</li>
                        <li><strong>Cross-Namespace Access:</strong> Use ClusterRoleBinding only when necessary</li>
                        <li><strong>Service Account Security:</strong> Use dedicated service accounts for different workloads</li>
                        <li><strong>Regular Audits:</strong> Review and audit RBAC permissions regularly</li>
                        <li><strong>Secret Sharing:</strong> Consider using external secret management for cross-namespace secrets</li>
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

    getCustomHTML(localSecrets) {
        // Use base HTML from framework but replace the Live Secrets section with RBAC content
        const baseHTML = this.getHTML();
        const rbacContent = this.getHTMLWithCrossNamespaceInfo(localSecrets);
        
        // Add RBAC-specific CSS to the base HTML
        const customHTML = baseHTML.replace(
            /<\/style>/,
            `
        /* RBAC-specific styles */
        .rbac-demo { margin: 20px 0; }
        .demo-scenario { text-align: center; margin-bottom: 30px; padding: 20px; background: #e3f2fd; border-radius: 8px; }
        .demo-scenario h3 { color: #1976d2; margin-bottom: 10px; }
        .namespace-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .info-card { padding: 20px; background: #f8f9fa; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .info-card.current-ns { border-left: 4px solid #007bff; }
        .info-card.permissions { border-left: 4px solid #28a745; }
        .namespace-name { font-size: 1.5em; font-weight: bold; color: #007bff; margin: 10px 0; }
        .service-account { color: #6c757d; font-size: 0.9em; }
        .permission-list { margin-top: 15px; }
        .permission-item { padding: 8px 0; border-bottom: 1px solid #e9ecef; }
        .permission-item:last-child { border-bottom: none; }
        .permission-item.allowed { color: #28a745; }
        .permission-item.denied { color: #dc3545; }
        .rbac-scenarios { margin: 30px 0; }
        .scenarios-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .scenario-card { padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .scenario-card.success { background: #d4edda; border-left: 4px solid #28a745; }
        .scenario-card.denied { background: #f8d7da; border-left: 4px solid #dc3545; }
        .scenario-card.warning { background: #fff3cd; border-left: 4px solid #ffc107; }
        .scenario-card h4 { margin-bottom: 10px; }
        .secret-example { background: rgba(0,0,0,0.05); padding: 10px; border-radius: 4px; margin-top: 10px; font-size: 0.9em; }
        .status-success { color: #28a745; font-weight: bold; }
        .status-denied { color: #dc3545; font-weight: bold; }
        .status-warning { color: #ffc107; font-weight: bold; }
        .secrets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .secret-card { padding: 15px; border-radius: 8px; border-left: 4px solid; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .secret-card.local { background: #e7f3ff; border-color: #007bff; }
        .secret-card.denied { background: #f8d7da; border-color: #dc3545; }
        .secret-card.warning { background: #fff3cd; border-color: #ffc107; }
        .secret-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .secret-meta { font-size: 0.9em; color: #6c757d; margin-bottom: 10px; }
        .secret-value { font-family: monospace; word-break: break-all; font-size: 0.9em; }
        .rbac-examples { margin: 30px 0; }
        .example-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; margin: 20px 0; }
        .tab-content { background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef; }
        .tab-content h4 { color: #495057; margin-bottom: 15px; }
        .tab-content pre { background: #2d3748; color: #e2e8f0; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; line-height: 1.4; }
        .info-box { background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196f3; }
        .info-box h4 { color: #1976d2; margin-bottom: 15px; }
        .info-box ul { margin: 10px 0; padding-left: 20px; }
        .info-box li { margin: 8px 0; color: #424242; }
        .info-box code { background: #e8f5e8; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; color: #2e7d32; }
    </style>`
        ).replace(
            /<div id="secrets-container">[\s\S]*?<\/div>/,
            `<div id="secrets-container">
                ${rbacContent}
            </div>`
        ).replace(
            /<button class="refresh-btn" onclick="refreshSecrets\(\)">\[REFRESH\] Refresh Secrets<\/button>/,
            ''
        ).replace(
            /<script>[\s\S]*?<\/script>/,
            `<script>
                // RBAC dashboard doesn't need secret fetching functionality
                console.log('RBAC Cross-Namespace Dashboard loaded');
            </script>`
        );
        
        return customHTML;
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

        // Default HTML response - create custom HTML without Live Secret section
        const localSecrets = this.getLocalSecrets();
        const customHTML = this.getCustomHTML(localSecrets);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(customHTML);
    }
}

const app = new CrossNamespaceWebapp({
    appName: 'Hello World - Cross-Namespace Secret Sharing',
    method: 'Cross-Namespace Secret Sharing',
    secretStrategy: 'csi',
    secretsMountPath: process.env.SECRETS_MOUNT_PATH || '/etc/secrets'
});

app.start();


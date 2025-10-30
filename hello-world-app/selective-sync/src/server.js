const http = require('http');
const fs = require('fs');
const url = require('url');
const HelloWorldWebapp = require('../../shared/webapp-framework');

class SelectiveSyncWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.mountPath = process.env.SECRETS_MOUNT_PATH || '/etc/secrets';
        this.syncedSecrets = {};
        this.secretFilters = {
            include: process.env.SECRET_FILTER_INCLUDE ? process.env.SECRET_FILTER_INCLUDE.split(',') : [],
            exclude: process.env.SECRET_FILTER_EXCLUDE ? process.env.SECRET_FILTER_EXCLUDE.split(',') : [],
            prefix: process.env.SECRET_FILTER_PREFIX || '',
            suffix: process.env.SECRET_FILTER_SUFFIX || ''
        };
    }

    matchesFilter(secretName) {
        // Include list takes precedence
        if (this.secretFilters.include.length > 0) {
            return this.secretFilters.include.some(pattern => {
                if (pattern.includes('*')) {
                    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                    return regex.test(secretName);
                }
                return secretName === pattern || secretName.includes(pattern);
            });
        }

        // Exclude list
        if (this.secretFilters.exclude.length > 0) {
            const excluded = this.secretFilters.exclude.some(pattern => {
                if (pattern.includes('*')) {
                    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                    return regex.test(secretName);
                }
                return secretName === pattern || secretName.includes(pattern);
            });
            if (excluded) return false;
        }

        // Prefix filter
        if (this.secretFilters.prefix && !secretName.startsWith(this.secretFilters.prefix)) {
            return false;
        }

        // Suffix filter
        if (this.secretFilters.suffix && !secretName.endsWith(this.secretFilters.suffix)) {
            return false;
        }

        return true;
    }

    getAllAvailableSecrets() {
        const allSecrets = [];
        const filteredSecrets = [];

        try {
            if (fs.existsSync(this.mountPath)) {
                const files = fs.readdirSync(this.mountPath);
                files.forEach(file => {
                    const filePath = `${this.mountPath}/${file}`;
                    if (fs.statSync(filePath).isFile()) {
                        const secretName = file;
                        allSecrets.push(secretName);
                        
                        if (this.matchesFilter(secretName)) {
                            filteredSecrets.push(secretName);
                            try {
                                this.syncedSecrets[secretName] = fs.readFileSync(filePath, 'utf8');
                            } catch (error) {
                                console.error(`Error reading ${secretName}:`, error.message);
                            }
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error reading secrets directory:', error.message);
        }

        return {
            all: allSecrets,
            filtered: filteredSecrets,
            synced: Object.keys(this.syncedSecrets)
        };
    }

    getHTMLWithSelectiveSyncInfo(secretInfo) {
        return `
        <div class="container">
            <h2>Selective Secret Sync</h2>
            
            <div class="filter-info">
                <h3>Active Filters</h3>
                <div class="filter-list">
                    <div class="filter-item">
                        <strong>Include:</strong> 
                        ${this.secretFilters.include.length > 0 
                            ? this.secretFilters.include.join(', ') 
                            : '<em>None (all included)</em>'}
                    </div>
                    <div class="filter-item">
                        <strong>Exclude:</strong> 
                        ${this.secretFilters.exclude.length > 0 
                            ? this.secretFilters.exclude.join(', ') 
                            : '<em>None</em>'}
                    </div>
                    <div class="filter-item">
                        <strong>Prefix:</strong> 
                        ${this.secretFilters.prefix || '<em>None</em>'}
                    </div>
                    <div class="filter-item">
                        <strong>Suffix:</strong> 
                        ${this.secretFilters.suffix || '<em>None</em>'}
                    </div>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${secretInfo.all.length}</div>
                    <div class="stat-label">Total Secrets Available</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${secretInfo.filtered.length}</div>
                    <div class="stat-label">Secrets Matching Filter</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${secretInfo.synced.length}</div>
                    <div class="stat-label">Successfully Synced</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${secretInfo.all.length - secretInfo.filtered.length}</div>
                    <div class="stat-label">Filtered Out</div>
                </div>
            </div>

            <h3>All Available Secrets</h3>
            <table class="secrets-table">
                <thead>
                    <tr>
                        <th>Secret Name</th>
                        <th>Status</th>
                        <th>Filter Match</th>
                    </tr>
                </thead>
                <tbody>
                    ${secretInfo.all.map(secretName => {
                        const isFiltered = this.matchesFilter(secretName);
                        const isSynced = secretInfo.synced.includes(secretName);
                        return `
                    <tr class="${isSynced ? 'success' : isFiltered ? 'warning' : 'filtered'}">
                        <td><strong>${secretName}</strong></td>
                        <td>
                            ${isSynced 
                                ? '<span class="badge badge-success">Synced</span>'
                                : '<span class="badge badge-secondary">Not Synced</span>'}
                        </td>
                        <td>
                            ${isFiltered 
                                ? '<span class="badge badge-info">Matches Filter</span>'
                                : '<span class="badge badge-warning">Filtered Out</span>'}
                        </td>
                    </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>

            <h3>Synced Secrets</h3>
            <div class="secrets-list">
                ${secretInfo.synced.map(secretName => `
                <div class="secret-item">
                    <div class="secret-header">
                        <strong>${secretName}</strong>
                        <span class="badge badge-success">Synced</span>
                    </div>
                    <div class="secret-content">
                        ${this.syncedSecrets[secretName] 
                            ? `Value: ${this.maskSecret(this.syncedSecrets[secretName])}`
                            : '<em>Unable to read value</em>'}
                    </div>
                </div>
                `).join('')}
            </div>
            
            <style>
                .filter-info {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                }
                .filter-list {
                    display: grid;
                    gap: 10px;
                }
                .filter-item {
                    padding: 10px;
                    background: white;
                    border-radius: 4px;
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
                .stat-value {
                    font-size: 2.5em;
                    font-weight: bold;
                    color: #007bff;
                }
                .stat-label {
                    margin-top: 10px;
                    color: #6c757d;
                }
                tr.filtered { background: #f8f9fa; opacity: 0.6; }
                tr.warning { background: #fff3cd; }
                tr.success { background: #d4edda; }
                .secrets-list {
                    display: grid;
                    gap: 15px;
                    margin: 20px 0;
                }
                .secret-item {
                    padding: 15px;
                    background: #f8f9fa;
                    border-radius: 8px;
                    border-left: 4px solid #007bff;
                }
                .secret-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .secret-content {
                    font-family: monospace;
                    color: #6c757d;
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

        if (pathname === '/api/filters') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.secretFilters));
            return;
        }

        if (pathname === '/api/secrets') {
            const secretInfo = this.getAllAvailableSecrets();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(secretInfo));
            return;
        }

        // Default HTML response
        const secretInfo = this.getAllAvailableSecrets();
        const secrets = Object.fromEntries(
            secretInfo.synced.map(name => [name, this.syncedSecrets[name]])
        );
        const baseHTML = this.getHTML(secrets);
        const selectiveHTML = this.getHTMLWithSelectiveSyncInfo(secretInfo);
        // Inject custom HTML after the method details section
        const fullHTML = baseHTML.replace(/<\/div>\s*<div id="secrets-container">/, 
            '</div>\n        ' + selectiveHTML + '\n        <div id="secrets-container">');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }
}

const app = new SelectiveSyncWebapp({
    appName: 'Hello World - Selective Secret Sync',
    method: 'Selective Secret Sync',
    secretStrategy: 'csi',
    secretsMountPath: process.env.SECRETS_MOUNT_PATH || '/etc/secrets'
});

app.start();


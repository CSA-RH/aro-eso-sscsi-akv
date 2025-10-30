const http = require('http');
const url = require('url');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('./webapp-framework');

class AuditDashboardWebapp extends HelloWorldWebapp {
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
        
        this.accessLog = [];
        this.maxLogEntries = 1000;
        this.accessStats = {};
        this.startTime = Date.now();
        
        // Track secret access
        this.originalGetSecret = this.getSecretFromKeyVault;
        this.getSecretFromKeyVault = this.trackSecretAccess.bind(this);
        
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
            console.error('Missing required Azure credentials for audit dashboard');
            return;
        }

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        this.keyVaultClient = new SecretClient(keyVaultUrl, credential);
    }

    async trackSecretAccess(secretName) {
        const timestamp = new Date();
        const logEntry = {
            timestamp: timestamp.toISOString(),
            secretName: secretName,
            action: 'READ',
            source: 'webapp'
        };

        // Add to log
        this.accessLog.unshift(logEntry);
        if (this.accessLog.length > this.maxLogEntries) {
            this.accessLog.pop();
        }

        // Update stats
        if (!this.accessStats[secretName]) {
            this.accessStats[secretName] = {
                name: secretName,
                accessCount: 0,
                firstAccess: timestamp,
                lastAccess: timestamp
            };
        }
        this.accessStats[secretName].accessCount++;
        this.accessStats[secretName].lastAccess = timestamp;

        // Call original method
        return this.originalGetSecret.call(this, secretName);
    }

    getAccessSummary() {
        const summary = {
            totalAccesses: this.accessLog.length,
            uniqueSecrets: Object.keys(this.accessStats).length,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            recentAccesses: this.accessLog.slice(0, 50),
            topSecrets: Object.values(this.accessStats)
                .sort((a, b) => b.accessCount - a.accessCount)
                .slice(0, 10),
            accessFrequency: this.calculateAccessFrequency()
        };
        return summary;
    }

    calculateAccessFrequency() {
        const now = Date.now();
        const intervals = {
            'last-minute': { start: now - 60000, count: 0 },
            'last-5-minutes': { start: now - 300000, count: 0 },
            'last-hour': { start: now - 3600000, count: 0 },
            'last-day': { start: now - 86400000, count: 0 }
        };

        this.accessLog.forEach(entry => {
            const entryTime = new Date(entry.timestamp).getTime();
            Object.keys(intervals).forEach(key => {
                if (entryTime >= intervals[key].start) {
                    intervals[key].count++;
                }
            });
        });

        // Store now for use in HTML generation
        intervals._now = now;
        return intervals;
    }

    calculateAccessTrends() {
        if (this.accessLog.length < 2) return null;
        
        const now = Date.now();
        const hourAgo = now - 3600000;
        const recentAccesses = this.accessLog.filter(e => new Date(e.timestamp).getTime() >= hourAgo);
        const olderAccesses = this.accessLog.filter(e => new Date(e.timestamp).getTime() < hourAgo);
        
        const recentRate = recentAccesses.length / 60; // accesses per minute
        const olderRate = olderAccesses.length > 0 ? olderAccesses.length / (Math.max((now - new Date(olderAccesses[0].timestamp).getTime()) / 60000, 1)) : 0;
        
        return {
            currentRate: recentRate.toFixed(2),
            previousRate: olderRate.toFixed(2),
            trend: recentRate > olderRate ? 'increasing' : recentRate < olderRate ? 'decreasing' : 'stable',
            recentCount: recentAccesses.length
        };
    }

    getHTMLWithAuditData(summary) {
        const trends = this.calculateAccessTrends();
        const avgAccessPerSecret = summary.uniqueSecrets > 0 ? (summary.totalAccesses / summary.uniqueSecrets).toFixed(1) : 0;
        const mostActiveSecret = summary.topSecrets.length > 0 ? summary.topSecrets[0] : null;
        const inactiveSecrets = Object.keys(this.accessStats).filter(name => {
            const stat = this.accessStats[name];
            const daysSinceAccess = Math.floor((Date.now() - new Date(stat.lastAccess).getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceAccess > 90;
        });

        return `
        <div class="container">
            <h2>Secret Access Audit & Analytics Dashboard</h2>
            
            <div class="stats-grid">
                <div class="stat-card primary">
                    <div class="stat-value">${summary.totalAccesses}</div>
                    <div class="stat-label">Total Accesses</div>
                    ${trends ? `<div class="stat-trend ${trends.trend}">${trends.trend === 'increasing' ? '[UP]' : trends.trend === 'decreasing' ? '[DOWN]' : '[STABLE]'} ${trends.currentRate}/min</div>` : ''}
                </div>
                <div class="stat-card">
                    <div class="stat-value">${summary.uniqueSecrets}</div>
                    <div class="stat-label">Unique Secrets</div>
                    <div class="stat-subtext">${avgAccessPerSecret} avg per secret</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${this.formatUptime(summary.uptime)}</div>
                    <div class="stat-label">Uptime</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${mostActiveSecret ? mostActiveSecret.accessCount : 0}</div>
                    <div class="stat-label">Most Active Secret</div>
                    ${mostActiveSecret ? `<div class="stat-subtext">${mostActiveSecret.name}</div>` : ''}
                </div>
            </div>

            ${inactiveSecrets.length > 0 ? `
            <div class="alert-box warning">
                <h3>[!] Inactive Secrets Detected</h3>
                <p>The following secrets haven't been accessed in 90+ days and may be candidates for cleanup or review:</p>
                <ul class="secret-list">
                    ${inactiveSecrets.slice(0, 10).map(name => {
                        const stat = this.accessStats[name];
                        const daysSince = Math.floor((Date.now() - new Date(stat.lastAccess).getTime()) / (1000 * 60 * 60 * 24));
                        return `<li><strong>${name}</strong> - Last accessed ${daysSince} days ago (${stat.accessCount} total accesses)</li>`;
                    }).join('')}
                    ${inactiveSecrets.length > 10 ? `<li><em>... and ${inactiveSecrets.length - 10} more</em></li>` : ''}
                </ul>
            </div>
            ` : ''}

            <h3>Access Frequency Analysis</h3>
            <div class="frequency-bars">
                ${Object.entries(summary.accessFrequency).filter(([key]) => key !== '_now').map(([period, data]) => {
                    const maxCount = Math.max(...Object.values(summary.accessFrequency).filter((_, k) => k !== '_now').map(d => typeof d === 'object' && d.count || 0), 1);
                    const percentage = maxCount > 0 && typeof data === 'object' && data.count ? (data.count / maxCount) * 100 : 0;
                    const now = summary.accessFrequency._now || Date.now();
                    return `
                <div class="frequency-item">
                    <div class="frequency-label">${period.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                    <div class="frequency-bar-container">
                        <div class="frequency-bar" style="width: ${percentage}%"></div>
                    </div>
                    <div class="frequency-count">${typeof data === 'object' ? data.count : 0} accesses</div>
                    ${period !== 'last-day' && typeof data === 'object' && data.count > 0 ? `<div class="frequency-rate">~${(data.count / ((now - data.start) / 60000)).toFixed(1)}/min</div>` : ''}
                </div>
                `;
                }).join('')}
            </div>
            
            ${trends ? `
            <div class="insight-box">
                <h4>[*] Access Trend Analysis</h4>
                <p>Access rate is <strong>${trends.trend}</strong> compared to historical data.</p>
                <ul>
                    <li>Current rate: ${trends.currentRate} accesses/minute</li>
                    <li>Previous rate: ${trends.previousRate} accesses/minute</li>
                    <li>Recent activity: ${trends.recentCount} accesses in the last hour</li>
                </ul>
            </div>
            ` : ''}

            <h3>Most Accessed Secrets (Top 10)</h3>
            <table class="secrets-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Secret Name</th>
                        <th>Access Count</th>
                        <th>Access Frequency</th>
                        <th>First Access</th>
                        <th>Last Access</th>
                        <th>Activity</th>
                    </tr>
                </thead>
                <tbody>
                    ${summary.topSecrets.map((stat, index) => {
                        const daysSinceFirst = Math.floor((Date.now() - new Date(stat.firstAccess).getTime()) / (1000 * 60 * 60 * 24));
                        const avgPerDay = daysSinceFirst > 0 ? (stat.accessCount / daysSinceFirst).toFixed(2) : stat.accessCount.toFixed(2);
                        const hoursSinceLast = Math.floor((Date.now() - new Date(stat.lastAccess).getTime()) / (1000 * 60 * 60));
                        let activity = 'active';
                        let activityClass = 'success';
                        if (hoursSinceLast > 168) { // 7 days
                            activity = 'inactive';
                            activityClass = 'danger';
                        } else if (hoursSinceLast > 24) {
                            activity = 'recent';
                            activityClass = 'warning';
                        }
                        return `
                    <tr>
                        <td><span class="rank-badge">${index + 1}</span></td>
                        <td><strong>${stat.name}</strong></td>
                        <td><span class="badge badge-primary">${stat.accessCount}</span></td>
                        <td>${avgPerDay} per day</td>
                        <td>${new Date(stat.firstAccess).toLocaleDateString()}</td>
                        <td>${new Date(stat.lastAccess).toLocaleString()}</td>
                        <td><span class="badge badge-${activityClass}">${activity}</span></td>
                    </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>

            <h3>Recent Access Log</h3>
            <table class="secrets-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Secret Name</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${summary.recentAccesses.map(entry => `
                    <tr>
                        <td>${new Date(entry.timestamp).toLocaleString()}</td>
                        <td><strong>${entry.secretName}</strong></td>
                        <td><span class="badge badge-info">${entry.action}</span></td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <style>
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
                .stat-card.primary {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .stat-value {
                    font-size: 2.5em;
                    font-weight: bold;
                    color: #007bff;
                }
                .stat-card.primary .stat-value {
                    color: white;
                }
                .stat-label {
                    margin-top: 10px;
                    color: #6c757d;
                }
                .stat-card.primary .stat-label {
                    color: rgba(255, 255, 255, 0.9);
                }
                .stat-subtext {
                    font-size: 0.85em;
                    color: #6c757d;
                    margin-top: 5px;
                }
                .stat-card.primary .stat-subtext {
                    color: rgba(255, 255, 255, 0.8);
                }
                .stat-trend {
                    font-size: 0.9em;
                    margin-top: 8px;
                    font-weight: 500;
                }
                .stat-trend.increasing { color: #28a745; }
                .stat-trend.decreasing { color: #dc3545; }
                .stat-trend.stable { color: #6c757d; }
                .stat-card.primary .stat-trend { color: rgba(255, 255, 255, 0.9); }
                .rank-badge {
                    display: inline-block;
                    width: 30px;
                    height: 30px;
                    line-height: 30px;
                    text-align: center;
                    border-radius: 50%;
                    background: #007bff;
                    color: white;
                    font-weight: bold;
                }
                .badge-primary { background: #007bff; color: white; }
                .insight-box {
                    background: #e7f3ff;
                    border-left: 4px solid #007bff;
                    padding: 15px;
                    border-radius: 4px;
                    margin: 20px 0;
                }
                .insight-box h4 {
                    margin-top: 0;
                    color: #0056b3;
                }
                .insight-box ul {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                .alert-box {
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                    background: #fff3cd;
                    border-left: 4px solid #ffc107;
                }
                .alert-box h3 {
                    margin-top: 0;
                }
                .secret-list {
                    margin: 10px 0;
                    padding-left: 20px;
                }
                .secret-list li {
                    margin: 8px 0;
                }
                .frequency-bars {
                    margin: 20px 0;
                }
                .frequency-item {
                    display: flex;
                    align-items: center;
                    margin: 10px 0;
                    gap: 15px;
                }
                .frequency-label {
                    min-width: 150px;
                    text-transform: capitalize;
                }
                .frequency-bar-container {
                    flex: 1;
                    height: 20px;
                    background: #e9ecef;
                    border-radius: 10px;
                    overflow: hidden;
                }
                .frequency-bar {
                    height: 100%;
                    background: linear-gradient(90deg, #007bff, #0056b3);
                    transition: width 0.3s;
                }
                .frequency-count {
                    min-width: 100px;
                    text-align: right;
                }
            </style>
        </div>
        `;
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours}h ${minutes}m ${secs}s`;
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        if (pathname === '/api/audit') {
            const summary = this.getAccessSummary();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(summary));
            return;
        }

        if (pathname === '/api/logs') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.accessLog));
            return;
        }

        // Trigger a secret access to demonstrate audit logging
        if (pathname.startsWith('/api/access/')) {
            const secretName = decodeURIComponent(pathname.replace('/api/access/', ''));
            try {
                await this.trackSecretAccess(secretName);
                const secret = await this.getSecretFromKeyVault(secretName);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: `Accessed secret: ${secretName}`,
                    timestamp: new Date().toISOString()
                }));
                return;
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
                return;
            }
        }

        // Default HTML response
        const secrets = await this.getSecrets();
        const summary = this.getAccessSummary();
        const baseHTML = this.getBaseHTML();
        const auditHTML = this.getHTMLWithAuditData(summary);
        
        // Insert the audit dashboard content before the error container
        const fullHTML = baseHTML.replace(
            '<div id="error-container" style="display: none;"></div>',
            auditHTML + '\n        <div id="error-container" style="display: none;"></div>'
        );

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }
}

const app = new AuditDashboardWebapp({
    appName: 'Hello World - Secret Audit Dashboard',
    method: 'Secret Audit Dashboard',
    secretStrategy: 'azure-api'
});

app.start();


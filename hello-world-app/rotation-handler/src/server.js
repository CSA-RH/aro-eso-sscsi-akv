const http = require('http');
const url = require('url');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('../../shared/webapp-framework');

class RotationHandlerWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.keyVaultClient = null;
        this.rotationHistory = [];
        this.currentVersions = {};
        this.lastRotationCheck = null;
        this.checkInterval = config.rotationCheckInterval || 30000; // Check every 30 seconds
        this.initializeAzureKeyVaultClient();
        this.startRotationMonitoring();
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
            console.log('Azure Key Vault client initialized for rotation monitoring');
        } catch (error) {
            console.error('Failed to initialize Azure Key Vault client:', error.message);
        }
    }

    async getSecretVersions(secretName) {
        if (!this.keyVaultClient) {
            return null;
        }

        try {
            const versions = [];
            const iterator = this.keyVaultClient.listSecretProperties(secretName);
            
            for await (const version of iterator) {
                versions.push({
                    id: version.id,
                    name: version.name,
                    version: version.version,
                    enabled: version.enabled,
                    createdOn: version.createdOn,
                    updatedOn: version.updatedOn,
                    contentType: version.contentType
                });
            }

            // Sort by created date (newest first)
            versions.sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime());
            return versions;
        } catch (error) {
            console.error(`Error fetching versions for ${secretName}:`, error.message);
            return null;
        }
    }

    async checkForRotation(secretName) {
        const versions = await this.getSecretVersions(secretName);
        if (!versions || versions.length === 0) {
            return null;
        }

        const latestVersion = versions[0];
        const previousVersion = this.currentVersions[secretName];

        // Check if a new version was created
        if (!previousVersion || previousVersion.version !== latestVersion.version) {
            const rotationEvent = {
                secretName,
                oldVersion: previousVersion ? previousVersion.version : 'unknown',
                newVersion: latestVersion.version,
                timestamp: new Date().toISOString(),
                versionCount: versions.length
            };

            this.rotationHistory.unshift(rotationEvent); // Add to beginning
            if (this.rotationHistory.length > 50) {
                this.rotationHistory.pop(); // Keep only last 50 events
            }

            this.currentVersions[secretName] = latestVersion;

            console.log(`🔄 Rotation detected for ${secretName}: ${rotationEvent.oldVersion} → ${rotationEvent.newVersion}`);
            return rotationEvent;
        }

        this.currentVersions[secretName] = latestVersion;
        return null;
    }

    async checkAllSecretsForRotation() {
        if (!this.keyVaultClient) {
            return;
        }

        const secretsToMonitor = ['database-password', 'api-key', 'hello-world-secret'];
        const rotations = [];

        for (const secretName of secretsToMonitor) {
            try {
                const rotation = await this.checkForRotation(secretName);
                if (rotation) {
                    rotations.push(rotation);
                }
            } catch (error) {
                console.error(`Error checking rotation for ${secretName}:`, error.message);
            }
        }

        this.lastRotationCheck = new Date();

        if (rotations.length > 0) {
            console.log(`Detected ${rotations.length} secret rotation(s)`);
            // Trigger cache refresh
            this.cachedSecrets = {};
            this.lastCacheTime = 0;
        }

        return rotations;
    }

    startRotationMonitoring() {
        // Initial check
        this.checkAllSecretsForRotation();

        // Periodic checks
        setInterval(() => {
            this.checkAllSecretsForRotation();
        }, this.checkInterval);
    }

    getRotationInfo() {
        const rotationStats = this.rotationHistory.reduce((stats, rotation) => {
            if (!stats[rotation.secretName]) {
                stats[rotation.secretName] = { count: 0, lastRotation: null };
            }
            stats[rotation.secretName].count++;
            if (!stats[rotation.secretName].lastRotation || rotation.timestamp > stats[rotation.secretName].lastRotation) {
                stats[rotation.secretName].lastRotation = rotation.timestamp;
            }
            return stats;
        }, {});

        const rotBySecret = Object.values(this.rotationHistory).reduce((acc, r) => {
            acc[r.secretName] = (acc[r.secretName] || 0) + 1;
            return acc;
        }, {});

        return {
            enabled: !!this.keyVaultClient,
            lastCheck: this.lastRotationCheck ? this.lastRotationCheck.toISOString() : null,
            checkInterval: this.checkInterval,
            currentVersions: Object.keys(this.currentVersions).reduce((acc, key) => {
                acc[key] = {
                    version: this.currentVersions[key].version,
                    created: this.currentVersions[key].createdOn.toISOString(),
                    enabled: this.currentVersions[key].enabled
                };
                return acc;
            }, {}),
            rotationCount: this.rotationHistory.length,
            recentRotations: this.rotationHistory.slice(0, 20), // Last 20 rotations
            rotationStats: rotationStats,
            rotationsBySecret: rotBySecret,
            mostRotatedSecret: Object.keys(rotBySecret).length > 0 
                ? Object.keys(rotBySecret).reduce((a, b) => rotBySecret[a] > rotBySecret[b] ? a : b)
                : null,
            rotationTimeline: this.rotationHistory.slice(0, 30) // For timeline visualization
        };
    }

    async rotateSecretInKeyVault(secretName) {
        if (!this.keyVaultClient) {
            return { error: 'Key Vault client not initialized' };
        }

        try {
            // Get the current version before rotating (if it exists)
            let oldVersion = null;
            try {
                const currentSecret = await this.keyVaultClient.getSecret(secretName);
                oldVersion = currentSecret.properties.version;
            } catch (error) {
                // Secret might not exist yet, that's okay
                console.log(`No previous version found for ${secretName}, will create new secret`);
            }

            // Generate a new value based on secret name
            let newValue = '';
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 10).toUpperCase();

            if (secretName.includes('database') || secretName.includes('db')) {
                newValue = `SecureDB_${timestamp}_${random}`;
            } else if (secretName.includes('api')) {
                newValue = `sk-${timestamp}-${random}`;
            } else if (secretName.includes('hello-world')) {
                newValue = `Hello from Azure Key Vault via Web Apps! (Rotated at ${new Date().toISOString()})`;
            } else if (secretName.includes('jwt')) {
                newValue = `jwt-secret-${timestamp}-${random}`;
            } else {
                newValue = `rotated-${secretName}-${timestamp}-${random}`;
            }

            // Set the new secret value (this creates a new version)
            const secret = await this.keyVaultClient.setSecret(secretName, newValue);
            const newVersion = secret.properties.version;
            
            console.log(`🔄 Rotated secret '${secretName}': ${oldVersion || 'N/A'} → ${newVersion}`);
            
            // Manually add rotation event to history
            const rotationEvent = {
                secretName: secretName,
                oldVersion: oldVersion || 'N/A',
                newVersion: newVersion,
                timestamp: new Date().toISOString(),
                rotatedBy: 'manual' // Mark as manually rotated
            };
            
            this.rotationHistory.unshift(rotationEvent); // Add to beginning
            if (this.rotationHistory.length > 50) {
                this.rotationHistory.pop(); // Keep only last 50 events
            }
            
            // Update current version tracking
            this.currentVersions[secretName] = {
                version: newVersion,
                createdOn: secret.properties.createdOn,
                enabled: secret.properties.enabled
            };
            
            // Clear cache to force refresh on next request
            this.cachedSecrets = {};
            this.lastCacheTime = 0;
            
            return {
                success: true,
                secretName,
                newVersion: newVersion,
                oldVersion: oldVersion,
                newValue: newValue.substring(0, 50) + '...', // Don't return full value in response
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error(`Error rotating secret '${secretName}':`, error.message);
            return {
                success: false,
                secretName,
                error: error.message
            };
        }
    }

    async handleRequest(req, res) {
        // Parse URL to get pathname (handles query strings properly)
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        if (pathname === '/api/health' || pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy', rotationMonitoring: true }));
            return;
        }

        if (pathname === '/api/rotation-info' || pathname === '/api/rotation') {
            const rotationInfo = this.getRotationInfo();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rotationInfo));
            return;
        }

        if (pathname.startsWith('/api/versions/')) {
            const secretName = decodeURIComponent(pathname.replace('/api/versions/', ''));
            const versions = await this.getSecretVersions(secretName);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ secretName, versions }));
            return;
        }

        if (pathname === '/api/check-rotation' || pathname === '/api/check') {
            const rotations = await this.checkAllSecretsForRotation();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                checked: true, 
                rotations,
                rotationInfo: this.getRotationInfo()
            }));
            return;
        }

        if (pathname.startsWith('/api/rotate/')) {
            const secretName = decodeURIComponent(pathname.replace('/api/rotate/', ''));
            const result = await this.rotateSecretInKeyVault(secretName);
            
            // Refresh last check time (rotation already tracked in rotateSecretInKeyVault)
            this.lastRotationCheck = new Date();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                rotation: result,
                rotationInfo: this.getRotationInfo()
            }));
            return;
        }

        if (pathname === '/api/rotate-all') {
            const secretsToRotate = ['database-password', 'api-key', 'hello-world-secret'];
            const results = [];
            
            for (const secretName of secretsToRotate) {
                const result = await this.rotateSecretInKeyVault(secretName);
                results.push(result);
                // Small delay between rotations
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Refresh last check time (rotations already tracked in rotateSecretInKeyVault)
            this.lastRotationCheck = new Date();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                rotations: results,
                rotationInfo: this.getRotationInfo()
            }));
            return;
        }

        if (pathname === '/api/secrets') {
            const secrets = await this.getSecrets();
            const rotationInfo = this.getRotationInfo();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ secrets, rotationInfo }));
            return;
        }

        if (pathname.startsWith('/api/')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
            return;
        }

        // Generate HTML with rotation info
        const secrets = await this.getSecrets();
        const rotationInfo = this.getRotationInfo();
        const html = this.getHTMLWithRotationInfo(secrets, rotationInfo);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }

    getHTMLWithRotationInfo(secrets, rotationInfo) {
        const baseHTML = this.getHTML();
        const daysSinceLastRotation = rotationInfo.rotationTimeline.length > 0 
            ? Math.floor((Date.now() - new Date(rotationInfo.rotationTimeline[0].timestamp).getTime()) / (1000 * 60 * 60 * 24))
            : null;

        const rotationSection = `
            <div class="rotation-section">
                <h2>🔄 Secret Rotation Management Dashboard</h2>
                
                <div class="stats-grid">
                    <div class="stat-card primary">
                        <div class="stat-value">${rotationInfo.rotationCount}</div>
                        <div class="stat-label">Total Rotations</div>
                        ${rotationInfo.mostRotatedSecret ? `<div class="stat-subtext">Most rotated: ${rotationInfo.mostRotatedSecret}</div>` : ''}
                    </div>
                    <div class="stat-card ${rotationInfo.enabled ? 'success' : 'danger'}">
                        <div class="stat-value">${rotationInfo.enabled ? '✓' : '✗'}</div>
                        <div class="stat-label">Monitoring Status</div>
                        <div class="stat-subtext">${rotationInfo.checkInterval / 1000}s interval</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${Object.keys(rotationInfo.currentVersions).length}</div>
                        <div class="stat-label">Tracked Secrets</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${rotationInfo.lastCheck ? new Date(rotationInfo.lastCheck).toLocaleString() : 'Never'}</div>
                        <div class="stat-label">Last Check</div>
                    </div>
                </div>

                ${Object.keys(rotationInfo.rotationStats).length > 0 ? `
                <h3>Rotation Statistics by Secret</h3>
                <div class="stats-grid">
                    ${Object.entries(rotationInfo.rotationStats).map(([name, stats]) => `
                    <div class="stat-card">
                        <div class="stat-value">${stats.count}</div>
                        <div class="stat-label">${name}</div>
                        ${stats.lastRotation ? `<div class="stat-subtext">Last: ${new Date(stats.lastRotation).toLocaleDateString()}</div>` : ''}
                    </div>
                    `).join('')}
                </div>
                ` : ''}

                <h3>Current Secret Versions</h3>
                <div class="versions-grid">
                    ${Object.keys(rotationInfo.currentVersions).length > 0 
                        ? Object.entries(rotationInfo.currentVersions).map(([name, info]) => {
                            const age = Math.floor((Date.now() - new Date(info.created).getTime()) / (1000 * 60 * 60 * 24));
                            const rotCount = rotationInfo.rotationsBySecret[name] || 0;
                            return `
                            <div class="version-card ${info.enabled ? '' : 'disabled'}">
                                <div class="version-header">
                                    <strong>${name}</strong>
                                    <span class="badge ${info.enabled ? 'badge-success' : 'badge-danger'}">${info.enabled ? 'Enabled' : 'Disabled'}</span>
                                </div>
                                <div class="version-details">
                                    <div><strong>Version:</strong> <code>${info.version.substring(0, 12)}...</code></div>
                                    <div><strong>Created:</strong> ${new Date(info.created).toLocaleDateString()}</div>
                                    <div><strong>Age:</strong> ${age} days</div>
                                    <div><strong>Rotations:</strong> ${rotCount}</div>
                                </div>
                                <button class="rotate-btn" onclick="rotateSecret('${name}')">🔄 Rotate Now</button>
                            </div>
                        `;
                        }).join('')
                        : '<p>No versions tracked yet. Rotations will be detected automatically.</p>'
                    }
                </div>

                <h3>Rotation Timeline (Last 20)</h3>
                <div class="timeline-container">
                    ${rotationInfo.recentRotations.length > 0
                        ? rotationInfo.recentRotations.map((rotation, index) => {
                            const timeAgo = Math.floor((Date.now() - new Date(rotation.timestamp).getTime()) / (1000 * 60));
                            return `
                            <div class="timeline-item ${index === 0 ? 'latest' : ''}">
                                <div class="timeline-marker"></div>
                                <div class="timeline-content">
                                    <div class="timeline-header">
                                        <strong>${rotation.secretName}</strong>
                                        <span class="timeline-time">${timeAgo < 60 ? `${timeAgo}m ago` : `${Math.floor(timeAgo / 60)}h ago`}</span>
                                    </div>
                                    <div class="version-change">
                                        <span class="version-old">${rotation.oldVersion.substring(0, 8)}...</span>
                                        <span class="arrow">→</span>
                                        <span class="version-new">${rotation.newVersion.substring(0, 8)}...</span>
                                    </div>
                                    <div class="timeline-date">${new Date(rotation.timestamp).toLocaleString()}</div>
                                </div>
                            </div>
                        `;
                        }).join('')
                        : '<p class="no-rotations">No rotations detected yet. Use the rotate buttons above to create new secret versions.</p>'
                    }
                </div>

                <div class="action-buttons">
                    <button class="action-btn primary" onclick="checkRotations()">🔍 Check for Rotations</button>
                    <button class="action-btn success" onclick="rotateSecret('database-password')">🔄 Rotate Database Password</button>
                    <button class="action-btn success" onclick="rotateSecret('api-key')">🔄 Rotate API Key</button>
                    <button class="action-btn success" onclick="rotateSecret('hello-world-secret')">🔄 Rotate Hello World Secret</button>
                    <button class="action-btn danger" onclick="rotateAll()">🔄 Rotate All Secrets</button>
                </div>

                <div class="info-box">
                    <h4>📋 How Rotation Works</h4>
                    <ul>
                        <li><strong>Automatic Detection:</strong> The system checks for new secret versions every ${rotationInfo.checkInterval / 1000} seconds</li>
                        <li><strong>Version Tracking:</strong> Current versions are cached and compared on each check</li>
                        <li><strong>History:</strong> Up to 50 rotation events are kept in memory for auditing</li>
                        <li><strong>Cache Refresh:</strong> When rotation is detected, cached secrets are automatically refreshed</li>
                        <li><strong>Manual Rotation:</strong> Use the buttons above to manually rotate secrets immediately</li>
                    </ul>
                </div>
            </div>
            
            <style>
                .rotation-section {
                    background: #fff;
                    padding: 30px;
                    margin: 20px 0;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
                .stat-card.primary {
                    background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
                    color: white;
                }
                .stat-card.success { background: #d4edda; color: #155724; }
                .stat-card.danger { background: #f8d7da; color: #721c24; }
                .stat-value {
                    font-size: 2.5em;
                    font-weight: bold;
                    color: #007bff;
                }
                .stat-card.primary .stat-value,
                .stat-card.success .stat-value,
                .stat-card.danger .stat-value {
                    color: inherit;
                }
                .stat-label {
                    margin-top: 10px;
                    color: #6c757d;
                }
                .stat-card.primary .stat-label,
                .stat-card.success .stat-label,
                .stat-card.danger .stat-label {
                    color: rgba(255,255,255,0.9);
                }
                .stat-subtext {
                    font-size: 0.85em;
                    margin-top: 5px;
                    opacity: 0.8;
                }
                .versions-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 15px;
                    margin: 20px 0;
                }
                .version-card {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    border-left: 4px solid #ff9800;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .version-card.disabled {
                    opacity: 0.6;
                    border-color: #6c757d;
                }
                .version-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .version-details {
                    font-size: 0.9em;
                    color: #6c757d;
                    margin: 10px 0;
                }
                .version-details div {
                    margin: 5px 0;
                }
                .rotate-btn {
                    width: 100%;
                    padding: 8px;
                    background: #4caf50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 500;
                    margin-top: 10px;
                }
                .rotate-btn:hover {
                    background: #388e3c;
                }
                .timeline-container {
                    margin: 20px 0;
                    position: relative;
                    padding-left: 30px;
                }
                .timeline-item {
                    position: relative;
                    padding-bottom: 20px;
                    padding-left: 20px;
                    border-left: 2px solid #e0e0e0;
                }
                .timeline-item.latest {
                    border-left-color: #ff9800;
                }
                .timeline-item:last-child {
                    border-left: none;
                }
                .timeline-marker {
                    position: absolute;
                    left: -6px;
                    top: 0;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: #ff9800;
                    border: 2px solid white;
                }
                .timeline-item.latest .timeline-marker {
                    background: #4caf50;
                    width: 14px;
                    height: 14px;
                    left: -7px;
                }
                .timeline-content {
                    background: white;
                    padding: 15px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .timeline-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .timeline-time {
                    font-size: 0.85em;
                    color: #6c757d;
                }
                .version-change {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 10px 0;
                    font-family: monospace;
                }
                .version-old {
                    background: #ffebee;
                    padding: 4px 8px;
                    border-radius: 4px;
                    color: #c62828;
                }
                .version-new {
                    background: #e8f5e9;
                    padding: 4px 8px;
                    border-radius: 4px;
                    color: #2e7d32;
                }
                .arrow {
                    color: #ff9800;
                    font-weight: bold;
                }
                .timeline-date {
                    font-size: 0.85em;
                    color: #6c757d;
                    margin-top: 5px;
                }
                .no-rotations {
                    text-align: center;
                    padding: 40px;
                    color: #6c757d;
                    font-style: italic;
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
                    background: #ff9800;
                    color: white;
                }
                .action-btn.success {
                    background: #4caf50;
                    color: white;
                }
                .action-btn.danger {
                    background: #f44336;
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
            </style>
            <script>
                async function rotateSecret(name) {
                    try {
                        const response = await fetch('/api/rotate/' + encodeURIComponent(name));
                        const data = await response.json();
                        if (data.rotation && data.rotation.success) {
                            alert('✅ Successfully rotated ' + name + '\\nNew version: ' + data.rotation.newVersion);
                            location.reload();
                        } else {
                            alert('❌ Error rotating ' + name + ': ' + (data.rotation?.error || 'Unknown error'));
                        }
                    } catch (error) {
                        alert('❌ Error: ' + error.message);
                    }
                }
                
                async function rotateAll() {
                    if (!confirm('Rotate ALL secrets? This will create new versions for database-password, api-key, and hello-world-secret.')) {
                        return;
                    }
                    try {
                        const response = await fetch('/api/rotate-all');
                        const data = await response.json();
                        const success = data.rotations.filter(r => r.success).length;
                        alert('Rotated ' + success + '/' + data.rotations.length + ' secrets');
                        location.reload();
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                }
                
                async function checkRotations() {
                    try {
                        const response = await fetch('/api/check-rotation');
                        const data = await response.json();
                        alert('Checked for rotations!\\nFound: ' + data.rotations.length + ' new rotation(s)');
                        if (data.rotations.length > 0) {
                            location.reload();
                        }
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                }
            </script>
        `;

        return baseHTML.replace(/<\/div>\s*<div id="secrets-container">/, 
            '</div>\n        ' + rotationSection + '\n        <div id="secrets-container">');
    }

    start() {
        // Use parent class but with rotation strategy
        this.secretStrategy = 'azure-api'; // Need Azure API access for version checking
        
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
            console.log(`Rotation Monitoring: Enabled`);
            console.log(`Check Interval: ${this.checkInterval / 1000}s`);
            console.log(`================================`);
        });
    }
}

const app = new RotationHandlerWebapp({
    appName: 'Hello World - Rotation Handler',
    method: 'Secret Rotation Handler',
    operator: '',
    keyvaultUrl: process.env.KEYVAULT_URL || '',
    secretStrategy: 'azure-api',
    rotationCheckInterval: parseInt(process.env.ROTATION_CHECK_INTERVAL || '30000')
});

app.start();


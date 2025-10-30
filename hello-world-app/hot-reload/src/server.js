const http = require('http');
const fs = require('fs');
const path = require('path');
const HelloWorldWebapp = require('../../shared/webapp-framework');

class HotReloadWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.secretsMountPath = config.secretsMountPath || '/etc/secrets';
        this.reloadInterval = config.reloadInterval || 5000; // Check every 5 seconds
        this.lastReloadTime = null;
        this.reloadCount = 0;
        this.watchers = [];
        this.setupWatchers();
    }

    setupWatchers() {
        try {
            // Watch CSI mount directory
            if (fs.existsSync(this.secretsMountPath)) {
                console.log(`Setting up file watcher for: ${this.secretsMountPath}`);
                
                const watcher = fs.watch(this.secretsMountPath, { recursive: false }, (eventType, filename) => {
                    if (filename && (eventType === 'rename' || eventType === 'change')) {
                        console.log(`File system event detected: ${eventType} on ${filename}`);
                        this.reloadSecrets();
                    }
                });
                
                this.watchers.push(watcher);

                // Also watch the ..data symlink which changes when secrets are updated
                const dataLink = path.join(this.secretsMountPath, '..data');
                if (fs.existsSync(dataLink)) {
                    const dataWatcher = fs.watch(dataLink, (eventType) => {
                        console.log(`Secret data link changed: ${eventType}`);
                        this.reloadSecrets();
                    });
                    this.watchers.push(dataWatcher);
                }
            }

            // Watch individual secret files
            const secretsToWatch = ['database-password', 'api-key', 'hello-world-secret'];
            secretsToWatch.forEach(secretName => {
                const secretPath = path.join(this.secretsMountPath, secretName);
                if (fs.existsSync(secretPath)) {
                    const watcher = fs.watch(secretPath, (eventType) => {
                        console.log(`Secret file changed: ${secretName} (${eventType})`);
                        this.reloadSecrets();
                    });
                    this.watchers.push(watcher);
                }
            });

            // Periodic check as fallback
            setInterval(() => {
                this.checkForChanges();
            }, this.reloadInterval);

            console.log('Hot reload watchers initialized');
        } catch (error) {
            console.error('Failed to setup watchers:', error.message);
        }
    }

    checkForChanges() {
        // Check if secret files have changed by comparing modification times
        const secretsToCheck = ['database-password', 'api-key', 'hello-world-secret'];
        let changed = false;

        secretsToCheck.forEach(secretName => {
            const secretPath = path.join(this.secretsMountPath, secretName);
            if (fs.existsSync(secretPath)) {
                try {
                    const stats = fs.statSync(secretPath);
                    // Store mtime in cached secrets to compare
                    const cacheKey = `_${secretName}_mtime`;
                    const lastMtime = this.cachedSecrets[cacheKey];
                    
                    if (lastMtime && lastMtime !== stats.mtime.getTime()) {
                        console.log(`Detected change in ${secretName} (mtime changed)`);
                        changed = true;
                    }
                    
                    this.cachedSecrets[cacheKey] = stats.mtime.getTime();
                } catch (error) {
                    // Ignore errors
                }
            }
        });

        if (changed) {
            this.reloadSecrets();
        }
    }

    reloadSecrets() {
        console.log('🔄 Reloading secrets...');
        this.lastReloadTime = new Date();
        this.reloadCount++;
        
        // Clear cache to force reload
        this.cachedSecrets = {};
        this.lastCacheTime = 0;

        // Reload secrets
        this.getSecrets().then(() => {
            console.log(`✅ Secrets reloaded successfully (reload #${this.reloadCount})`);
        }).catch(error => {
            console.error('❌ Failed to reload secrets:', error.message);
        });
    }

    getReloadInfo() {
        return {
            enabled: true,
            lastReloadTime: this.lastReloadTime ? this.lastReloadTime.toISOString() : null,
            reloadCount: this.reloadCount,
            watchersActive: this.watchers.length,
            secretsMountPath: this.secretsMountPath,
            reloadInterval: this.reloadInterval
        };
    }

    async handleRequest(req, res) {
        if (req.url === '/api/health' || req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy', hotReload: true }));
            return;
        }

        if (req.url === '/api/reload-info' || req.url === '/api/reload') {
            const reloadInfo = this.getReloadInfo();
            const secrets = await this.getSecrets();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                reloadInfo,
                secrets: Object.keys(secrets)
            }));
            return;
        }

        if (req.url === '/api/reload-now' || req.url === '/api/force-reload') {
            this.reloadSecrets();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Reload triggered', reloadInfo: this.getReloadInfo() }));
            return;
        }

        if (req.url.startsWith('/api/')) {
            const secrets = await this.getSecrets();
            const reloadInfo = this.getReloadInfo();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ secrets, reloadInfo }));
            return;
        }

        // Generate HTML with reload info
        const secrets = await this.getSecrets();
        const reloadInfo = this.getReloadInfo();
        const html = this.getHTMLWithReloadInfo(secrets, reloadInfo);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }

    getHTMLWithReloadInfo(secrets, reloadInfo) {
        const baseHTML = this.getHTML();
        
        const reloadSection = `
            <div class="reload-section" style="background: #f3e5f5; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #9c27b0;">
                <h3>🔄 Hot Reload Status</h3>
                <div class="reload-info">
                    <p><strong>Hot Reload:</strong> ${reloadInfo.enabled ? '✅ Enabled' : '❌ Disabled'}</p>
                    <p><strong>Watchers Active:</strong> ${reloadInfo.watchersActive}</p>
                    <p><strong>Reload Count:</strong> ${reloadInfo.reloadCount}</p>
                    <p><strong>Last Reload:</strong> ${reloadInfo.lastReloadTime || 'Never'}</p>
                    <p><strong>Check Interval:</strong> ${reloadInfo.reloadInterval / 1000} seconds</p>
                    <p><strong>Mount Path:</strong> <code>${reloadInfo.secretsMountPath}</code></p>
                </div>
                <div style="margin-top: 15px;">
                    <button onclick="fetch('/api/reload-now').then(r=>r.json()).then(d=>alert('Reloaded! Count: ' + d.reloadInfo.reloadCount))" 
                            style="padding: 10px 20px; background: #9c27b0; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        🔄 Force Reload Now
                    </button>
                </div>
                <p style="margin-top: 15px; font-size: 0.9em; color: #666;">
                    This webapp automatically reloads secrets when they change in Azure Key Vault. 
                    No pod restart required! The app watches the CSI mount directory for file changes 
                    and automatically refreshes the cached secrets.
                </p>
            </div>
        `;

        return baseHTML.replace('</body>', reloadSection + '</body>');
    }

    // Override start to use custom request handler
    start() {
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
            console.log(`Secrets mount path: ${this.secretsMountPath}`);
            console.log(`Hot Reload: Enabled`);
            console.log(`================================`);
        });
    }
}

const app = new HotReloadWebapp({
    appName: 'Hello World - Hot Reload',
    method: 'Hot Reload (CSI Driver)',
    operator: '',
    secretsMountPath: process.env.SECRETS_MOUNT_PATH || '/etc/secrets',
    secretStrategy: 'csi',
    reloadInterval: parseInt(process.env.RELOAD_INTERVAL || '5000')
});

app.start();


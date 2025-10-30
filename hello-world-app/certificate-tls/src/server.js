const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const HelloWorldWebapp = require('../../shared/webapp-framework');

class CertificateTLSWebapp extends HelloWorldWebapp {
    constructor(config) {
        super(config);
        this.certPath = config.certPath || '/etc/secrets/ssl-cert';
        this.keyPath = config.keyPath || '/etc/secrets/ssl-key';
        this.certificate = null;
        this.privateKey = null;
        this.server = null;
    }

    loadCertificates() {
        try {
            // Try to load certificate and key from CSI mount
            if (fs.existsSync(this.certPath)) {
                this.certificate = fs.readFileSync(this.certPath, 'utf8');
                console.log(`Certificate loaded from: ${this.certPath}`);
            } else {
                throw new Error(`Certificate not found at: ${this.certPath}`);
            }

            if (fs.existsSync(this.keyPath)) {
                this.privateKey = fs.readFileSync(this.keyPath, 'utf8');
                console.log(`Private key loaded from: ${this.keyPath}`);
            } else {
                throw new Error(`Private key not found at: ${this.keyPath}`);
            }

            // Parse certificate to get details
            const crypto = require('crypto');
            const cert = crypto.createSecureContext ? null : require('crypto').X509Certificate;
            
            return true;
        } catch (error) {
            console.error('Failed to load certificates:', error.message);
            return false;
        }
    }

    getCertificateInfo() {
        try {
            const crypto = require('crypto');
            const certPem = this.certificate;
            
            // Extract certificate information
            const certDetails = {
                loaded: !!this.certificate,
                keyLoaded: !!this.privateKey,
                certPath: this.certPath,
                keyPath: this.keyPath,
                certExists: fs.existsSync(this.certPath),
                keyExists: fs.existsSync(this.keyPath),
                certSize: this.certificate ? this.certificate.length : 0,
                keySize: this.privateKey ? this.privateKey.length : 0,
                tlsEnabled: !!(this.certificate && this.privateKey)
            };

            // Try to parse certificate if crypto supports it
            try {
                // For Node.js 15+, we can use X509Certificate (but might not be available)
                if (typeof crypto.X509Certificate !== 'undefined' && certPem) {
                    const x509 = new crypto.X509Certificate(certPem);
                    certDetails.subject = x509.subject;
                    certDetails.issuer = x509.issuer;
                    certDetails.validFrom = x509.validFrom;
                    certDetails.validTo = x509.validTo;
                    certDetails.serialNumber = x509.serialNumber;
                    certDetails.fingerprint = x509.fingerprint;
                    
                    // Calculate days until expiration
                    if (certDetails.validTo) {
                        const validToDate = new Date(certDetails.validTo);
                        const now = new Date();
                        const daysUntilExpiration = Math.floor((validToDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        certDetails.daysUntilExpiration = daysUntilExpiration;
                        certDetails.isExpired = daysUntilExpiration < 0;
                        certDetails.isExpiringSoon = daysUntilExpiration >= 0 && daysUntilExpiration <= 30;
                        certDetails.warningStatus = daysUntilExpiration < 0 ? 'expired' : 
                                                   daysUntilExpiration <= 7 ? 'critical' : 
                                                   daysUntilExpiration <= 30 ? 'warning' : 'valid';
                    }
                    
                    // Calculate certificate age
                    if (certDetails.validFrom) {
                        const validFromDate = new Date(certDetails.validFrom);
                        const now = new Date();
                        const ageDays = Math.floor((now.getTime() - validFromDate.getTime()) / (1000 * 60 * 60 * 24));
                        certDetails.ageDays = ageDays;
                    }
                }
            } catch (e) {
                // X509Certificate not available or parsing failed
                certDetails.parseError = e.message;
            }

            return certDetails;
        } catch (error) {
            return { error: error.message };
        }
    }
    
    getCertificateSummary(certInfo) {
        return {
            isHealthy: certInfo.loaded && certInfo.keyLoaded && !certInfo.isExpired && !certInfo.isExpiringSoon,
            status: certInfo.loaded && certInfo.keyLoaded ? (certInfo.isExpired ? 'expired' : certInfo.isExpiringSoon ? 'expiring' : 'valid') : 'error',
            hasValidCert: certInfo.loaded && certInfo.keyLoaded,
            expirationStatus: certInfo.daysUntilExpiration !== undefined ? 
                (certInfo.isExpired ? 'expired' : certInfo.isExpiringSoon ? 'expiring-soon' : 'valid') : 'unknown'
        };
    }

    async getSecretsWithCertInfo() {
        const secrets = await this.getSecrets();
        const certInfo = this.getCertificateInfo();
        
        return {
            secrets,
            certificate: certInfo,
            tlsEnabled: !!(this.certificate && this.privateKey)
        };
    }

    async handleRequest(req, res) {
        if (req.url === '/api/health' || req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy', tls: true }));
            return;
        }

        if (req.url === '/api/certificate' || req.url === '/api/cert') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.getCertificateInfo()));
            return;
        }

        if (req.url === '/api/secrets') {
            // Use the parent class's getSecrets response format
            const secrets = await this.getSecrets();
            const certInfo = this.getCertificateInfo();
            const response = {
                success: true,
                method: this.METHOD,
                operator: this.OPERATOR || '',
                secrets: secrets,
                certificate: certInfo,
                tlsEnabled: !!(this.certificate && this.privateKey),
                timestamp: new Date().toISOString(),
                note: "Secrets are mounted as files via Secrets Store CSI Driver. Certificates available for TLS."
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
            return;
        }

        if (req.url.startsWith('/api/')) {
            const data = await this.getSecretsWithCertInfo();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
            return;
        }

        // Generate HTML with certificate info
        const secrets = await this.getSecrets();
        const certInfo = this.getCertificateInfo();
        const html = this.getHTMLWithCertificateInfo(secrets, certInfo);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }

    getHTMLWithCertificateInfo(secrets, certInfo) {
        const baseHTML = this.getHTML({});
        const summary = this.getCertificateSummary(certInfo);
        
        // Inject certificate information into the HTML
        const certSection = `
            <div class="certificate-section">
                <h2>🔐 TLS Certificate Management Dashboard</h2>
                
                <div class="stats-grid">
                    <div class="stat-card ${summary.status === 'valid' ? 'success' : summary.status === 'expired' ? 'danger' : summary.status === 'expiring' ? 'warning' : 'neutral'}">
                        <div class="stat-value">${summary.status === 'valid' ? '✓' : summary.status === 'expired' ? '✗' : summary.status === 'expiring' ? '⚠' : '?'}</div>
                        <div class="stat-label">Certificate Status</div>
                        <div class="stat-subtext">${summary.status.toUpperCase()}</div>
                    </div>
                    <div class="stat-card ${certInfo.loaded && certInfo.keyLoaded ? 'success' : 'danger'}">
                        <div class="stat-value">${certInfo.loaded && certInfo.keyLoaded ? '✓' : '✗'}</div>
                        <div class="stat-label">TLS Enabled</div>
                        <div class="stat-subtext">${certInfo.loaded && certInfo.keyLoaded ? 'HTTPS Active' : 'HTTP Only'}</div>
                    </div>
                    ${certInfo.daysUntilExpiration !== undefined ? `
                    <div class="stat-card ${certInfo.isExpired ? 'danger' : certInfo.isExpiringSoon ? 'warning' : 'success'}">
                        <div class="stat-value">${certInfo.isExpired ? '0' : certInfo.daysUntilExpiration}</div>
                        <div class="stat-label">Days Until Expiration</div>
                        ${certInfo.isExpired ? '<div class="stat-subtext">EXPIRED</div>' : certInfo.isExpiringSoon ? '<div class="stat-subtext">⚠ Expiring Soon</div>' : '<div class="stat-subtext">Valid</div>'}
                    </div>
                    ` : ''}
                    ${certInfo.ageDays !== undefined ? `
                    <div class="stat-card neutral">
                        <div class="stat-value">${certInfo.ageDays}</div>
                        <div class="stat-label">Certificate Age (Days)</div>
                        <div class="stat-subtext">Issued ${new Date(certInfo.validFrom).toLocaleDateString()}</div>
                    </div>
                    ` : ''}
                </div>

                ${certInfo.isExpired ? `
                <div class="alert-box danger">
                    <h3>❌ Certificate Expired</h3>
                    <p>This certificate expired on ${new Date(certInfo.validTo).toLocaleString()}. 
                    It needs to be renewed immediately. The TLS connection may not work properly.</p>
                </div>
                ` : ''}
                
                ${certInfo.isExpiringSoon && !certInfo.isExpired ? `
                <div class="alert-box warning">
                    <h3>⚠️ Certificate Expiring Soon</h3>
                    <p>This certificate will expire in <strong>${certInfo.daysUntilExpiration} days</strong> 
                    (on ${new Date(certInfo.validTo).toLocaleString()}). 
                    Please renew it before expiration to avoid service disruption.</p>
                </div>
                ` : ''}
                
                ${!certInfo.loaded || !certInfo.keyLoaded ? `
                <div class="alert-box danger">
                    <h3>❌ Certificate or Key Not Loaded</h3>
                    <p>${!certInfo.loaded ? `Certificate not found at: <code>${certInfo.certPath}</code><br/>` : ''}
                    ${!certInfo.keyLoaded ? `Private key not found at: <code>${certInfo.keyPath}</code>` : ''}</p>
                    <p>Check your SecretProviderClass configuration to ensure certificates are properly mounted.</p>
                </div>
                ` : ''}

                <h3>Certificate Details</h3>
                <div class="details-grid">
                    <div class="detail-card">
                        <h4>Subject Information</h4>
                        <div class="detail-content">
                            ${certInfo.subject ? `
                            <div class="detail-item">
                                <strong>Subject:</strong> 
                                <code class="subject-dn">${certInfo.subject}</code>
                            </div>
                            ` : '<div class="detail-item"><em>Subject information not available</em></div>'}
                        </div>
                    </div>
                    
                    <div class="detail-card">
                        <h4>Issuer Information</h4>
                        <div class="detail-content">
                            ${certInfo.issuer ? `
                            <div class="detail-item">
                                <strong>Issuer:</strong> 
                                <code class="issuer-dn">${certInfo.issuer}</code>
                            </div>
                            ` : '<div class="detail-item"><em>Issuer information not available</em></div>'}
                        </div>
                    </div>
                    
                    <div class="detail-card">
                        <h4>Validity Period</h4>
                        <div class="detail-content">
                            ${certInfo.validFrom ? `
                            <div class="detail-item">
                                <strong>Valid From:</strong> 
                                <span class="date-value">${new Date(certInfo.validFrom).toLocaleString()}</span>
                            </div>
                            ` : ''}
                            ${certInfo.validTo ? `
                            <div class="detail-item">
                                <strong>Valid To:</strong> 
                                <span class="date-value ${certInfo.isExpired ? 'expired' : certInfo.isExpiringSoon ? 'warning' : ''}">${new Date(certInfo.validTo).toLocaleString()}</span>
                                ${certInfo.daysUntilExpiration !== undefined ? `
                                <span class="expiration-badge ${certInfo.isExpired ? 'badge-danger' : certInfo.isExpiringSoon ? 'badge-warning' : 'badge-success'}">
                                    ${certInfo.isExpired ? 'EXPIRED' : certInfo.isExpiringSoon ? `${certInfo.daysUntilExpiration} days left` : 'Valid'}
                                </span>
                                ` : ''}
                            </div>
                            ` : ''}
                            ${certInfo.ageDays !== undefined ? `
                            <div class="detail-item">
                                <strong>Certificate Age:</strong> 
                                <span>${certInfo.ageDays} days</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="detail-card">
                        <h4>Technical Information</h4>
                        <div class="detail-content">
                            ${certInfo.serialNumber ? `
                            <div class="detail-item">
                                <strong>Serial Number:</strong> 
                                <code class="serial-number">${certInfo.serialNumber}</code>
                            </div>
                            ` : ''}
                            ${certInfo.fingerprint ? `
                            <div class="detail-item">
                                <strong>Fingerprint:</strong> 
                                <code class="fingerprint">${certInfo.fingerprint}</code>
                            </div>
                            ` : ''}
                            <div class="detail-item">
                                <strong>Certificate Path:</strong> 
                                <code>${certInfo.certPath}</code>
                            </div>
                            <div class="detail-item">
                                <strong>Key Path:</strong> 
                                <code>${certInfo.keyPath}</code>
                            </div>
                            <div class="detail-item">
                                <strong>Certificate Size:</strong> 
                                <span>${(certInfo.certSize / 1024).toFixed(2)} KB</span>
                            </div>
                            <div class="detail-item">
                                <strong>Private Key Size:</strong> 
                                <span>${(certInfo.keySize / 1024).toFixed(2)} KB</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="info-box">
                    <h4>📋 How Certificate TLS Works</h4>
                    <ul>
                        <li><strong>Certificate Source:</strong> TLS certificates and private keys are stored in Azure Key Vault</li>
                        <li><strong>Mount Method:</strong> Secrets Store CSI Driver mounts certificates as files in the pod</li>
                        <li><strong>TLS Configuration:</strong> Node.js HTTPS server uses the mounted certificate and key</li>
                        <li><strong>Automatic Rotation:</strong> When certificates are updated in Key Vault, they can be automatically reloaded</li>
                        <li><strong>Security:</strong> Private keys never leave the Key Vault and are securely mounted into the pod</li>
                    </ul>
                </div>
            </div>
            
            <style>
                .certificate-section {
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
                .stat-card.success { background: #d4edda; color: #155724; }
                .stat-card.danger { background: #f8d7da; color: #721c24; }
                .stat-card.warning { background: #fff3cd; color: #856404; }
                .stat-card.neutral { background: #e9ecef; color: #495057; }
                .stat-value {
                    font-size: 2.5em;
                    font-weight: bold;
                }
                .stat-label {
                    margin-top: 10px;
                    font-weight: 500;
                }
                .stat-subtext {
                    font-size: 0.85em;
                    margin-top: 5px;
                    opacity: 0.9;
                }
                .alert-box {
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                }
                .alert-box.danger {
                    background: #f8d7da;
                    border-left: 4px solid #dc3545;
                }
                .alert-box.warning {
                    background: #fff3cd;
                    border-left: 4px solid #ffc107;
                }
                .alert-box h3 {
                    margin-top: 0;
                }
                .details-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .detail-card {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    border-left: 4px solid #2196f3;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .detail-card h4 {
                    margin-top: 0;
                    color: #2196f3;
                }
                .detail-content {
                    font-size: 0.9em;
                }
                .detail-item {
                    margin: 12px 0;
                    line-height: 1.6;
                }
                .subject-dn, .issuer-dn {
                    display: block;
                    margin-top: 5px;
                    padding: 8px;
                    background: #263238;
                    color: #4caf50;
                    border-radius: 4px;
                    font-size: 0.85em;
                    word-break: break-all;
                }
                .serial-number, .fingerprint {
                    display: block;
                    margin-top: 5px;
                    padding: 8px;
                    background: #263238;
                    color: #4caf50;
                    border-radius: 4px;
                    font-size: 0.9em;
                    font-family: monospace;
                    word-break: break-all;
                }
                .date-value {
                    font-weight: 500;
                }
                .date-value.expired {
                    color: #dc3545;
                    font-weight: bold;
                }
                .date-value.warning {
                    color: #856404;
                    font-weight: bold;
                }
                .expiration-badge {
                    display: inline-block;
                    padding: 4px 10px;
                    border-radius: 12px;
                    font-size: 0.75em;
                    font-weight: bold;
                    margin-left: 10px;
                }
                .badge-success { background: #28a745; color: white; }
                .badge-warning { background: #ffc107; color: #856404; }
                .badge-danger { background: #dc3545; color: white; }
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
        `;

        // Inject custom HTML after the method details section
        let fullHTML = baseHTML.replace('</div>\n        <div id="secrets-container">', 
            '</div>\n        ' + certSection + '\n        <div id="secrets-container">');
        
        if (fullHTML === baseHTML) {
            fullHTML = baseHTML.replace('</div>\n<div id="secrets-container">', 
                '</div>\n' + certSection + '\n<div id="secrets-container">');
        }
        
        if (fullHTML === baseHTML) {
            fullHTML = baseHTML.replace(/<\/div>\s*<div id="secrets-container">/, 
                '</div>\n        ' + certSection + '\n        <div id="secrets-container">');
        }
        
        if (fullHTML === baseHTML) {
            fullHTML = baseHTML.replace(/(<div class="method">[\s\S]*?<\/div>)/, 
                '$1\n        ' + certSection);
        }

        return fullHTML;
    }

    start() {
        // Always try to load certificates for display purposes
        this.loadCertificates();
        
        // Check if we should use HTTP mode (for reverse proxy scenarios)
        const useHttp = process.env.USE_HTTP === 'true';
        
        if (useHttp) {
            console.log('Using HTTP mode (TLS handled by reverse proxy)');
            return super.start(); // Use parent class HTTP server
        }

        // If certificates failed to load, fallback to HTTP
        if (!this.certificate || !this.privateKey) {
            console.error('Failed to load certificates. Starting HTTP server without TLS.');
            return super.start(); // Fallback to HTTP
        }

        const options = {
            key: this.privateKey,
            cert: this.certificate
        };

        this.server = https.createServer(options, (req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.PORT, () => {
            console.log(`================================`);
            console.log(`${this.APP_NAME} running on port ${this.PORT}`);
            console.log(`Method: ${this.METHOD}`);
            console.log(`TLS: Enabled (HTTPS)`);
            console.log(`Certificate: Loaded from ${this.certPath}`);
            console.log(`Private Key: Loaded from ${this.keyPath}`);
            console.log(`================================`);
        });

        // Error handling
        this.server.on('error', (error) => {
            console.error('HTTPS Server error:', error);
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${this.PORT} is already in use`);
            }
        });
    }
}

const app = new CertificateTLSWebapp({
    appName: 'Hello World - Certificate TLS',
    method: 'Certificate-Based TLS (CSI Driver)',
    operator: '',
    secretsMountPath: process.env.SECRETS_MOUNT_PATH || '/etc/secrets',
    secretStrategy: 'csi',
    certPath: process.env.CERT_PATH || '/etc/secrets/ssl-cert',
    keyPath: process.env.KEY_PATH || '/etc/secrets/ssl-key'
});

app.start();


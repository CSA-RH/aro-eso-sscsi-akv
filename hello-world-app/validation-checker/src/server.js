const http = require('http');
const url = require('url');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('./webapp-framework');

class ValidationCheckerWebapp extends HelloWorldWebapp {
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
        
        this.validationRules = {
            'database-password': {
                minLength: 12,
                maxLength: 128,
                requireUppercase: true,
                requireLowercase: true,
                requireNumbers: true,
                requireSpecial: true
            },
            'api-key': {
                minLength: 32,
                maxLength: 256,
                pattern: /^[A-Za-z0-9]+$/
            },
            'hello-world-secret': {
                minLength: 1,
                maxLength: 1000
            }
        };
        this.validationResults = {};
        this.lastValidation = 0;
        this.VALIDATION_INTERVAL = 60000; // 1 minute
        
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
            console.error('Missing required Azure credentials for validation checker');
            return;
        }

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        this.keyVaultClient = new SecretClient(keyVaultUrl, credential);
    }

    validateSecretFormat(secretName, secretValue) {
        const rule = this.validationRules[secretName] || {};
        const issues = [];
        const warnings = [];

        // Length validation
        if (rule.minLength && secretValue.length < rule.minLength) {
            issues.push(`Too short: minimum ${rule.minLength} characters, got ${secretValue.length}`);
        }
        if (rule.maxLength && secretValue.length > rule.maxLength) {
            issues.push(`Too long: maximum ${rule.maxLength} characters, got ${secretValue.length}`);
        }

        // Character requirements
        if (rule.requireUppercase && !/[A-Z]/.test(secretValue)) {
            issues.push('Missing uppercase letters');
        }
        if (rule.requireLowercase && !/[a-z]/.test(secretValue)) {
            issues.push('Missing lowercase letters');
        }
        if (rule.requireNumbers && !/[0-9]/.test(secretValue)) {
            issues.push('Missing numbers');
        }
        if (rule.requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(secretValue)) {
            issues.push('Missing special characters');
        }

        // Pattern validation
        if (rule.pattern && !rule.pattern.test(secretValue)) {
            issues.push(`Does not match required pattern: ${rule.pattern}`);
        }

        // Additional checks
        if (secretValue.includes(' ') && secretName.includes('password')) {
            warnings.push('Contains spaces (may cause issues in some systems)');
        }

        return {
            valid: issues.length === 0,
            issues: issues,
            warnings: warnings,
            length: secretValue.length,
            hasUppercase: /[A-Z]/.test(secretValue),
            hasLowercase: /[a-z]/.test(secretValue),
            hasNumbers: /[0-9]/.test(secretValue),
            hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(secretValue)
        };
    }

    async checkSecretHealth(secretName) {
        const result = {
            name: secretName,
            accessible: false,
            formatValid: false,
            validationResult: null,
            error: null,
            lastChecked: new Date().toISOString()
        };

        try {
            // Check accessibility
            const secret = await this.getSecretFromAzureKeyVault(secretName);
            result.accessible = true;
            result.secretExists = !!secret;

            // Validate format if we got the secret
            if (secret) {
                result.validationResult = this.validateSecretFormat(secretName, secret);
                result.formatValid = result.validationResult.valid;
            }

        } catch (error) {
            result.error = error.message;
            result.accessible = false;
        }

        return result;
    }

    async validateAllSecrets() {
        const now = Date.now();
        if (now - this.lastValidation < this.VALIDATION_INTERVAL && Object.keys(this.validationResults).length > 0) {
            return this.validationResults;
        }

        const secretNames = Object.keys(this.validationRules);
        const results = {};

        for (const secretName of secretNames) {
            results[secretName] = await this.checkSecretHealth(secretName);
        }

        this.validationResults = results;
        this.lastValidation = now;
        return results;
    }

    getHealthSummary(results) {
        const total = Object.keys(results).length;
        const accessible = Object.values(results).filter(r => r.accessible).length;
        const formatValid = Object.values(results).filter(r => r.formatValid).length;
        const healthy = Object.values(results).filter(r => r.accessible && r.formatValid).length;
        const withIssues = Object.values(results).filter(r => r.validationResult && r.validationResult.issues && r.validationResult.issues.length > 0).length;
        const withWarnings = Object.values(results).filter(r => r.validationResult && r.validationResult.warnings && r.validationResult.warnings.length > 0).length;
        
        // Collect all issues for recommendations
        const allIssues = [];
        Object.values(results).forEach(r => {
            if (r.validationResult && r.validationResult.issues) {
                r.validationResult.issues.forEach(issue => {
                    if (!allIssues.find(i => i.text === issue)) {
                        allIssues.push({ text: issue, count: 1 });
                    } else {
                        allIssues.find(i => i.text === issue).count++;
                    }
                });
            }
        });

        return {
            total,
            accessible,
            formatValid,
            healthy,
            unhealthy: total - healthy,
            healthPercentage: total > 0 ? Math.round((healthy / total) * 100) : 0,
            withIssues,
            withWarnings,
            commonIssues: allIssues.sort((a, b) => b.count - a.count).slice(0, 5)
        };
    }

    getHTMLWithValidationData(results, summary) {
        const unaccessibleSecrets = Object.values(results).filter(r => !r.accessible);
        const invalidFormatSecrets = Object.values(results).filter(r => r.accessible && !r.formatValid);

        return `
        <div class="container">
            <h2>Secret Health Validation & Compliance Dashboard</h2>
            
            <div class="health-summary">
                <div class="health-card ${summary.healthPercentage === 100 ? 'success' : summary.healthPercentage >= 70 ? 'warning' : 'danger'}">
                    <div class="health-number">${summary.healthPercentage}%</div>
                    <div class="health-label">Overall Health</div>
                    ${summary.healthPercentage < 100 ? `<div class="health-subtext">${summary.unhealthy} secrets need attention</div>` : ''}
                </div>
                <div class="health-card">
                    <div class="health-number">${summary.healthy}/${summary.total}</div>
                    <div class="health-label">Healthy Secrets</div>
                    <div class="health-subtext">${summary.total > 0 ? Math.round((summary.healthy / summary.total) * 100) : 0}% pass all checks</div>
                </div>
                <div class="health-card ${summary.accessible === summary.total ? 'success' : 'danger'}">
                    <div class="health-number">${summary.accessible}/${summary.total}</div>
                    <div class="health-label">Accessible</div>
                    ${summary.accessible < summary.total ? `<div class="health-subtext">${summary.total - summary.accessible} not accessible</div>` : ''}
                </div>
                <div class="health-card ${summary.formatValid === summary.total ? 'success' : 'warning'}">
                    <div class="health-number">${summary.formatValid}/${summary.total}</div>
                    <div class="health-label">Format Valid</div>
                    ${summary.formatValid < summary.total ? `<div class="health-subtext">${summary.total - summary.formatValid} invalid format</div>` : ''}
                </div>
                <div class="health-card neutral">
                    <div class="health-number">${summary.withIssues}</div>
                    <div class="health-label">With Issues</div>
                </div>
                <div class="health-card neutral">
                    <div class="health-number">${summary.withWarnings}</div>
                    <div class="health-label">With Warnings</div>
                </div>
            </div>

            ${unaccessibleSecrets.length > 0 ? `
            <div class="alert-box danger">
                <h3>[X] Inaccessible Secrets (${unaccessibleSecrets.length})</h3>
                <p>These secrets cannot be accessed from Azure Key Vault:</p>
                <ul class="secret-list">
                    ${unaccessibleSecrets.map(s => `<li><strong>${s.name}</strong> - ${s.error || 'Unknown error'}</li>`).join('')}
                </ul>
            </div>
            ` : ''}

            ${invalidFormatSecrets.length > 0 ? `
            <div class="alert-box warning">
                <h3>[!] Invalid Format Secrets (${invalidFormatSecrets.length})</h3>
                <p>These secrets don't meet format requirements:</p>
                <ul class="secret-list">
                    ${invalidFormatSecrets.slice(0, 5).map(s => {
                        const issues = s.validationResult?.issues || [];
                        return `<li><strong>${s.name}</strong> - ${issues.join(', ')}</li>`;
                    }).join('')}
                    ${invalidFormatSecrets.length > 5 ? `<li><em>... and ${invalidFormatSecrets.length - 5} more</em></li>` : ''}
                </ul>
            </div>
            ` : ''}

            ${summary.commonIssues.length > 0 ? `
            <div class="insight-box">
                <h4>[*] Common Validation Issues</h4>
                <p>The following issues were found across multiple secrets:</p>
                <ul>
                    ${summary.commonIssues.map(issue => `<li><strong>${issue.text}</strong> (found in ${issue.count} secret${issue.count > 1 ? 's' : ''})</li>`).join('')}
                </ul>
            </div>
            ` : ''}

            <h3>Validation Rules</h3>
            <div class="rules-grid">
                ${Object.entries(this.validationRules).map(([secretName, rule]) => `
                <div class="rule-card">
                    <h4>${secretName}</h4>
                    <ul class="rule-list">
                        ${rule.minLength ? `<li>Min length: ${rule.minLength} chars</li>` : ''}
                        ${rule.maxLength ? `<li>Max length: ${rule.maxLength} chars</li>` : ''}
                        ${rule.requireUppercase ? `<li>[OK] Requires uppercase</li>` : ''}
                        ${rule.requireLowercase ? `<li>[OK] Requires lowercase</li>` : ''}
                        ${rule.requireNumbers ? `<li>[OK] Requires numbers</li>` : ''}
                        ${rule.requireSpecial ? `<li>[OK] Requires special chars</li>` : ''}
                        ${rule.pattern ? `<li>Pattern: ${rule.pattern}</li>` : ''}
                    </ul>
                </div>
                `).join('')}
            </div>

            <h3>Secret Validation Results</h3>
            <div class="filter-controls">
                <button class="filter-btn active" onclick="filterValidation('all')">All (${Object.keys(results).length})</button>
                <button class="filter-btn" onclick="filterValidation('healthy')">Healthy (${summary.healthy})</button>
                <button class="filter-btn" onclick="filterValidation('unhealthy')">Unhealthy (${summary.unhealthy})</button>
                <button class="filter-btn" onclick="filterValidation('issues')">With Issues (${summary.withIssues})</button>
            </div>
            <table class="secrets-table" id="validation-table">
                <thead>
                    <tr>
                        <th>Secret Name</th>
                        <th>Accessibility</th>
                        <th>Format Validation</th>
                        <th>Length</th>
                        <th>Issues</th>
                        <th>Warnings</th>
                        <th>Recommendation</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.values(results).map(result => {
                        const validation = result.validationResult || {};
                        const hasIssues = validation.issues && validation.issues.length > 0;
                        let recommendation = '';
                        if (!result.accessible) {
                            recommendation = 'Fix access permissions or check Key Vault configuration';
                        } else if (!validation.valid) {
                            if (validation.issues.includes('Too short')) {
                                recommendation = `Increase length to at least ${this.validationRules[result.name]?.minLength || 'required'} characters`;
                            } else if (validation.issues.includes('Too long')) {
                                recommendation = `Reduce length to maximum ${this.validationRules[result.name]?.maxLength || 'allowed'} characters`;
                            } else if (validation.issues.includes('Missing uppercase')) {
                                recommendation = 'Add uppercase letters (A-Z)';
                            } else if (validation.issues.includes('Missing lowercase')) {
                                recommendation = 'Add lowercase letters (a-z)';
                            } else if (validation.issues.includes('Missing numbers')) {
                                recommendation = 'Add numbers (0-9)';
                            } else if (validation.issues.includes('Missing special')) {
                                recommendation = 'Add special characters (!@#$%^&*)';
                            } else {
                                recommendation = 'Review validation rules and update secret format';
                            }
                        } else {
                            recommendation = 'Secret is compliant';
                        }
                        return `
                    <tr class="${result.accessible && result.formatValid ? 'success' : 'danger'}" 
                        data-category="${!result.accessible ? 'unhealthy' : !result.formatValid ? 'issues' : 'healthy'}">
                        <td><strong>${result.name}</strong></td>
                        <td>
                            ${result.accessible 
                                ? '<span class="badge badge-success">[OK] Accessible</span>'
                                : `<span class="badge badge-danger">[X] Not Accessible</span><br><small>${result.error || 'Unknown error'}</small>`}
                        </td>
                        <td>
                            ${validation.valid 
                                ? '<span class="badge badge-success">[OK] Valid</span>'
                                : '<span class="badge badge-danger">[X] Invalid</span>'}
                        </td>
                        <td>${validation.length || 'N/A'} ${validation.length && this.validationRules[result.name] ? 
                            (validation.length < this.validationRules[result.name].minLength ? '<small class="text-warning">too short</small>' :
                             validation.length > this.validationRules[result.name].maxLength ? '<small class="text-warning">too long</small>' : '') : ''}</td>
                        <td>
                            ${hasIssues
                                ? `<ul class="issue-list">${validation.issues.map(i => `<li>${i}</li>`).join('')}</ul>`
                                : '<span class="text-success">[OK] None</span>'}
                        </td>
                        <td>
                            ${validation.warnings && validation.warnings.length > 0
                                ? `<ul class="warning-list">${validation.warnings.map(w => `<li>[!] ${w}</li>`).join('')}</ul>`
                                : '<span class="text-muted">None</span>'}
                        </td>
                        <td>
                            <span class="recommendation">${recommendation}</span>
                        </td>
                    </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>

            <h3>Character Analysis</h3>
            <table class="secrets-table">
                <thead>
                    <tr>
                        <th>Secret Name</th>
                        <th>Uppercase</th>
                        <th>Lowercase</th>
                        <th>Numbers</th>
                        <th>Special</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.values(results).map(result => {
                        const validation = result.validationResult || {};
                        return `
                    <tr>
                        <td><strong>${result.name}</strong></td>
                        <td>${validation.hasUppercase !== undefined ? (validation.hasUppercase ? '[OK]' : '[X]') : 'N/A'}</td>
                        <td>${validation.hasLowercase !== undefined ? (validation.hasLowercase ? '[OK]' : '[X]') : 'N/A'}</td>
                        <td>${validation.hasNumbers !== undefined ? (validation.hasNumbers ? '[OK]' : '[X]') : 'N/A'}</td>
                        <td>${validation.hasSpecial !== undefined ? (validation.hasSpecial ? '[OK]' : '[X]') : 'N/A'}</td>
                    </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
            
            <style>
                .health-summary {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .health-card {
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    background: #f8f9fa;
                }
                .health-card.success { background: #d4edda; color: #155724; }
                .health-card.warning { background: #fff3cd; color: #856404; }
                .health-number {
                    font-size: 2.5em;
                    font-weight: bold;
                }
                .health-label {
                    margin-top: 10px;
                    font-size: 0.9em;
                }
                .issue-list, .warning-list {
                    margin: 0;
                    padding-left: 20px;
                    font-size: 0.9em;
                }
                .issue-list li { color: #dc3545; }
                .warning-list li { color: #856404; }
                .text-success { color: #28a745; }
                .text-muted { color: #6c757d; }
                .text-warning { color: #856404; }
                .health-subtext {
                    font-size: 0.85em;
                    margin-top: 5px;
                    opacity: 0.9;
                }
                .health-card.danger { background: #f8d7da; color: #721c24; }
                .health-card.neutral { background: #e9ecef; color: #495057; }
                .rules-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                    gap: 15px;
                    margin: 20px 0;
                }
                .rule-card {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    border-left: 4px solid #007bff;
                }
                .rule-card h4 {
                    margin-top: 0;
                    color: #007bff;
                }
                .rule-list {
                    margin: 10px 0;
                    padding-left: 20px;
                    font-size: 0.9em;
                }
                .rule-list li {
                    margin: 5px 0;
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
            </style>
            <script>
                function filterValidation(category) {
                    const rows = document.querySelectorAll('#validation-table tbody tr');
                    const buttons = document.querySelectorAll('.filter-btn');
                    
                    buttons.forEach(btn => btn.classList.remove('active'));
                    event.target.classList.add('active');
                    
                    rows.forEach(row => {
                        if (category === 'all' || row.dataset.category === category ||
                            (category === 'unhealthy' && row.dataset.category !== 'healthy')) {
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

        if (pathname === '/api/validate') {
            const results = await this.validateAllSecrets();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
            return;
        }

        if (pathname.startsWith('/api/validate/')) {
            const secretName = decodeURIComponent(pathname.replace('/api/validate/', ''));
            const result = await this.checkSecretHealth(secretName);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        // Default HTML response
        const results = await this.validateAllSecrets();
        const summary = this.getHealthSummary(results);
        const baseHTML = this.getHTML({});
        const validationHTML = this.getHTMLWithValidationData(results, summary);
        
        // Replace the entire secrets container with our custom validation dashboard
        let fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>\s*<div id="error-container">/, 
            validationHTML + '\n        <div id="error-container">');
        
        if (fullHTML === baseHTML) {
            // Fallback pattern if the first one doesn't match
            fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>/, validationHTML);
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }
}

const app = new ValidationCheckerWebapp({
    appName: 'Hello World - Secret Validation Checker',
    method: 'Secret Validation Checker',
    secretStrategy: 'azure-api'
});

app.start();


const http = require('http');
const url = require('url');
const { SecretClient } = require('@azure/keyvault-secrets');
const { ClientSecretCredential } = require('@azure/identity');
const HelloWorldWebapp = require('./webapp-framework');

class SecurityDashboardWebapp extends HelloWorldWebapp {
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
        
        this.securityRules = {
            'database-password': {
                minLength: 12,
                maxLength: 128,
                requireUppercase: true,
                requireLowercase: true,
                requireNumbers: true,
                requireSpecial: true,
                maxAge: 90, // days
                rotationRequired: true
            },
            'api-key': {
                minLength: 32,
                maxLength: 256,
                pattern: /^[A-Za-z0-9]+$/,
                maxAge: 180, // days
                rotationRequired: true
            },
            'hello-world-secret': {
                minLength: 1,
                maxLength: 1000,
                maxAge: 365, // days
                rotationRequired: false
            }
        };
        
        this.complianceRules = {
            'password-policy': {
                name: 'Password Policy Compliance',
                description: 'Ensures passwords meet security requirements',
                severity: 'high',
                rules: ['minLength', 'maxLength', 'requireUppercase', 'requireLowercase', 'requireNumbers', 'requireSpecial']
            },
            'rotation-policy': {
                name: 'Secret Rotation Policy',
                description: 'Ensures secrets are rotated within required timeframe',
                severity: 'medium',
                rules: ['rotationRequired', 'maxAge']
            },
            'access-policy': {
                name: 'Access Control Policy',
                description: 'Validates proper access controls and permissions',
                severity: 'high',
                rules: ['accessPatterns', 'permissions']
            }
        };
        
        this.securityMetrics = {
            totalSecrets: 0,
            compliantSecrets: 0,
            nonCompliantSecrets: 0,
            expiredSecrets: 0,
            rotationOverdue: 0,
            accessViolations: 0,
            lastScan: null
        };
        
        this.accessLog = [];
        this.maxLogEntries = 1000;
        this.lastSecurityScan = 0;
        this.SECURITY_SCAN_INTERVAL = 300000; // 5 minutes
        
        // Re-initialize Azure client if needed
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
            console.error('Missing required Azure credentials for security dashboard');
            return;
        }

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        this.keyVaultClient = new SecretClient(keyVaultUrl, credential);
    }

    async performSecurityScan() {
        const now = Date.now();
        if (now - this.lastSecurityScan < this.SECURITY_SCAN_INTERVAL && this.securityMetrics.lastScan) {
            return this.securityMetrics;
        }

        try {
            const secrets = await this.getAllSecretsWithProperties();
            const securityResults = {
                secrets: [],
                compliance: {},
                violations: [],
                recommendations: []
            };

            let totalSecrets = 0;
            let compliantSecrets = 0;
            let nonCompliantSecrets = 0;
            let expiredSecrets = 0;
            let rotationOverdue = 0;

            for (const secret of secrets) {
                totalSecrets++;
                const secretAnalysis = await this.analyzeSecretSecurity(secret);
                securityResults.secrets.push(secretAnalysis);

                if (secretAnalysis.isCompliant) {
                    compliantSecrets++;
                } else {
                    nonCompliantSecrets++;
                }

                if (secretAnalysis.isExpired) {
                    expiredSecrets++;
                }

                if (secretAnalysis.rotationOverdue) {
                    rotationOverdue++;
                }

                // Collect violations
                if (secretAnalysis.violations.length > 0) {
                    securityResults.violations.push(...secretAnalysis.violations);
                }
            }

            // Calculate compliance scores
            securityResults.compliance = this.calculateComplianceScore(securityResults.secrets);
            
            // Generate recommendations
            securityResults.recommendations = this.generateSecurityRecommendations(securityResults);

            // Update metrics
            this.securityMetrics = {
                totalSecrets,
                compliantSecrets,
                nonCompliantSecrets,
                expiredSecrets,
                rotationOverdue,
                accessViolations: securityResults.violations.length,
                lastScan: new Date().toISOString(),
                complianceScore: securityResults.compliance.overallScore
            };

            this.lastSecurityScan = now;
            return { metrics: this.securityMetrics, results: securityResults };

        } catch (error) {
            console.error('Error performing security scan:', error);
            return { metrics: this.securityMetrics, error: error.message };
        }
    }

    async analyzeSecretSecurity(secret) {
        const secretName = secret.name;
        const rule = this.securityRules[secretName] || {};
        const violations = [];
        const warnings = [];
        let isCompliant = true;
        let isExpired = false;
        let rotationOverdue = false;

        try {
            // Get secret value for analysis
            const secretValue = secret.properties.value || await this.getSecretFromKeyVault(secretName);
            
            if (secretValue) {
                // Length validation
                if (rule.minLength && secretValue.length < rule.minLength) {
                    violations.push(`Password too short: minimum ${rule.minLength} characters required`);
                    isCompliant = false;
                }
                if (rule.maxLength && secretValue.length > rule.maxLength) {
                    violations.push(`Password too long: maximum ${rule.maxLength} characters allowed`);
                    isCompliant = false;
                }

                // Character requirements
                if (rule.requireUppercase && !/[A-Z]/.test(secretValue)) {
                    violations.push('Missing uppercase letters');
                    isCompliant = false;
                }
                if (rule.requireLowercase && !/[a-z]/.test(secretValue)) {
                    violations.push('Missing lowercase letters');
                    isCompliant = false;
                }
                if (rule.requireNumbers && !/[0-9]/.test(secretValue)) {
                    violations.push('Missing numbers');
                    isCompliant = false;
                }
                if (rule.requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(secretValue)) {
                    violations.push('Missing special characters');
                    isCompliant = false;
                }

                // Pattern validation
                if (rule.pattern && !rule.pattern.test(secretValue)) {
                    violations.push(`Does not match required pattern: ${rule.pattern}`);
                    isCompliant = false;
                }
            }

            // Age and rotation analysis
            const createdOn = secret.properties.createdOn;
            const updatedOn = secret.properties.updatedOn;
            const expiresOn = secret.properties.expiresOn;
            
            if (expiresOn) {
                const now = new Date();
                if (now > expiresOn) {
                    isExpired = true;
                    violations.push('Secret has expired');
                    isCompliant = false;
                }
            }

            // Rotation analysis
            if (rule.rotationRequired && rule.maxAge) {
                const lastUpdate = updatedOn || createdOn;
                if (lastUpdate) {
                    const daysSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysSinceUpdate > rule.maxAge) {
                        rotationOverdue = true;
                        violations.push(`Secret rotation overdue: ${daysSinceUpdate} days since last update (max: ${rule.maxAge} days)`);
                        isCompliant = false;
                    }
                }
            }

            // Security strength analysis
            const strength = this.calculatePasswordStrength(secretValue);
            if (strength.score < 70) {
                warnings.push(`Weak password strength: ${strength.score}/100`);
            }

            return {
                name: secretName,
                isCompliant,
                isExpired,
                rotationOverdue,
                violations,
                warnings,
                strength: strength,
                lastUpdated: updatedOn || createdOn,
                expiresOn: expiresOn,
                age: lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)) : null
            };

        } catch (error) {
            return {
                name: secretName,
                isCompliant: false,
                isExpired: false,
                rotationOverdue: false,
                violations: [`Error analyzing secret: ${error.message}`],
                warnings: [],
                strength: { score: 0, feedback: 'Unable to analyze' },
                lastUpdated: null,
                expiresOn: null,
                age: null
            };
        }
    }

    calculatePasswordStrength(password) {
        if (!password) return { score: 0, feedback: 'No password' };

        let score = 0;
        const feedback = [];

        // Length scoring
        if (password.length >= 12) score += 25;
        else if (password.length >= 8) score += 15;
        else feedback.push('Consider longer password');

        // Character variety
        if (/[a-z]/.test(password)) score += 10;
        if (/[A-Z]/.test(password)) score += 10;
        if (/[0-9]/.test(password)) score += 10;
        if (/[^A-Za-z0-9]/.test(password)) score += 15;

        // Complexity
        const uniqueChars = new Set(password).size;
        if (uniqueChars > password.length * 0.6) score += 10;

        // Common patterns
        if (!/(.)\1{2,}/.test(password)) score += 10; // No repeated characters
        if (!/123|abc|qwe/i.test(password)) score += 10; // No common sequences

        if (score < 30) feedback.push('Very weak');
        else if (score < 50) feedback.push('Weak');
        else if (score < 70) feedback.push('Moderate');
        else if (score < 90) feedback.push('Strong');
        else feedback.push('Very strong');

        return { score: Math.min(score, 100), feedback: feedback.join(', ') };
    }

    calculateComplianceScore(secrets) {
        const total = secrets.length;
        if (total === 0) return { overallScore: 100, breakdown: {} };

        const compliant = secrets.filter(s => s.isCompliant).length;
        const overallScore = Math.round((compliant / total) * 100);

        const breakdown = {
            passwordPolicy: 0,
            rotationPolicy: 0,
            accessPolicy: 0
        };

        // Password policy compliance
        const passwordCompliant = secrets.filter(s => 
            s.violations.filter(v => 
                v.includes('uppercase') || v.includes('lowercase') || 
                v.includes('numbers') || v.includes('special') || 
                v.includes('short') || v.includes('long')
            ).length === 0
        ).length;
        breakdown.passwordPolicy = Math.round((passwordCompliant / total) * 100);

        // Rotation policy compliance
        const rotationCompliant = secrets.filter(s => !s.rotationOverdue).length;
        breakdown.rotationPolicy = Math.round((rotationCompliant / total) * 100);

        // Access policy compliance (simplified)
        breakdown.accessPolicy = 85; // Placeholder

        return { overallScore, breakdown };
    }

    generateSecurityRecommendations(results) {
        const recommendations = [];

        // Expired secrets
        const expiredSecrets = results.secrets.filter(s => s.isExpired);
        if (expiredSecrets.length > 0) {
            recommendations.push({
                priority: 'high',
                category: 'expired-secrets',
                title: 'Expired Secrets Detected',
                description: `${expiredSecrets.length} secrets have expired and need immediate attention`,
                action: 'Rotate expired secrets immediately',
                affectedSecrets: expiredSecrets.map(s => s.name)
            });
        }

        // Rotation overdue
        const rotationOverdue = results.secrets.filter(s => s.rotationOverdue);
        if (rotationOverdue.length > 0) {
            recommendations.push({
                priority: 'medium',
                category: 'rotation-overdue',
                title: 'Secret Rotation Overdue',
                description: `${rotationOverdue.length} secrets are overdue for rotation`,
                action: 'Implement automated rotation for these secrets',
                affectedSecrets: rotationOverdue.map(s => s.name)
            });
        }

        // Weak passwords
        const weakPasswords = results.secrets.filter(s => s.strength && s.strength.score < 50);
        if (weakPasswords.length > 0) {
            recommendations.push({
                priority: 'medium',
                category: 'weak-passwords',
                title: 'Weak Passwords Detected',
                description: `${weakPasswords.length} secrets have weak password strength`,
                action: 'Strengthen passwords to meet security requirements',
                affectedSecrets: weakPasswords.map(s => s.name)
            });
        }

        // Compliance issues
        const nonCompliant = results.secrets.filter(s => !s.isCompliant);
        if (nonCompliant.length > 0) {
            recommendations.push({
                priority: 'high',
                category: 'compliance-violations',
                title: 'Compliance Violations',
                description: `${nonCompliant.length} secrets violate security policies`,
                action: 'Review and update secrets to meet compliance requirements',
                affectedSecrets: nonCompliant.map(s => s.name)
            });
        }

        return recommendations;
    }

    getHTMLWithSecurityDashboard(securityData) {
        const { metrics, results } = securityData;
        const complianceScore = metrics.complianceScore || 0;
        const riskLevel = complianceScore >= 90 ? 'low' : complianceScore >= 70 ? 'medium' : 'high';

        return `
        <div class="container">
            <h2>Security & Compliance Dashboard</h2>
            
            <div class="security-overview">
                <div class="compliance-score ${riskLevel}">
                    <div class="score-value">${complianceScore}%</div>
                    <div class="score-label">Compliance Score</div>
                    <div class="score-description">${riskLevel.toUpperCase()} RISK</div>
                </div>
                
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-value">${metrics.totalSecrets}</div>
                        <div class="metric-label">Total Secrets</div>
                    </div>
                    <div class="metric-card success">
                        <div class="metric-value">${metrics.compliantSecrets}</div>
                        <div class="metric-label">Compliant</div>
                    </div>
                    <div class="metric-card danger">
                        <div class="metric-value">${metrics.nonCompliantSecrets}</div>
                        <div class="metric-label">Non-Compliant</div>
                    </div>
                    <div class="metric-card warning">
                        <div class="metric-value">${metrics.expiredSecrets}</div>
                        <div class="metric-label">Expired</div>
                    </div>
                    <div class="metric-card warning">
                        <div class="metric-value">${metrics.rotationOverdue}</div>
                        <div class="metric-label">Rotation Overdue</div>
                    </div>
                    <div class="metric-card danger">
                        <div class="metric-value">${metrics.accessViolations}</div>
                        <div class="metric-label">Access Violations</div>
                    </div>
                </div>
            </div>

            ${results && results.recommendations && results.recommendations.length > 0 ? `
            <div class="recommendations-section">
                <h3>Security Recommendations</h3>
                <div class="recommendations-grid">
                    ${results.recommendations.map(rec => `
                    <div class="recommendation-card ${rec.priority}">
                        <div class="rec-header">
                            <span class="rec-priority">${rec.priority.toUpperCase()}</span>
                            <span class="rec-category">${rec.category.replace('-', ' ').toUpperCase()}</span>
                        </div>
                        <h4>${rec.title}</h4>
                        <p>${rec.description}</p>
                        <div class="rec-action">
                            <strong>Action:</strong> ${rec.action}
                        </div>
                        ${rec.affectedSecrets && rec.affectedSecrets.length > 0 ? `
                        <div class="rec-secrets">
                            <strong>Affected Secrets:</strong> ${rec.affectedSecrets.join(', ')}
                        </div>
                        ` : ''}
                    </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            ${results && results.compliance ? `
            <div class="compliance-breakdown">
                <h3>Compliance Breakdown</h3>
                <div class="compliance-metrics">
                    <div class="compliance-item">
                        <div class="compliance-label">Password Policy</div>
                        <div class="compliance-bar">
                            <div class="compliance-fill" style="width: ${results.compliance.breakdown.passwordPolicy}%"></div>
                        </div>
                        <div class="compliance-value">${results.compliance.breakdown.passwordPolicy}%</div>
                    </div>
                    <div class="compliance-item">
                        <div class="compliance-label">Rotation Policy</div>
                        <div class="compliance-bar">
                            <div class="compliance-fill" style="width: ${results.compliance.breakdown.rotationPolicy}%"></div>
                        </div>
                        <div class="compliance-value">${results.compliance.breakdown.rotationPolicy}%</div>
                    </div>
                    <div class="compliance-item">
                        <div class="compliance-label">Access Policy</div>
                        <div class="compliance-bar">
                            <div class="compliance-fill" style="width: ${results.compliance.breakdown.accessPolicy}%"></div>
                        </div>
                        <div class="compliance-value">${results.compliance.breakdown.accessPolicy}%</div>
                    </div>
                </div>
            </div>
            ` : ''}

            ${results && results.secrets ? `
            <div class="secrets-analysis">
                <h3>Secret Security Analysis</h3>
                <div class="filter-controls">
                    <button class="filter-btn active" onclick="filterSecrets('all')">All (${results.secrets.length})</button>
                    <button class="filter-btn" onclick="filterSecrets('compliant')">Compliant (${results.secrets.filter(s => s.isCompliant).length})</button>
                    <button class="filter-btn" onclick="filterSecrets('non-compliant')">Non-Compliant (${results.secrets.filter(s => !s.isCompliant).length})</button>
                    <button class="filter-btn" onclick="filterSecrets('expired')">Expired (${results.secrets.filter(s => s.isExpired).length})</button>
                    <button class="filter-btn" onclick="filterSecrets('rotation-overdue')">Rotation Overdue (${results.secrets.filter(s => s.rotationOverdue).length})</button>
                </div>
                <table class="secrets-table" id="security-table">
                    <thead>
                        <tr>
                            <th>Secret Name</th>
                            <th>Compliance</th>
                            <th>Strength</th>
                            <th>Age</th>
                            <th>Expires</th>
                            <th>Violations</th>
                            <th>Warnings</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${results.secrets.map(secret => `
                        <tr class="${secret.isCompliant ? 'success' : 'danger'} ${secret.isExpired ? 'expired' : ''} ${secret.rotationOverdue ? 'rotation-overdue' : ''}" 
                            data-category="${secret.isCompliant ? 'compliant' : 'non-compliant'} ${secret.isExpired ? 'expired' : ''} ${secret.rotationOverdue ? 'rotation-overdue' : ''}">
                            <td><strong>${secret.name}</strong></td>
                            <td>
                                ${secret.isCompliant 
                                    ? '<span class="badge badge-success">[OK] Compliant</span>'
                                    : '<span class="badge badge-danger">[X] Non-Compliant</span>'}
                            </td>
                            <td>
                                <div class="strength-indicator">
                                    <div class="strength-bar">
                                        <div class="strength-fill" style="width: ${secret.strength ? secret.strength.score : 0}%"></div>
                                    </div>
                                    <span class="strength-score">${secret.strength ? secret.strength.score : 0}/100</span>
                                </div>
                            </td>
                            <td>${secret.age ? `${secret.age} days` : 'N/A'}</td>
                            <td>
                                ${secret.expiresOn 
                                    ? new Date(secret.expiresOn).toLocaleDateString()
                                    : 'Never'}
                            </td>
                            <td>
                                ${secret.violations.length > 0
                                    ? `<ul class="violation-list">${secret.violations.map(v => `<li>${v}</li>`).join('')}</ul>`
                                    : '<span class="text-success">[OK] None</span>'}
                            </td>
                            <td>
                                ${secret.warnings.length > 0
                                    ? `<ul class="warning-list">${secret.warnings.map(w => `<li>[!] ${w}</li>`).join('')}</ul>`
                                    : '<span class="text-muted">None</span>'}
                            </td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}

            <div class="last-scan">
                <p><strong>Last Security Scan:</strong> ${metrics.lastScan ? new Date(metrics.lastScan).toLocaleString() : 'Never'}</p>
                <button class="action-btn primary" onclick="refreshSecurityScan()">[REFRESH] Run Security Scan</button>
            </div>
            
            <style>
                .security-overview {
                    display: grid;
                    grid-template-columns: 200px 1fr;
                    gap: 30px;
                    margin: 20px 0;
                    align-items: center;
                }
                .compliance-score {
                    text-align: center;
                    padding: 30px;
                    border-radius: 12px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                }
                .compliance-score.low { background: linear-gradient(135deg, #4caf50, #66bb6a); color: white; }
                .compliance-score.medium { background: linear-gradient(135deg, #ff9800, #ffb74d); color: white; }
                .compliance-score.high { background: linear-gradient(135deg, #f44336, #ef5350); color: white; }
                .score-value {
                    font-size: 3em;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                .score-label {
                    font-size: 1.2em;
                    margin-bottom: 5px;
                }
                .score-description {
                    font-size: 0.9em;
                    opacity: 0.9;
                }
                .metrics-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                    gap: 15px;
                }
                .metric-card {
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 8px;
                    text-align: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .metric-card.success { background: #d4edda; color: #155724; }
                .metric-card.danger { background: #f8d7da; color: #721c24; }
                .metric-card.warning { background: #fff3cd; color: #856404; }
                .metric-value {
                    font-size: 2em;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .metric-label {
                    font-size: 0.9em;
                    color: #6c757d;
                }
                .recommendations-section {
                    margin: 30px 0;
                }
                .recommendations-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .recommendation-card {
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    border-left: 4px solid #007bff;
                }
                .recommendation-card.high { border-left-color: #dc3545; }
                .recommendation-card.medium { border-left-color: #ffc107; }
                .recommendation-card.low { border-left-color: #28a745; }
                .rec-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 10px;
                }
                .rec-priority {
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    font-weight: bold;
                }
                .recommendation-card.high .rec-priority { background: #dc3545; color: white; }
                .recommendation-card.medium .rec-priority { background: #ffc107; color: #000; }
                .recommendation-card.low .rec-priority { background: #28a745; color: white; }
                .rec-category {
                    font-size: 0.8em;
                    color: #6c757d;
                }
                .rec-action {
                    margin: 10px 0;
                    padding: 10px;
                    background: #f8f9fa;
                    border-radius: 4px;
                }
                .rec-secrets {
                    margin-top: 10px;
                    font-size: 0.9em;
                    color: #6c757d;
                }
                .compliance-breakdown {
                    margin: 30px 0;
                }
                .compliance-metrics {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                }
                .compliance-item {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }
                .compliance-label {
                    min-width: 120px;
                    font-weight: 500;
                }
                .compliance-bar {
                    flex: 1;
                    height: 20px;
                    background: #e9ecef;
                    border-radius: 10px;
                    overflow: hidden;
                }
                .compliance-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #4caf50, #66bb6a);
                    transition: width 0.3s;
                }
                .compliance-value {
                    min-width: 50px;
                    text-align: right;
                    font-weight: bold;
                }
                .secrets-analysis {
                    margin: 30px 0;
                }
                .filter-controls {
                    display: flex;
                    gap: 10px;
                    margin: 20px 0;
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
                .filter-btn:hover { background: #e7f3ff; }
                .filter-btn.active { background: #007bff; color: white; }
                .strength-indicator {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .strength-bar {
                    width: 100px;
                    height: 8px;
                    background: #e9ecef;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .strength-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #dc3545, #ffc107, #28a745);
                    transition: width 0.3s;
                }
                .strength-score {
                    font-size: 0.9em;
                    font-weight: bold;
                }
                .violation-list, .warning-list {
                    margin: 0;
                    padding-left: 15px;
                    font-size: 0.9em;
                }
                .violation-list li { color: #dc3545; }
                .warning-list li { color: #856404; }
                .text-success { color: #28a745; }
                .text-muted { color: #6c757d; }
                .badge {
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    font-weight: bold;
                }
                .badge-success { background: #28a745; color: white; }
                .badge-danger { background: #dc3545; color: white; }
                .last-scan {
                    margin: 30px 0;
                    padding: 20px;
                    background: #f8f9fa;
                    border-radius: 8px;
                    text-align: center;
                }
                .action-btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: 500;
                    margin: 10px;
                }
                .action-btn.primary {
                    background: #007bff;
                    color: white;
                }
                .action-btn:hover { opacity: 0.9; }
                tr.expired { background: #fff5f5; }
                tr.rotation-overdue { background: #fffbf0; }
            </style>
            <script>
                function filterSecrets(category) {
                    const rows = document.querySelectorAll('#security-table tbody tr');
                    const buttons = document.querySelectorAll('.filter-btn');
                    
                    buttons.forEach(btn => btn.classList.remove('active'));
                    event.target.classList.add('active');
                    
                    rows.forEach(row => {
                        if (category === 'all' || row.dataset.category.includes(category)) {
                            row.style.display = '';
                        } else {
                            row.style.display = 'none';
                        }
                    });
                }
                
                function refreshSecurityScan() {
                    window.location.reload();
                }
            </script>
        </div>
        `;
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        if (pathname === '/api/security-scan') {
            const securityData = await this.performSecurityScan();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(securityData));
            return;
        }

        if (pathname === '/api/security-metrics') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.securityMetrics));
            return;
        }

        // Default HTML response
        const securityData = await this.performSecurityScan();
        const baseHTML = this.getHTML({});
        const securityHTML = this.getHTMLWithSecurityDashboard(securityData);
        
        // Replace the entire secrets container with our custom security dashboard
        // Use a more flexible regex that handles various whitespace patterns
        let fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>\s*<div id="error-container">/, 
            securityHTML + '\n        <div id="error-container">');
        
        if (fullHTML === baseHTML) {
            // Try with more flexible whitespace matching
            fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>[\s]*<div id="error-container">/, 
                securityHTML + '\n        <div id="error-container">');
        }
        
        if (fullHTML === baseHTML) {
            // Final fallback - just replace the secrets container
            fullHTML = baseHTML.replace(/<div id="secrets-container">[\s\S]*?<\/div>/, securityHTML);
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fullHTML);
    }
}

const app = new SecurityDashboardWebapp({
    appName: 'Hello World - Security & Compliance Dashboard',
    method: 'Security & Compliance Dashboard',
    secretStrategy: 'azure-api'
});

app.start();

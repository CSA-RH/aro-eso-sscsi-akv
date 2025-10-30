const HelloWorldWebapp = require('../../shared/webapp-framework');

const app = new HelloWorldWebapp({
    appName: 'Hello World - Red Hat External Secrets Operator',
    method: 'Red Hat External Secrets Operator',
    operator: 'RED HAT',
    secretStrategy: 'environment'
});

app.start();

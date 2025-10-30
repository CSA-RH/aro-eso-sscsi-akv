const HelloWorldWebapp = require('./webapp-framework');

const app = new HelloWorldWebapp({
    appName: 'Hello World - Direct Azure API',
    method: 'Direct Azure Key Vault API',
    secretStrategy: 'azure-api'
});

app.start();

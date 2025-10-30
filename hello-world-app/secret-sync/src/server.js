const HelloWorldWebapp = require('./webapp-framework');

const app = new HelloWorldWebapp({
    appName: 'Hello World - Kubernetes Secret Sync',
    method: 'Kubernetes Secret Sync',
    secretStrategy: 'environment'
});

app.start();

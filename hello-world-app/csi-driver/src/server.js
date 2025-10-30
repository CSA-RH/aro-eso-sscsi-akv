const HelloWorldWebapp = require('./webapp-framework');

const app = new HelloWorldWebapp({
    appName: 'Hello World - CSI Driver',
    method: 'Secrets Store CSI Driver',
    secretStrategy: 'csi'
});

app.start();

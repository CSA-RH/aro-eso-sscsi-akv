# Legacy Scripts

This directory contains reference scripts from earlier versions of the project.

## ⚠️ Warning

These scripts are **not used** by the current project and are kept for reference only.

## Current Active Scripts

The active scripts are located in the `bin/` directory:
- `bin/install` - Main installation and management script
- `bin/examples` - Examples management
- `bin/generate-examples` - Example generation

## What's in This Directory

- **azure/** - Azure resource setup scripts (superseded by `bin/install`)
- **keyvault/** - Key Vault population scripts
- **populate-keyvault.ps1** - PowerShell script for Key Vault setup

## Migration Notes

If you're looking for functionality, use these commands instead:

### Azure Setup
```bash
./bin/install azure              # Setup Azure resources
./bin/install validate azure      # Validate Azure setup
```

### Installation
```bash
./bin/install install             # Install SSCSI + Azure Provider
./bin/install install --eso       # Install SSCSI + ESO
./bin/install install --all       # Install everything
```

### Cleanup
```bash
./bin/install cleanup             # Clean up all resources
./bin/install cleanup kubernetes  # Clean up Kubernetes only
./bin/install cleanup azure       # Clean up Azure only
```

## Why Keep These?

These scripts are kept as reference for:
- Historical context
- Alternative approaches
- Troubleshooting legacy implementations

**Do not use these scripts directly** - they may not work with the current configuration.


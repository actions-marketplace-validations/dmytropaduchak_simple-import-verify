# simple-import-verify

Warn when new imports reference packages not listed in the project manifest.

## Usage

```yaml
name: Simple Import Verify
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  simple-import-verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dmytropaduchak/simple-import-verify@v0.1.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Develop

```bash
npm install && npm run build
```

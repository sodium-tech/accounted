# Accounted Arelle validator

Internal, authenticated validation service for the exact iXBRL bytes Accounted intends to archive and upload to Bolagsverket.

The service accepts `POST /validate` using the existing Accounted contract:

```json
{"filename":"arsredovisning.xhtml","content_base64":"..."}
```

It requires `Authorization: Bearer $VALIDATOR_TOKEN` and returns `ok`, the pinned Arelle version, and normalized issues. `/health` is unauthenticated for Kubernetes probes. Report contents exist only in a request-scoped temporary directory and are removed after validation.

The service retains Arelle's **public taxonomy cache only** at `ARELLE_CACHE_DIR` (default `/tmp/arelle-cache`). The first validation can download a large dependency graph; Accounted therefore defaults its service deadline to 210 seconds, configurable through `BOLAGSVERKET_ARELLE_TIMEOUT_MS`. Subsequent validations reuse the taxonomy cache.

Run tests:

```sh
cd services/arelle-validator
python -m unittest -v
```

This service is only one validation layer. Accounted must still pass its local preflight and Bolagsverket's acceptance-environment `kontrollera` call before connected filing can be enabled.

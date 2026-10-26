# Releasing

Releases start by pushing a `v*` tag; `.github/workflows/release.yml` tests the
commit and publishes it to npm with a provenance attestation. The workflow does
not create the GitHub release or update the market index — finish the checklist
below after npm confirms the version.

## Trusted publishing

Configured for this repository; the `0.1.0` and `0.3.0` releases were published
through it. If you ever need to recreate the npm-side setup, add this repository
as a trusted publisher on the package's npm settings page
(<https://www.npmjs.com/package/dsh-workspace-status/settings>, signed in with
2FA), or from a terminal with an authenticated npm login:

```sh
npm trust github dsh-workspace-status \
  --repo Stijnus/dsh-workspace-status \
  --file release.yml \
  --allow-publish
```

- Provider: GitHub Actions
- Repository: `Stijnus/dsh-workspace-status`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`
- Environment: none

The workflow authenticates with OIDC, so no npm token is stored in GitHub.
Because it runs `npm publish --provenance`, every version published this way
carries a SLSA provenance attestation (`https://slsa.dev/provenance/v1`).

## Checklist

1. Update `CHANGELOG.md` and `package.json` (`version`).
2. Run `npm test` and `npm pack --dry-run`.
3. Commit, then tag and push: `git tag v<version> && git push origin v<version>`.
4. Wait for the release workflow to verify the published version.
5. Update `market-index.json` with the published version and its registry
   `publishTimestamp`, then push it.
6. Create the GitHub release for the tag:
   `gh release create v<version> --title "<version> — <summary>" --notes-file <file>`.
7. Install the registry build over the dev copy when done:
   `dsh plugin --profile desktop add dsh-workspace-status@<version>`.

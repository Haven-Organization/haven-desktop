# Code signing

## Code signing policy

Haven's Windows releases are signed through SignPath.

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

Only files built from this repository's source by its GitHub Actions workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)) are signed: the Haven app
(`Haven.exe`) and its installer. Third-party binaries bundled with the app, such as Electron's own
libraries, are not signed with this certificate.

### Team roles

- Committers and reviewers: [members of the Haven-Organization GitHub organization](https://github.com/orgs/Haven-Organization/people)
- Approvers: TODO (list the people who approve each release's signing request)

Everyone with one of these roles uses multi-factor authentication on GitHub and SignPath.

### Privacy policy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it. Haven is a Matrix client: it
connects to the homeserver you sign in to and to the services that homeserver or your configuration
points it to (for example, link previews, an integration manager, or a call server).

## Setting up signing

SignPath's own copy of these settings is what's used; this is how they're laid out.

1. Apply for the SignPath Foundation open-source program at <https://signpath.org/apply>.
2. In SignPath, once approved:
    - Add GitHub.com as a trusted build system and link it to the project.
    - Create two artifact configurations, with the slugs `windows-app` and `windows-installer`,
      from the files in [`.signpath/artifact-configurations/`](../.signpath/artifact-configurations).
    - Note the organization ID, the project slug, and the signing policy slug
      (`release-signing` for real releases).
    - Create a CI user and an API token for it, with permission to submit signing requests.
3. In the GitHub repository's settings, under Secrets and variables > Actions:
    - Secret `SIGNPATH_API_TOKEN`: the API token.
    - Variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`.

Without those settings the workflow still runs and builds unsigned installers.

## Building a signed installer

The workflow runs for every pushed `haven-v*` tag, or by hand from the Actions tab ("Release
build", with an optional branch, tag or commit). It builds an x64 and an arm64 installer. With
SignPath set up, each waits for an approver twice in SignPath: once for the app, then for the
installer. The signed `Haven Setup X.Y.Z.exe` and `Haven Setup X.Y.Z-arm64.exe` are the run's
`haven-windows-x64-X.Y.Z` and `haven-windows-arm64-X.Y.Z` artifacts; a draft release made by the
same workflow attaches them itself (see [building.md](building.md#release-builds-on-github-actions)).

The uninstaller inside the installer isn't signed. electron-builder creates it while building the
installer, and it only ever runs from the installed folder, which Windows doesn't check.

A newly signed program can still get a SmartScreen warning for a while: SmartScreen builds trust in
a signer as more people download what it signed.

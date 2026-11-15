# Publishing

This repository builds an independent Obsidian plugin. The source stays on GitHub;
Obsidian installs the files attached to a GitHub release.

## Validate locally

Use Node.js 24 and npm:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:release
```

`dist/` contains `main.js`, `manifest.json`, `styles.css` when used, the plugin's
licence and the full third-party notices. Notices are also embedded in `main.js`,
so they remain with the installed plugin. Build output stays out of Git.

The release check verifies version consistency and the actual distributable,
including loading it without Node.js/Electron modules. It does not replace testing
the interface in Obsidian on desktop and mobile. ESLint uses the official Obsidian
rules (ESLint 9 matches the verifier dependencies' supported peer versions); API typing checks follow the scanner's documented exclusions for untyped
external metadata. Advisory warnings are not an approval from the directory.

## Publish a release

For the first release, the prepared version is already in `package.json`,
`manifest.json` and `versions.json`. For later releases, increment them together:

```sh
npm version patch --no-git-tag-version
```

Choose `minor` or `major` instead when appropriate. Update the changelog, validate,
then commit the source and push it to the default branch. Only after that, create
and push a tag **exactly** matching `manifest.json`'s version, without `v`:

```sh
version=$(node -p 'require("./manifest.json").version')
git tag "$version"
git push origin "$version"
```

Pushing that tag starts `.github/workflows/release.yml`. It runs the checks again,
builds from the lockfile and publishes a GitHub release with individual assets.
No npm publication or additional secret is required; it uses GitHub's built-in
token. If a check fails, correct the source before publishing; never move a tag
that already has a public release. Confirm the release's assets before submitting.

## Submit to Obsidian Community

1. Sign in at [Obsidian Community](https://community.obsidian.md) with your Obsidian account.
2. Connect the GitHub account that owns this repository.
3. Choose **Plugins → New plugin** and enter this repository's GitHub URL.
4. Agree to the developer policies and maintenance commitment, then submit.
5. Resolve scanner feedback in the repository and publish a new patch release if needed.
6. Publish the listing when the directory's review allows it.

The default branch's committed manifest and the matching release must both exist.
After acceptance, future versions are distributed from GitHub releases.

Official references: [submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin),
[requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
[developer policies](https://docs.obsidian.md/community-directory/developer-policies),
[lint configuration](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md).

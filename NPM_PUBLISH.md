# npm publish instructions (kahu-signalk)

Internal notes for cutting a new public release to npm using GitHub Actions trusted publishing.

## One-time setup (should already be done)

- `package.json`:
  - `"name": "kahu-signalk"`
- `.github/workflows/publish.yml` exists and uses `id-token: write`.
- On `npmjs.com` → package → **Settings → Trusted publishing**:
  - Provider: **GitHub Actions**
  - Org/user, repo, and workflow filename: `publish.yml` configured correctly.

## Normal release process

### Option A: Using `npm version` (recommended)

1. **Decide new version**

   Choose a new version `X.Y.Z` higher than the current `package.json` version.

2. **Run npm version (updates files + tag)**

   ```bash
   npm version X.Y.Z
   git push
   git push origin vX.Y.Z
   ```

3. **Verify GitHub Actions**

   - Go to repo **Actions** tab → workflow **“Publish npm package”**.
   - Confirm the run for tag `vX.Y.Z` finished successfully, including the `npm publish` step.

4. **Verify on npm**

   - Open `https://www.npmjs.com/package/kahu-signalk`.
   - Check that:
     - The displayed version is `X.Y.Z`.
     - “Last publish” timestamp matches the workflow run time.

### Option B: Manual version bump and tag

1. **Decide new version**

   Choose a new version `X.Y.Z` higher than the current `package.json` version.

2. **Update version manually**

   - Edit `package.json`:
     - Update `"version": "X.Y.Z"`.

3. **Commit and push**

   ```bash
   git add package.json
   git commit -m "chore: release vX.Y.Z"
   git push
   ```

4. **Create and push tag (triggers publish)**

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   Example:

   ```bash
   git tag v0.0.2
   git push origin v0.0.2
   ```

5. **Verify GitHub Actions**

   - Same as Option A.

6. **Verify on npm**

   - Same as Option A.

## Notes

- Do **not** reuse a version once published; always bump `X.Y.Z`.
- `NPM_PUBLISH.md` is excluded from the npm package via `.npmignore`.
# npm publish instructions

## Prereqs

- Version bumped in `package.json`
- Tag created and pushed: `git tag vX.Y.Z && git push origin vX.Y.Z`
- Trusted publisher configured on npm for this repo and `publish.yml`

## Steps

1. Update `package.json`:
   - `"name": "kahu-signalk"`
   - `"version": "X.Y.Z"`
2. Commit and push changes.
3. Create and push tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z

example:

```bash
   git tag v0.0.1
   git push origin v0.0.1

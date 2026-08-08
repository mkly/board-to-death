# Starter Provenance

The application baseline in this repository is vendored from an upstream
open-source admin dashboard starter.

- **Source**: https://github.com/arhamkhnz/next-shadcn-admin-dashboard
- **Pinned revision**: `934daf7ddd2f543dc66349a636177310674ed3c8`
  (`feat: migrate data table to use tanstack table v9`, 2026-08-08)
- **Imported**: 2026-08-08
- **License**: MIT (see `LICENSE`, copyright Mohammed Arham Khan)

## What was imported

The full working tree of the pinned revision was copied in, excluding its
`.git` history. No upstream files were renamed or removed.

`AGENTS.md` is the one exception: the upstream file's project-specific
agent guidance was merged underneath this repository's pre-existing
`Agent Guidelines` (browser development, commit policy, shared development
image) rather than overwriting them. `.gitignore` was carried over with its
`*.sh` rule removed, since this repository tracks shell scripts under
`scripts/`.

## Updating the pinned revision

To move to a newer upstream commit, re-clone the source repository at the
desired revision, re-apply the `AGENTS.md`/`.gitignore` adjustments described
above, and update the revision and date recorded here.

## Marcin Skalski personal blog

Technical blog built with Astro and Tailwind CSS, matching the stack and visual system of the
portfolio site in `~/sideprojects/portfolio`.

The live site is served from GitHub Pages through `Automaat/automaat.github.io` on the `gh-pages`
branch. This source repository builds the site and publishes `dist/` there.

### Commands

```sh
npm install
npm run dev
npm run build
npm run test
```

### Deployment

GitHub Actions:

- `.github/workflows/ci.yml` runs lint, tests, and build on pull requests and pushes to `master`.
- `.github/workflows/deploy.yml` runs the same checks on `master`, then publishes `dist/` to
  `Automaat/automaat.github.io:gh-pages`.

The deploy workflow needs a repository secret named `GH_PAGES_DEPLOY_TOKEN` with write access to
`Automaat/automaat.github.io`. The `public/CNAME` and `public/.nojekyll` files are committed so the
custom domain `mskalski.dev` continues to work after each deploy.

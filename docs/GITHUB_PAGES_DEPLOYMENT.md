# ROUTER.ESPORTS — GitHub Pages deployment

The production frontend is configured for the free GitHub Pages project site:

- Repository: https://github.com/shanraku/router.esports-
- Expected site: https://shanraku.github.io/router.esports-/
- Vite build base: `/router.esports-/`
- React Router basename: `import.meta.env.BASE_URL`
- SPA deep-link fallback: `dist/404.html` copied from `dist/index.html`

The `.github/workflows/build.yml` workflow builds the Vite app and deploys it using GitHub Pages Actions. The workflow requests Pages enablement automatically. Deployment is not considered live until the Actions deploy job succeeds and the expected URL responds.

Supabase Auth redirect URLs must include the deployed site origin and callback paths. Configure the exact project site URL in Supabase Auth URL Configuration after the first successful deployment. Keep the public publishable key in frontend configuration only; never expose the service-role key.

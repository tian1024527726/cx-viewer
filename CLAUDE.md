When adding new interactive controls, remember to add corresponding i18n entries.
After completing any code changes, automatically run `npm run build` to rebuild the project.
When committing code to GitHub, always run `npm run test` first to ensure all tests pass; for new server-side scripts (*.js files in root or lib/), add corresponding unit tests in the test/ directory; update history.md accordingly, and update README.md with translation into all i18n supported language versions if needed. Do not commit code without explicit user approval.
Before publishing to npm, check if any new root-level .js files are missing from package.json files array.
When adding node_modules dependencies, be sure to distinguish between devDependencies and dependencies.

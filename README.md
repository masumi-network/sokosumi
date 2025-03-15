# Sokosumi

This is the monorepo of the Sokosumi Marketplace, the web-app is built with Next.js and TypeScript, with a strong focus on UX and security

## Project Structure

```
sokosumi/
├── web-app/           # Main Next.js web application
├── .husky/            # Git hooks configuration
├── node_modules/      # Root dependencies
└── package.json       # Root package configuration
```

Please take a look into the individual folders for more information

## Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/sokosumi.git
   cd sokosumi
   ```

2. Navigate into the folder of interest and follow the instructions. As example
   ```bash
   cd web-app
   ```

## Git Workflow

We follow the [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) workflow, which is a lightweight, branch-based workflow. The main steps are:

1. Create a branch from `main`
2. Add commits with your changes
3. Open a Pull Request
4. Review and discuss the changes
5. Deploy and test (optional)
6. Maintainers merge to `main`

All changes merged to `main` are automatically deployed to our staging environment for final testing and validation.

For production deployments, we use GitHub Releases. After significant changes are merged to `main`, maintainers create a new release with semantic versioning tags (e.g., v1.0.0) to trigger production deployments.

## License

This project is licensed under the [MIT License] (/LICENSE)
